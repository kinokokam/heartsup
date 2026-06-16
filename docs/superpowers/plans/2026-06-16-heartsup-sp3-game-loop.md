# heartsup Sub-project 3 — Core Game Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lobby playable — rotating timed turns where a guesser sees a hidden rating + keyword(s), registers tilt up=correct / down=pass, scores accrue live, and a host-picked timer ends the game on a leaderboard.

**Architecture:** Server-authoritative game state via `security definer` Postgres RPCs (clients never write game tables); member-only RLS gates reads. Keyword text is resolved server-side into `rounds.keywords` (the client can't read the lexicon tables). A `useGame(lobbyId)` hook syncs `rounds`/`lobbies`/`lobby_players` over Realtime (same pattern as SP2's `useLobby`). Turn/game timers are client-driven but server-validated (no daemon). Plain styling — the Figma UI pass comes after SP3.

**Tech Stack:** React 19, react-router-dom v7, `@supabase/supabase-js` v2 (Realtime), DeviceOrientation API, Vitest 4 + Testing Library + user-event, local Supabase (DB container `supabase_db_heartsup`).

> **Environment notes for executors:**
> - Local Supabase: API `54421`, DB `54422`. Repo-root `.env` holds the keys (already populated with real local keys).
> - DB verification: `docker exec supabase_db_heartsup psql -U postgres -d postgres -c "<sql>"`.
> - Migrations through `0009` are applied. RLS reads run as the `authenticated` role; the SP2 `is_lobby_member(uuid)` security-definer helper (migration 0009) is reused here.
> - Vitest 4 mock typing: `vi.fn<() => T>()` (single generic), never `vi.fn<[], T>()`.
> - Realtime needs the socket authed: `AuthProvider` already calls `supabase.realtime.setAuth(...)`.
> - Full suite + `npm run build` (`tsc -b && vite build`) currently pass (79 tests) — keep green after every task.

**Confirmed existing schema (do not re-create):**
- `lobbies(id uuid, code text, host_id uuid, mode text 'easy|medium|hard', status 'waiting|playing|finished', game_ends_at timestamptz, created_at)` — SP3 adds `duration_seconds`, `turn_ends_at`.
- `lobby_players(lobby_id uuid, profile_id uuid, joined_at timestamptz, score int, is_current_turn bool, display_name, avatar)` PK `(lobby_id, profile_id)`.
- `rounds(id bigint identity, lobby_id uuid, player_id uuid, rating int, keyword_ids bigint[], outcome text 'guessed|passed'|null, started_at, ended_at)` — SP3 adds `combo_id bigint`, `combo_kind text`, `keywords text[]`.
- `feedback(id bigint identity, round_id bigint, combo_id bigint, combo_kind text, signal text '+|-', created_at)` — `combo_kind` check currently `pair|triple` (SP3 adds `single`).
- `pos_words(id bigint, word text, pos text)`, `word_pairs(id bigint, word_a_id bigint, word_b_id bigint, coherence real, times_shown/guessed/passed int, last_used_round bigint)`, `word_triples(... word_c_id ...)`. `word_*_id` reference `pos_words.id`.

---

## File Structure

```
supabase/migrations/0010_game_schema.sql     # columns, RLS, grants, publication, turn_len()
supabase/migrations/0011_game_rpcs.sql        # create_lobby(+duration), draw_card, start_game, submit_outcome, advance_turn, finish_game
supabase/tests/game.test.sql                  # role-aware DB integration test
src/
├─ lib/game.ts            ├─ lib/game.test.ts          # game RPC/data access + error mapping
├─ lib/tilt.ts            ├─ lib/tilt.test.ts          # pure tiltDirection() helper
├─ hooks/useTilt.ts       ├─ hooks/useTilt.test.tsx    # DeviceOrientation -> up/down + fallback
├─ realtime/useGame.ts    ├─ realtime/useGame.test.tsx # live game state
├─ screens/GamePlay.tsx   ├─ screens/GamePlay.test.tsx # /game/:id (replaces GameStub)
├─ screens/Leaderboard.tsx├─ screens/Leaderboard.test.tsx # /game/:id/results
├─ screens/CreateLobby.tsx (modify: duration picker)
├─ lib/lobby.ts (modify: createLobby gains duration)
└─ App.tsx (modify: routes)
```

---

## Task 1: Migration `0010_game_schema.sql` (columns, RLS, grants, publication)

**Files:** Create `supabase/migrations/0010_game_schema.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_game_schema.sql`:
```sql
-- SP3 game-loop schema: lobby timer columns, round combo/keywords, RLS on rounds/feedback.

alter table lobbies add column duration_seconds int not null default 300;
alter table lobbies add column turn_ends_at timestamptz;

alter table rounds add column combo_id bigint;
alter table rounds add column combo_kind text check (combo_kind in ('single','pair','triple'));
alter table rounds add column keywords text[];   -- resolved word text (client can't read lexicon)

-- feedback.combo_kind currently allows only pair|triple; easy mode needs 'single'.
alter table feedback drop constraint feedback_combo_kind_check;
alter table feedback add constraint feedback_combo_kind_check check (combo_kind in ('single','pair','triple'));

-- Per-turn length by mode (seconds). Server-authoritative; client mirrors for display only.
create function public.turn_len(p_mode text) returns int
  language sql immutable set search_path = '' as $$
  select case p_mode when 'easy' then 45 when 'medium' then 60 when 'hard' then 75 else 60 end;
$$;

-- Member-only reads; writes happen only through the SP3 RPCs.
alter table rounds enable row level security;
alter table feedback enable row level security;

create policy "members read rounds" on rounds for select
  using (public.is_lobby_member(lobby_id));
create policy "members read feedback" on feedback for select
  using (exists (select 1 from public.rounds r
                 where r.id = feedback.round_id and public.is_lobby_member(r.lobby_id)));

grant select on public.rounds to authenticated;
grant select on public.feedback to authenticated;

-- Realtime delivery of the live card. FULL replica identity so RLS can authorize UPDATEs
-- (outcome changes) on the changed row, not just the PK.
alter table public.rounds replica identity full;
alter publication supabase_realtime add table public.rounds;
```

- [ ] **Step 2: Apply**

Run: `npx supabase migration up`
Expected: `0010` applies, no error.

- [ ] **Step 3: Verify**

Run:
```bash
docker exec supabase_db_heartsup psql -U postgres -d postgres -c "
select column_name from information_schema.columns where table_name='lobbies' and column_name in ('duration_seconds','turn_ends_at') order by 1;
select column_name from information_schema.columns where table_name='rounds' and column_name in ('combo_id','combo_kind','keywords') order by 1;
select proname from pg_proc where proname='turn_len';
select policyname from pg_policies where tablename in ('rounds','feedback') order by 1;
select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='rounds';"
```
Expected: 2 lobby cols, 3 round cols, `turn_len`, 2 policies, `rounds` in publication.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0010_game_schema.sql
git commit -m "feat: game-loop schema (round/lobby columns, RLS, turn_len, realtime)"
```

---

## Task 2: Migration `0011_game_rpcs.sql` (game RPCs)

**Files:** Create `supabase/migrations/0011_game_rpcs.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_game_rpcs.sql`:
```sql
-- SP3 game-loop RPCs. All security definer, scoped to auth.uid()/membership.

-- create_lobby gains a host-picked total duration (3/5/10 min). Replaces the SP2 1-arg form.
drop function if exists public.create_lobby(text);
create function public.create_lobby(p_mode text, p_duration_seconds int default 300) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare v_code text; v_name text; v_avatar text; v_lobby uuid;
begin
  if p_mode not in ('easy','medium','hard') then raise exception 'invalid_mode'; end if;
  if p_duration_seconds not in (180, 300, 600) then raise exception 'invalid_duration'; end if;
  select current_game_code, display_name, avatar into v_code, v_name, v_avatar
    from public.profiles where id = auth.uid();
  if v_code is null then raise exception 'no_game_code'; end if;
  if exists (select 1 from public.lobbies where host_id = auth.uid() and status in ('waiting','playing')) then
    raise exception 'already_hosting';
  end if;
  insert into public.lobbies (code, host_id, mode, status, duration_seconds)
    values (v_code, auth.uid(), p_mode, 'waiting', p_duration_seconds) returning id into v_lobby;
  insert into public.lobby_players (lobby_id, profile_id, display_name, avatar)
    values (v_lobby, auth.uid(), v_name, v_avatar);
  return v_lobby;
end; $$;

-- Draw a card for the lobby's current guesser: random rating + a mode-appropriate keyword combo,
-- suppressing low coherence and combos used in this lobby's last 5 rounds. Resolves word text
-- into rounds.keywords (clients cannot read the lexicon tables). Returns the new round.
create function public.draw_card(p_lobby_id uuid) returns public.rounds
  language plpgsql security definer set search_path = '' as $$
declare v_mode text; v_player uuid; v_rating int;
        v_combo_id bigint; v_kind text; v_ids bigint[]; v_words text[];
        v_round public.rounds; v_floor real := 0.15;
begin
  select mode into v_mode from public.lobbies where id = p_lobby_id;
  select profile_id into v_player from public.lobby_players
    where lobby_id = p_lobby_id and is_current_turn limit 1;
  v_rating := floor(random() * 10)::int + 1;  -- 1..10

  if v_mode = 'easy' then
    v_kind := 'single';
    select w.id, array[w.id], array[w.word] into v_combo_id, v_ids, v_words
    from public.pos_words w
    where w.id not in (
      select r.combo_id from public.rounds r
      where r.lobby_id = p_lobby_id and r.combo_kind = 'single' and r.combo_id is not null
      order by r.id desc limit 5)
    order by random() limit 1;
  elsif v_mode = 'medium' then
    v_kind := 'pair';
    select s.id, array[s.a, s.b], array[s.wa, s.wb] into v_combo_id, v_ids, v_words
    from (
      select p.id, p.word_a_id a, p.word_b_id b, wa.word wa, wb.word wb
      from public.word_pairs p
      join public.pos_words wa on wa.id = p.word_a_id
      join public.pos_words wb on wb.id = p.word_b_id
      where p.coherence >= v_floor
        and p.id not in (
          select r.combo_id from public.rounds r
          where r.lobby_id = p_lobby_id and r.combo_kind = 'pair' and r.combo_id is not null
          order by r.id desc limit 5)
      order by p.coherence desc limit 50
    ) s order by random() limit 1;
  else
    v_kind := 'triple';
    select s.id, array[s.a, s.b, s.c], array[s.wa, s.wb, s.wc] into v_combo_id, v_ids, v_words
    from (
      select t.id, t.word_a_id a, t.word_b_id b, t.word_c_id c, wa.word wa, wb.word wb, wc.word wc
      from public.word_triples t
      join public.pos_words wa on wa.id = t.word_a_id
      join public.pos_words wb on wb.id = t.word_b_id
      join public.pos_words wc on wc.id = t.word_c_id
      where t.coherence >= v_floor
        and t.id not in (
          select r.combo_id from public.rounds r
          where r.lobby_id = p_lobby_id and r.combo_kind = 'triple' and r.combo_id is not null
          order by r.id desc limit 5)
      order by t.coherence desc limit 50
    ) s order by random() limit 1;
  end if;

  if v_combo_id is null then raise exception 'no_keywords_available'; end if;

  insert into public.rounds (lobby_id, player_id, rating, keyword_ids, combo_id, combo_kind, keywords)
    values (p_lobby_id, v_player, v_rating, v_ids, v_combo_id, v_kind, v_words)
    returning * into v_round;

  if v_kind = 'pair' then
    update public.word_pairs set times_shown = times_shown + 1 where id = v_combo_id;
  elsif v_kind = 'triple' then
    update public.word_triples set times_shown = times_shown + 1 where id = v_combo_id;
  end if;

  return v_round;
end; $$;

-- Host starts: timers + first guesser + first card. Replaces the SP2 start_game.
create or replace function public.start_game(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_mode text; v_dur int; v_first uuid;
begin
  select mode, duration_seconds into v_mode, v_dur from public.lobbies
    where id = p_lobby_id and host_id = auth.uid() and status = 'waiting';
  if not found then raise exception 'not_host_or_not_waiting'; end if;
  if (select count(*) from public.lobby_players where lobby_id = p_lobby_id) < 2 then
    raise exception 'not_enough_players';
  end if;
  select profile_id into v_first from public.lobby_players
    where lobby_id = p_lobby_id order by joined_at asc limit 1;
  update public.lobby_players set is_current_turn = (profile_id = v_first) where lobby_id = p_lobby_id;
  update public.lobbies
    set status = 'playing',
        game_ends_at = now() + make_interval(secs => v_dur),
        turn_ends_at = now() + make_interval(secs => public.turn_len(v_mode))
    where id = p_lobby_id;
  perform public.draw_card(p_lobby_id);
end; $$;

-- Guesser records a card outcome; scores, writes feedback, draws the next card. Returns new round.
create function public.submit_outcome(p_round_id bigint, p_outcome text) returns public.rounds
  language plpgsql security definer set search_path = '' as $$
declare v_lobby uuid; v_player uuid; v_combo_id bigint; v_kind text; v_status text;
begin
  if p_outcome not in ('guessed','passed') then raise exception 'invalid_outcome'; end if;
  select lobby_id, player_id, combo_id, combo_kind into v_lobby, v_player, v_combo_id, v_kind
    from public.rounds where id = p_round_id and outcome is null;
  if not found then raise exception 'round_closed'; end if;
  if v_player <> auth.uid() then raise exception 'not_your_turn'; end if;
  select status into v_status from public.lobbies where id = v_lobby;
  if v_status <> 'playing' then raise exception 'game_not_playing'; end if;

  update public.rounds set outcome = p_outcome, ended_at = now() where id = p_round_id;

  if p_outcome = 'guessed' then
    update public.lobby_players set score = score + 1
      where lobby_id = v_lobby and profile_id = v_player;
  end if;

  insert into public.feedback (round_id, combo_id, combo_kind, signal)
    values (p_round_id, v_combo_id, v_kind, case when p_outcome = 'guessed' then '+' else '-' end);

  if v_kind = 'pair' then
    update public.word_pairs
       set times_guessed = times_guessed + (case when p_outcome='guessed' then 1 else 0 end),
           times_passed  = times_passed  + (case when p_outcome='passed'  then 1 else 0 end)
     where id = v_combo_id;
  elsif v_kind = 'triple' then
    update public.word_triples
       set times_guessed = times_guessed + (case when p_outcome='guessed' then 1 else 0 end),
           times_passed  = times_passed  + (case when p_outcome='passed'  then 1 else 0 end)
     where id = v_combo_id;
  end if;

  return public.draw_card(v_lobby);
end; $$;

-- Rotate to the next guesser once the turn timer has elapsed (any member may trigger).
create function public.advance_turn(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_mode text; v_status text; v_turn_ends timestamptz; v_cur uuid; v_next uuid; v_cur_joined timestamptz;
begin
  if not public.is_lobby_member(p_lobby_id) then raise exception 'not_a_member'; end if;
  select mode, status, turn_ends_at into v_mode, v_status, v_turn_ends
    from public.lobbies where id = p_lobby_id;
  if v_status <> 'playing' then raise exception 'game_not_playing'; end if;
  if now() < v_turn_ends then raise exception 'turn_not_over'; end if;

  update public.rounds set outcome = 'passed', ended_at = now()
    where lobby_id = p_lobby_id and outcome is null;

  select profile_id into v_cur from public.lobby_players
    where lobby_id = p_lobby_id and is_current_turn limit 1;
  select joined_at into v_cur_joined from public.lobby_players
    where lobby_id = p_lobby_id and profile_id = v_cur;
  select profile_id into v_next from public.lobby_players
    where lobby_id = p_lobby_id and joined_at > v_cur_joined order by joined_at asc limit 1;
  if v_next is null then
    select profile_id into v_next from public.lobby_players
      where lobby_id = p_lobby_id order by joined_at asc limit 1;
  end if;

  update public.lobby_players set is_current_turn = (profile_id = v_next) where lobby_id = p_lobby_id;
  update public.lobbies set turn_ends_at = now() + make_interval(secs => public.turn_len(v_mode))
    where id = p_lobby_id;
  perform public.draw_card(p_lobby_id);
end; $$;

-- End the game once the total timer has elapsed. Idempotent; any member may call.
create function public.finish_game(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_status text; v_ends timestamptz;
begin
  if not public.is_lobby_member(p_lobby_id) then raise exception 'not_a_member'; end if;
  select status, game_ends_at into v_status, v_ends from public.lobbies where id = p_lobby_id;
  if v_status = 'playing' and now() >= v_ends then
    update public.rounds set outcome = 'passed', ended_at = now()
      where lobby_id = p_lobby_id and outcome is null;
    update public.lobbies set status = 'finished' where id = p_lobby_id;
  end if;
end; $$;

grant execute on function public.create_lobby(text, int)    to authenticated;
grant execute on function public.draw_card(uuid)            to authenticated;
grant execute on function public.start_game(uuid)           to authenticated;
grant execute on function public.submit_outcome(bigint, text) to authenticated;
grant execute on function public.advance_turn(uuid)         to authenticated;
grant execute on function public.finish_game(uuid)          to authenticated;
```

- [ ] **Step 2: Apply**

Run: `npx supabase migration up`
Expected: `0011` applies, no error.

- [ ] **Step 3: Smoke-verify the functions exist + a card draws**

Run:
```bash
docker exec -i supabase_db_heartsup psql -U postgres -d postgres <<'SQL'
do $$
declare h uuid := '00000000-0000-0000-0000-0000000000f1';
        g uuid := '00000000-0000-0000-0000-0000000000f2';
        v_lobby uuid; v_round public.rounds;
begin
  insert into auth.users (id) values (h),(g);
  update public.profiles set current_game_code='SMOKE1', display_name='H' where id=h;
  update public.profiles set display_name='G' where id=g;
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  v_lobby := public.create_lobby('medium', 300);
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  perform public.join_lobby('SMOKE1');
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  perform public.start_game(v_lobby);
  select * into v_round from public.rounds where lobby_id = v_lobby and outcome is null order by id desc limit 1;
  raise notice 'OK round: rating=% keywords=% kind=%', v_round.rating, v_round.keywords, v_round.combo_kind;
  delete from public.lobbies where id = v_lobby;
  delete from auth.users where id in (h,g);
end $$;
SQL
```
Expected: a `NOTICE` with a rating 1–10 and two keyword words for the `pair` (medium) mode; no error; rows cleaned up.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0011_game_rpcs.sql
git commit -m "feat: game-loop RPCs (draw_card, start/submit/advance/finish + create_lobby duration)"
```

---

## Task 3: Wire lobby duration through `lib/lobby.ts` + CreateLobby (TDD)

**Files:** Modify `src/lib/lobby.ts`, `src/screens/CreateLobby.tsx`, `src/screens/CreateLobby.test.tsx`, `supabase/tests/lobby.test.sql`

- [ ] **Step 1: Update the failing CreateLobby test**

Replace the body of the first test in `src/screens/CreateLobby.test.tsx` so it asserts a duration is passed (the picker defaults to 300). Replace this block:
```tsx
  it("creates a lobby with the chosen mode and navigates to the room", async () => {
    createLobby.mockResolvedValue("L9");
    render(<MemoryRouter><CreateLobby /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /medium/i }));
    await userEvent.click(screen.getByRole("button", { name: /create lobby/i }));
    expect(createLobby).toHaveBeenCalledWith("medium");
    expect(navigate).toHaveBeenCalledWith("/lobby/L9");
  });
```
with:
```tsx
  it("creates a lobby with the chosen mode + duration and navigates to the room", async () => {
    createLobby.mockResolvedValue("L9");
    render(<MemoryRouter><CreateLobby /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /medium/i }));
    await userEvent.click(screen.getByRole("button", { name: /create lobby/i }));
    expect(createLobby).toHaveBeenCalledWith("medium", 300);
    expect(navigate).toHaveBeenCalledWith("/lobby/L9");
  });
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- CreateLobby`
Expected: FAIL — called with `("medium")`, not `("medium", 300)`.

- [ ] **Step 3: Update `createLobby` in `lib/lobby.ts`**

Replace the `createLobby` function:
```ts
export async function createLobby(mode: LobbyMode, durationSeconds = 300): Promise<string> {
  const { data, error } = await supabase.rpc("create_lobby", { p_mode: mode, p_duration_seconds: durationSeconds });
  if (error) throwRpc(error);
  return data as string;
}
```

- [ ] **Step 4: Add a duration picker to `CreateLobby.tsx`**

In `src/screens/CreateLobby.tsx`, add a duration constant + state and pass it to `createLobby`. After the `MODES` constant add:
```tsx
const DURATIONS: { value: number; label: string }[] = [
  { value: 180, label: "3 min" },
  { value: 300, label: "5 min" },
  { value: 600, label: "10 min" },
];
```
Add state next to `mode`:
```tsx
  const [duration, setDuration] = useState(300);
```
Change the create call:
```tsx
      const id = await createLobby(mode, duration);
```
And render a duration row (mirrors the mode buttons) before the "Create lobby" button:
```tsx
      <div style={{ display: "flex", gap: tokens.space[2] }}>
        {DURATIONS.map((d) => (
          <button
            key={d.value}
            type="button"
            aria-pressed={duration === d.value}
            onClick={() => setDuration(d.value)}
            style={{
              padding: tokens.space[2],
              borderRadius: tokens.radius.md,
              border: duration === d.value ? `3px solid ${tokens.color.accent}` : "3px solid transparent",
              background: duration === d.value ? tokens.color.primary : "rgba(255,255,255,0.08)",
              color: tokens.color.text,
              fontFamily: tokens.font.family,
              fontWeight: tokens.font.weightBold,
              cursor: "pointer",
            }}
          >
            {d.label}
          </button>
        ))}
      </div>
```

- [ ] **Step 5: Fix the SP2 DB test call**

In `supabase/tests/lobby.test.sql`, the SP2 test calls `public.create_lobby('easy')` and `public.create_lobby('CAP...')`-style 1-arg calls. Update each `create_lobby('<mode>')` call to `create_lobby('<mode>', 300)` (two occurrences — the Block 1 host and the Block 2 host). Re-run to confirm it still passes:
```bash
docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/lobby.test.sql
```
Expected: the same `OK:` notices as before, no error (the 1-arg `create_lobby` no longer exists).

- [ ] **Step 6: Run (expect PASS) + build**

Run: `npm test -- CreateLobby && npm run build`
Expected: CreateLobby tests pass; build succeeds.

- [ ] **Step 7: Commit**
```bash
git add src/lib/lobby.ts src/screens/CreateLobby.tsx src/screens/CreateLobby.test.tsx supabase/tests/lobby.test.sql
git commit -m "feat: host-picked game duration on create_lobby"
```

---

## Task 4: `lib/game.ts` data access (TDD, mocked supabase)

**Files:** Create `src/lib/game.ts`, `src/lib/game.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/game.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const order = vi.fn();
const eqB = vi.fn(() => ({ order }));
const isFn = vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: maybeSingle })) })) }));
const eqA = vi.fn(() => ({ is: isFn }));
const select = vi.fn(() => ({ eq: (col: string) => (col === "lobby_id" ? eqA() : eqB()) }));
const from = vi.fn(() => ({ select }));
const maybeSingle = vi.fn();
const rpc = vi.fn();

vi.mock("./supabaseClient", () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}));

import { submitOutcome, advanceTurn, finishGame, gameErrorMessage, GameError } from "./game";

beforeEach(() => { vi.clearAllMocks(); });

describe("game data access", () => {
  it("submitOutcome calls the RPC and returns the next round", async () => {
    rpc.mockResolvedValue({ data: { id: 2, rating: 7, keywords: ["cat"], combo_kind: "single", outcome: null }, error: null });
    const r = await submitOutcome(1, "guessed");
    expect(rpc).toHaveBeenCalledWith("submit_outcome", { p_round_id: 1, p_outcome: "guessed" });
    expect(r?.rating).toBe(7);
  });
  it("advanceTurn and finishGame call their RPCs", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await advanceTurn("L1");
    expect(rpc).toHaveBeenCalledWith("advance_turn", { p_lobby_id: "L1" });
    await finishGame("L1");
    expect(rpc).toHaveBeenCalledWith("finish_game", { p_lobby_id: "L1" });
  });
  it("submitOutcome maps a known RPC error to a typed GameError", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "P0001: not_your_turn" } });
    await expect(submitOutcome(1, "guessed")).rejects.toMatchObject({ code: "not_your_turn" });
  });
  it("gameErrorMessage maps codes and falls back", () => {
    expect(gameErrorMessage(new GameError("turn_not_over", "x"))).toMatch(/turn isn.t over/i);
    expect(gameErrorMessage(new Error("boom"))).toMatch(/something went wrong/i);
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- src/lib/game`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/game.ts`:
```ts
import { supabase } from "./supabaseClient";

export type Outcome = "guessed" | "passed";
export type ComboKind = "single" | "pair" | "triple";

export interface Round {
  id: number;
  lobby_id: string;
  player_id: string;
  rating: number;
  keywords: string[];
  combo_id: number;
  combo_kind: ComboKind;
  outcome: Outcome | null;
}

export interface Score {
  profile_id: string;
  display_name: string | null;
  avatar: string | null;
  score: number;
  is_current_turn: boolean;
}

export class GameError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "GameError";
  }
}

const KNOWN_CODES = [
  "not_your_turn", "round_closed", "game_not_playing", "turn_not_over",
  "not_a_member", "no_keywords_available", "invalid_outcome",
];

function throwRpc(error: { message: string }): never {
  const found = KNOWN_CODES.find((c) => error.message.includes(c));
  throw new GameError(found ?? "game_error", error.message);
}

const MESSAGES: Record<string, string> = {
  not_your_turn: "It's not your turn.",
  round_closed: "That card was already answered.",
  game_not_playing: "This game isn't in progress.",
  turn_not_over: "The turn isn't over yet.",
  no_keywords_available: "Ran out of keyword combos — try another mode.",
};

export function gameErrorMessage(e: unknown): string {
  if (e instanceof GameError && MESSAGES[e.code]) return MESSAGES[e.code];
  return "Something went wrong. Please try again.";
}

export async function submitOutcome(roundId: number, outcome: Outcome): Promise<Round> {
  const { data, error } = await supabase.rpc("submit_outcome", { p_round_id: roundId, p_outcome: outcome });
  if (error) throwRpc(error);
  return data as Round;
}

export async function advanceTurn(lobbyId: string): Promise<void> {
  const { error } = await supabase.rpc("advance_turn", { p_lobby_id: lobbyId });
  if (error) throwRpc(error);
}

export async function finishGame(lobbyId: string): Promise<void> {
  const { error } = await supabase.rpc("finish_game", { p_lobby_id: lobbyId });
  if (error) throwRpc(error);
}

export async function getCurrentRound(lobbyId: string): Promise<Round | null> {
  const { data, error } = await supabase
    .from("rounds")
    .select("id, lobby_id, player_id, rating, keywords, combo_id, combo_kind, outcome")
    .eq("lobby_id", lobbyId)
    .is("outcome", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Round | null;
}

export async function getScores(lobbyId: string): Promise<Score[]> {
  const { data, error } = await supabase
    .from("lobby_players")
    .select("profile_id, display_name, avatar, score, is_current_turn")
    .eq("lobby_id", lobbyId)
    .order("score", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Score[];
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `npm test -- src/lib/game`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**
```bash
git add src/lib/game.ts src/lib/game.test.ts
git commit -m "feat: game data-access module + error mapping"
```

---

## Task 5: `tilt.ts` pure helper + `useTilt` hook (TDD)

**Files:** Create `src/lib/tilt.ts`, `src/lib/tilt.test.ts`, `src/hooks/useTilt.ts`, `src/hooks/useTilt.test.tsx`

- [ ] **Step 1: Write the failing pure-helper test**

Create `src/lib/tilt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tiltDirection } from "./tilt";

describe("tiltDirection", () => {
  it("returns 'up' when tilted well past the up threshold", () => {
    expect(tiltDirection(-60)).toBe("up");
  });
  it("returns 'down' when tilted well past the down threshold", () => {
    expect(tiltDirection(60)).toBe("down");
  });
  it("returns null inside the neutral dead-zone", () => {
    expect(tiltDirection(0)).toBeNull();
    expect(tiltDirection(20)).toBeNull();
    expect(tiltDirection(-20)).toBeNull();
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- src/lib/tilt`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tilt.ts`**

Create `src/lib/tilt.ts`:
```ts
// Map a DeviceOrientation beta angle (front/back tilt, degrees) to a gesture.
// The phone is held to the forehead in landscape; tilting the top away from the
// face (beta strongly positive) = "down"/pass, toward = "up"/correct. A wide
// dead-zone in the middle avoids accidental triggers.
export const TILT_UP_THRESHOLD = -45;   // beta below this => up (correct)
export const TILT_DOWN_THRESHOLD = 45;  // beta above this => down (pass)

export function tiltDirection(beta: number): "up" | "down" | null {
  if (beta <= TILT_UP_THRESHOLD) return "up";
  if (beta >= TILT_DOWN_THRESHOLD) return "down";
  return null;
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `npm test -- src/lib/tilt`
Expected: 3 tests pass.

- [ ] **Step 5: Write the failing hook test**

Create `src/hooks/useTilt.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTilt } from "./useTilt";

function fireBeta(beta: number) {
  const e = new Event("deviceorientation") as Event & { beta?: number };
  e.beta = beta;
  window.dispatchEvent(e);
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useTilt", () => {
  it("calls onUp once when tilted up, then re-arms after returning to neutral", () => {
    const onUp = vi.fn();
    const onDown = vi.fn();
    renderHook(() => useTilt({ enabled: true, onUp, onDown }));
    act(() => { fireBeta(-60); });
    expect(onUp).toHaveBeenCalledTimes(1);
    act(() => { fireBeta(-60); });           // still tilted: must not fire again
    expect(onUp).toHaveBeenCalledTimes(1);
    act(() => { fireBeta(0); });             // back to neutral re-arms
    act(() => { fireBeta(-60); });
    expect(onUp).toHaveBeenCalledTimes(2);
    expect(onDown).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onUp = vi.fn();
    renderHook(() => useTilt({ enabled: false, onUp, onDown: vi.fn() }));
    act(() => { fireBeta(-60); });
    expect(onUp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run (expect FAIL)**

Run: `npm test -- useTilt`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `useTilt.ts`**

Create `src/hooks/useTilt.ts`:
```ts
import { useEffect, useRef, useState, useCallback } from "react";
import { tiltDirection } from "../lib/tilt";

interface TiltOpts {
  enabled: boolean;
  onUp: () => void;
  onDown: () => void;
}

type PermissionState = "unknown" | "granted" | "denied" | "unsupported";

// iOS 13+ exposes DeviceOrientationEvent.requestPermission(); other browsers don't.
function needsPermission(): boolean {
  const E = (typeof window !== "undefined" ? (window as unknown as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent : undefined) as
    | { requestPermission?: () => Promise<"granted" | "denied"> }
    | undefined;
  return typeof E?.requestPermission === "function";
}

export function useTilt({ enabled, onUp, onDown }: TiltOpts) {
  const armed = useRef(true);
  const [permission, setPermission] = useState<PermissionState>(
    typeof window !== "undefined" && "DeviceOrientationEvent" in window ? "unknown" : "unsupported",
  );

  const requestPermission = useCallback(async () => {
    const E = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<"granted" | "denied"> } }).DeviceOrientationEvent;
    if (E?.requestPermission) {
      try { setPermission((await E.requestPermission()) === "granted" ? "granted" : "denied"); }
      catch { setPermission("denied"); }
    } else {
      setPermission("granted");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (needsPermission() && permission !== "granted") return; // wait for the gesture-driven grant
    const handler = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0;
      const dir = tiltDirection(beta);
      if (dir === null) { armed.current = true; return; }
      if (!armed.current) return;
      armed.current = false;
      if (dir === "up") onUp(); else onDown();
    };
    window.addEventListener("deviceorientation", handler);
    return () => window.removeEventListener("deviceorientation", handler);
  }, [enabled, permission, onUp, onDown]);

  return { permission, requestPermission, supported: permission !== "unsupported" };
}
```

- [ ] **Step 8: Run (expect PASS)**

Run: `npm test -- useTilt tilt`
Expected: all tilt + useTilt tests pass.

> Note: the hook test runs in jsdom where `DeviceOrientationEvent` exists but has no `requestPermission`, so `permission` starts `"unknown"`, `needsPermission()` is false, and the listener attaches immediately — matching the test.

- [ ] **Step 9: Commit**
```bash
git add src/lib/tilt.ts src/lib/tilt.test.ts src/hooks/useTilt.ts src/hooks/useTilt.test.tsx
git commit -m "feat: tilt detection (pure helper + useTilt hook)"
```

---

## Task 6: `useGame` realtime hook (TDD, mocked channel)

**Files:** Create `src/realtime/useGame.ts`, `src/realtime/useGame.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/realtime/useGame.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const getLobby = vi.fn();
const getCurrentRound = vi.fn();
const getScores = vi.fn();
vi.mock("../lib/lobby", () => ({ getLobby: (...a: unknown[]) => getLobby(...a) }));
vi.mock("../lib/game", () => ({
  getCurrentRound: (...a: unknown[]) => getCurrentRound(...a),
  getScores: (...a: unknown[]) => getScores(...a),
}));

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
const channel = {
  on(type: string, cfg: { table?: string }, cb: Handler) { handlers[`pg:${cfg.table}`] = cb; return channel; },
  subscribe(cb?: (s: string) => void) { cb?.("SUBSCRIBED"); return channel; },
};
const removeChannel = vi.fn();
vi.mock("../lib/supabaseClient", () => ({
  supabase: { channel: () => channel, removeChannel: (...a: unknown[]) => removeChannel(...a) },
}));

import { useGame } from "./useGame";

beforeEach(() => {
  vi.clearAllMocks();
  getLobby.mockResolvedValue({ id: "L1", status: "playing", mode: "easy", game_ends_at: "2030-01-01T00:00:00Z", turn_ends_at: "2030-01-01T00:00:30Z" });
  getCurrentRound.mockResolvedValue({ id: 5, lobby_id: "L1", player_id: "u1", rating: 7, keywords: ["cat"], combo_id: 3, combo_kind: "single", outcome: null });
  getScores.mockResolvedValue([
    { profile_id: "u1", display_name: "Q", avatar: "😀", score: 2, is_current_turn: true },
    { profile_id: "u2", display_name: "R", avatar: "🦄", score: 1, is_current_turn: false },
  ]);
});

describe("useGame", () => {
  it("loads game state and flags my turn", async () => {
    const { result } = renderHook(() => useGame("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe("playing");
    expect(result.current.currentRound?.rating).toBe(7);
    expect(result.current.isMyTurn).toBe(true);
    expect(result.current.currentGuesser?.display_name).toBe("Q");
    expect(result.current.scores).toHaveLength(2);
  });
  it("is not my turn for a different user", async () => {
    const { result } = renderHook(() => useGame("L1", "u2"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isMyTurn).toBe(false);
  });
  it("refetches when a rounds change arrives", async () => {
    const { result } = renderHook(() => useGame("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    getCurrentRound.mockResolvedValue({ id: 6, lobby_id: "L1", player_id: "u1", rating: 3, keywords: ["dog"], combo_id: 4, combo_kind: "single", outcome: null });
    act(() => { handlers["pg:rounds"](); });
    await waitFor(() => expect(result.current.currentRound?.rating).toBe(3));
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- useGame`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/realtime/useGame.ts`:
```ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getLobby, type Lobby } from "../lib/lobby";
import { getCurrentRound, getScores, type Round, type Score } from "../lib/game";

export interface GameState {
  loading: boolean;
  status: Lobby["status"] | null;
  lobby: Lobby | null;
  currentRound: Round | null;
  scores: Score[];
  isMyTurn: boolean;
  currentGuesser: Score | null;
  gameEndsAt: string | null;
  turnEndsAt: string | null;
}

export function useGame(lobbyId: string, selfId: string | undefined): GameState {
  const [loading, setLoading] = useState(true);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [scores, setScores] = useState<Score[]>([]);

  useEffect(() => {
    let active = true;
    const refetch = async () => {
      try {
        const [l, r, s] = await Promise.all([getLobby(lobbyId), getCurrentRound(lobbyId), getScores(lobbyId)]);
        if (!active) return;
        setLobby(l); setCurrentRound(r); setScores(s);
      } catch { /* transient; next event refetches */ }
    };
    (async () => { await refetch(); if (active) setLoading(false); })();

    const channel = supabase.channel(`game:${lobbyId}`);
    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: `lobby_id=eq.${lobbyId}` }, () => { void refetch(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` }, () => { void refetch(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "lobby_players", filter: `lobby_id=eq.${lobbyId}` }, () => { void refetch(); })
      .subscribe();

    return () => { active = false; void supabase.removeChannel(channel); };
  }, [lobbyId]);

  const currentGuesser = scores.find((s) => s.is_current_turn) ?? null;
  return {
    loading,
    status: lobby?.status ?? null,
    lobby,
    currentRound,
    scores,
    isMyTurn: !!selfId && currentGuesser?.profile_id === selfId,
    currentGuesser,
    gameEndsAt: lobby?.game_ends_at ?? null,
    turnEndsAt: lobby?.turn_ends_at ?? null,
  };
}
```

Note: `Lobby` needs `turn_ends_at`. In `src/lib/lobby.ts`, add `turn_ends_at: string | null;` to the `Lobby` interface and `, turn_ends_at` to the `getLobby` select list. (Do this as part of this task.)

- [ ] **Step 4: Run (expect PASS) + build**

Run: `npm test -- useGame && npm run build`
Expected: 3 tests pass; build succeeds.

- [ ] **Step 5: Commit**
```bash
git add src/realtime/useGame.ts src/realtime/useGame.test.tsx src/lib/lobby.ts
git commit -m "feat: useGame realtime hook + turn_ends_at on Lobby"
```

---

## Task 7: `GamePlay` screen (TDD)

**Files:** Create `src/screens/GamePlay.tsx`, `src/screens/GamePlay.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/screens/GamePlay.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { GameState } from "../realtime/useGame";

const useGame = vi.fn<() => GameState>();
const submitOutcome = vi.fn();
const advanceTurn = vi.fn();
const finishGame = vi.fn();
const navigate = vi.fn();
vi.mock("../realtime/useGame", () => ({ useGame: () => useGame() }));
vi.mock("../lib/game", async (orig) => ({ ...(await orig<typeof import("../lib/game")>()), submitOutcome: (...a: unknown[]) => submitOutcome(...a), advanceTurn: (...a: unknown[]) => advanceTurn(...a), finishGame: (...a: unknown[]) => finishGame(...a) }));
vi.mock("../hooks/useTilt", () => ({ useTilt: () => ({ permission: "granted", requestPermission: vi.fn(), supported: true }) }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ profile: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: "ABC234" } }) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate, useParams: () => ({ id: "L1" }) }));

import { GamePlay } from "./GamePlay";

const future = "2030-01-01T00:00:00Z";
function state(over: Partial<GameState>): GameState {
  return {
    loading: false, status: "playing", lobby: null,
    currentRound: { id: 5, lobby_id: "L1", player_id: "u1", rating: 7, keywords: ["cat"], combo_id: 3, combo_kind: "single", outcome: null },
    scores: [
      { profile_id: "u1", display_name: "Q", avatar: "😀", score: 2, is_current_turn: true },
      { profile_id: "u2", display_name: "R", avatar: "🦄", score: 1, is_current_turn: false },
    ],
    isMyTurn: true, currentGuesser: { profile_id: "u1", display_name: "Q", avatar: "😀", score: 2, is_current_turn: true },
    gameEndsAt: future, turnEndsAt: future, ...over,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("GamePlay", () => {
  it("guesser sees the rating + keyword and can mark correct", async () => {
    submitOutcome.mockResolvedValue({});
    useGame.mockReturnValue(state({ isMyTurn: true }));
    render(<MemoryRouter><GamePlay /></MemoryRouter>);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/cat/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /correct/i }));
    expect(submitOutcome).toHaveBeenCalledWith(5, "guessed");
  });
  it("guesser can pass", async () => {
    submitOutcome.mockResolvedValue({});
    useGame.mockReturnValue(state({ isMyTurn: true }));
    render(<MemoryRouter><GamePlay /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /pass/i }));
    expect(submitOutcome).toHaveBeenCalledWith(5, "passed");
  });
  it("spectator sees whose turn it is and the scores, not the card", () => {
    useGame.mockReturnValue(state({ isMyTurn: false, currentGuesser: { profile_id: "u2", display_name: "R", avatar: "🦄", score: 1, is_current_turn: true } }));
    render(<MemoryRouter><GamePlay /></MemoryRouter>);
    expect(screen.getByText(/R is guessing/i)).toBeInTheDocument();
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.getByText(/Q/)).toBeInTheDocument(); // scoreboard
  });
  it("navigates to results when the game is finished", () => {
    useGame.mockReturnValue(state({ status: "finished" }));
    render(<MemoryRouter><GamePlay /></MemoryRouter>);
    expect(navigate).toHaveBeenCalledWith("/game/L1/results", { replace: true });
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- GamePlay`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/screens/GamePlay.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { useAuth } from "../auth/useAuth";
import { useGame } from "../realtime/useGame";
import { useTilt } from "../hooks/useTilt";
import { submitOutcome, advanceTurn, finishGame, type Outcome } from "../lib/game";
import { tokens } from "../theme/tokens";

function secondsLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

export function GamePlay() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { loading, status, currentRound, scores, isMyTurn, currentGuesser, gameEndsAt, turnEndsAt } = useGame(id, profile?.id);
  const [, forceTick] = useState(0);

  // 1s ticker for the countdowns.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const submit = useCallback((o: Outcome) => {
    if (currentRound) submitOutcome(currentRound.id, o).catch(() => {});
  }, [currentRound]);

  const onUp = useCallback(() => submit("guessed"), [submit]);
  const onDown = useCallback(() => submit("passed"), [submit]);
  const { permission, requestPermission, supported } = useTilt({ enabled: isMyTurn && status === "playing", onUp, onDown });

  // Finished -> results.
  useEffect(() => {
    if (status === "finished") navigate(`/game/${id}/results`, { replace: true });
  }, [status, id, navigate]);

  // Client-driven, server-validated advancement.
  const gameLeft = secondsLeft(gameEndsAt);
  const turnLeft = secondsLeft(turnEndsAt);
  useEffect(() => {
    if (status !== "playing") return;
    if (gameLeft <= 0) { finishGame(id).catch(() => {}); return; }
    if (turnLeft <= 0 && isMyTurn) { advanceTurn(id).catch(() => {}); }
  }, [status, gameLeft, turnLeft, isMyTurn, id]);

  if (loading) return <ScreenBackground><p>Loading…</p></ScreenBackground>;

  return (
    <ScreenBackground>
      <div style={{ position: "absolute", top: tokens.space[3], right: tokens.space[4], fontWeight: tokens.font.weightBold }}>
        ⏱ {Math.floor(gameLeft / 60)}:{String(gameLeft % 60).padStart(2, "0")}
      </div>
      {isMyTurn ? (
        <>
          <p style={{ opacity: 0.7, margin: 0 }}>Your turn · {turnLeft}s</p>
          <div style={{ fontSize: 96, fontWeight: tokens.font.weightBold, color: tokens.color.accent, lineHeight: 1 }}>
            {currentRound?.rating}
          </div>
          <p style={{ fontSize: 28, fontWeight: tokens.font.weightBold }}>{currentRound?.keywords.join(" · ")}</p>
          {supported && permission !== "granted" ? (
            <Button onClick={requestPermission}>Enable tilt</Button>
          ) : null}
          <div style={{ display: "flex", gap: tokens.space[3] }}>
            <Button onClick={onUp} style={{ background: tokens.color.success }}>Correct ▲</Button>
            <Button onClick={onDown} style={{ background: tokens.color.danger }}>Pass ▼</Button>
          </div>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 32, margin: 0 }}>{currentGuesser?.display_name ?? "Someone"} is guessing…</h1>
          <p style={{ opacity: 0.7 }}>Give them clues!</p>
        </>
      )}
      <ul style={{ listStyle: "none", padding: 0, width: 260, display: "flex", flexDirection: "column", gap: tokens.space[1] }}>
        {scores.map((s) => (
          <li key={s.profile_id} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{s.avatar} {s.display_name ?? "Player"}</span>
            <span style={{ fontWeight: tokens.font.weightBold }}>{s.score}</span>
          </li>
        ))}
      </ul>
    </ScreenBackground>
  );
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `npm test -- GamePlay`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**
```bash
git add src/screens/GamePlay.tsx src/screens/GamePlay.test.tsx
git commit -m "feat: GamePlay screen (guesser + spectator, tilt/buttons, timers)"
```

---

## Task 8: `Leaderboard` screen (TDD)

**Files:** Create `src/screens/Leaderboard.tsx`, `src/screens/Leaderboard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/screens/Leaderboard.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getScores = vi.fn();
vi.mock("../lib/game", async (orig) => ({ ...(await orig<typeof import("../lib/game")>()), getScores: (...a: unknown[]) => getScores(...a) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useParams: () => ({ id: "L1" }) }));

import { Leaderboard } from "./Leaderboard";

beforeEach(() => { vi.clearAllMocks(); });

describe("Leaderboard", () => {
  it("shows players ranked by score with the winner first", async () => {
    getScores.mockResolvedValue([
      { profile_id: "u2", display_name: "R", avatar: "🦄", score: 5, is_current_turn: false },
      { profile_id: "u1", display_name: "Q", avatar: "😀", score: 3, is_current_turn: false },
    ]);
    render(<MemoryRouter><Leaderboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/winner/i)).toBeInTheDocument());
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("R");
    expect(items[0]).toHaveTextContent("5");
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- Leaderboard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/screens/Leaderboard.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { getScores, type Score } from "../lib/game";
import { tokens } from "../theme/tokens";

export function Leaderboard() {
  const { id = "" } = useParams();
  const [scores, setScores] = useState<Score[]>([]);

  useEffect(() => {
    let active = true;
    getScores(id).then((s) => { if (active) setScores(s); }).catch(() => {});
    return () => { active = false; };
  }, [id]);

  const ranked = [...scores].sort((a, b) => b.score - a.score);

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 36, margin: 0 }}>Time's up!</h1>
      {ranked[0] && <p style={{ color: tokens.color.accent, fontWeight: tokens.font.weightBold }}>🏆 Winner: {ranked[0].display_name ?? "Player"}</p>}
      <ul style={{ listStyle: "none", padding: 0, width: 280, display: "flex", flexDirection: "column", gap: tokens.space[2] }}>
        {ranked.map((s, i) => (
          <li key={s.profile_id} style={{ display: "flex", justifyContent: "space-between", fontWeight: i === 0 ? tokens.font.weightBold : 400 }}>
            <span>{i + 1}. {s.avatar} {s.display_name ?? "Player"}</span>
            <span>{s.score}</span>
          </li>
        ))}
      </ul>
      <Link to="/home"><Button>Home</Button></Link>
    </ScreenBackground>
  );
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `npm test -- Leaderboard`
Expected: test passes.

- [ ] **Step 5: Commit**
```bash
git add src/screens/Leaderboard.tsx src/screens/Leaderboard.test.tsx
git commit -m "feat: Leaderboard results screen"
```

---

## Task 9: Wire game routes (replace GameStub)

**Files:** Modify `src/App.tsx`, `src/App.test.tsx`; delete `src/screens/GameStub.tsx`

- [ ] **Step 1: Add a failing route test**

In `src/App.test.tsx`, inside the existing `describe("App routes", ...)`, add:
```tsx
  it("renders the results route for an authed, profiled user", () => {
    auth.mockReturnValue(base({ session: { user: { id: "u1" } } as never, profile: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: "ABC234" } }));
    render(<MemoryRouter initialEntries={["/game/L1/results"]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByText(/time's up/i)).toBeInTheDocument();
  });
```
(Note: `Leaderboard` calls `getScores`, which hits the mocked supabase client; in the App test environment the real `lib/game` runs against the real `supabaseClient`. To keep this test hermetic, mock `lib/game` at the top of `App.test.tsx`: add `vi.mock("./lib/game", () => ({ getScores: () => Promise.resolve([]) }));` near the other mocks. If `App.test.tsx` already mocks modules, place it alongside.)

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- App`
Expected: FAIL — `/game/L1/results` currently renders the catch-all/GameStub, no "Time's up".

- [ ] **Step 3: Update routes in `App.tsx`**

Replace the `GameStub` import:
```tsx
import { GameStub } from "./screens/GameStub";
```
with:
```tsx
import { GamePlay } from "./screens/GamePlay";
import { Leaderboard } from "./screens/Leaderboard";
```
Replace the game route:
```tsx
      <Route path="/game/:id" element={<RequireAuth><RequireProfile><GameStub /></RequireProfile></RequireAuth>} />
```
with:
```tsx
      <Route path="/game/:id" element={<RequireAuth><RequireProfile><GamePlay /></RequireProfile></RequireAuth>} />
      <Route path="/game/:id/results" element={<RequireAuth><RequireProfile><Leaderboard /></RequireProfile></RequireAuth>} />
```

- [ ] **Step 4: Delete the now-unused stub**

Run: `rm src/screens/GameStub.tsx`
(Confirm nothing else imports it: `grep -rn GameStub src` should return only removed references.)

- [ ] **Step 5: Run full suite + build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**
```bash
git add src/App.tsx src/App.test.tsx
git rm src/screens/GameStub.tsx
git commit -m "feat: wire GamePlay + Leaderboard routes, drop GameStub"
```

---

## Task 10: DB integration test for the game loop

**Files:** Create `supabase/tests/game.test.sql`

Role-aware (runs reads/writes as `authenticated` so RLS is real), mirrors `supabase/tests/lobby.test.sql`. Seeds two users, plays through, asserts scoring/feedback/rotation/finish + RLS.

- [ ] **Step 1: Write the script**

Create `supabase/tests/game.test.sql`:
```sql
-- DB integration assertions for the SP3 game loop. Run:
--   docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/game.test.sql
-- Runs as the authenticated role so RLS is enforced. Seeds/cleans up as superuser.

do $$
declare h uuid := '00000000-0000-0000-0000-0000000000c1';
        g uuid := '00000000-0000-0000-0000-0000000000c2';
        nm uuid := '00000000-0000-0000-0000-0000000000c3';
        v_lobby uuid; v_round public.rounds; v_next public.rounds; v_score int; v_fb int; v_seen int;
begin
  insert into auth.users (id) values (h),(g),(nm);
  update public.profiles set current_game_code='GAME01', display_name='H' where id=h;
  update public.profiles set display_name='G' where id=g;

  perform set_config('role','authenticated',true);

  -- create (medium = pairs), join, start
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  v_lobby := public.create_lobby('medium', 180);
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  perform public.join_lobby('GAME01');
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  perform public.start_game(v_lobby);

  select * into v_round from public.rounds where lobby_id=v_lobby and outcome is null order by id desc limit 1;
  if v_round.combo_kind <> 'pair' or array_length(v_round.keywords,1) <> 2 then
    raise exception 'expected a 2-word pair card, got kind=% kw=%', v_round.combo_kind, v_round.keywords;
  end if;
  if v_round.rating < 1 or v_round.rating > 10 then raise exception 'rating out of range: %', v_round.rating; end if;
  raise notice 'OK: start_game seats host and draws a pair card (rating %, words %)', v_round.rating, v_round.keywords;

  -- guesser scores; feedback + next card
  v_next := public.submit_outcome(v_round.id, 'guessed');
  select score into v_score from public.lobby_players where lobby_id=v_lobby and profile_id=h;
  if v_score <> 1 then raise exception 'expected host score 1, got %', v_score; end if;
  select count(*) into v_fb from public.feedback where round_id=v_round.id and signal='+';
  if v_fb <> 1 then raise exception 'expected one + feedback row'; end if;
  if v_next.id = v_round.id or v_next.outcome is not null then raise exception 'expected a fresh next card'; end if;
  raise notice 'OK: submit_outcome scores, writes feedback, draws next card';

  -- a non-guesser cannot submit
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  begin
    perform public.submit_outcome(v_next.id, 'guessed');
    raise exception 'expected not_your_turn';
  exception when others then
    if sqlerrm not like '%not_your_turn%' then raise; end if;
    raise notice 'OK: a non-guesser cannot submit (not_your_turn)';
  end;

  -- advance_turn rejected before the timer, allowed after
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  begin
    perform public.advance_turn(v_lobby);
    raise exception 'expected turn_not_over';
  exception when others then
    if sqlerrm not like '%turn_not_over%' then raise; end if;
    raise notice 'OK: advance_turn blocked before turn_ends_at';
  end;
  perform set_config('role','postgres',true);
  update public.lobbies set turn_ends_at = now() - interval '1 second' where id=v_lobby;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  perform public.advance_turn(v_lobby);
  if (select profile_id from public.lobby_players where lobby_id=v_lobby and is_current_turn) <> g then
    raise exception 'expected turn to rotate to guest';
  end if;
  raise notice 'OK: advance_turn rotates to the next player after the timer';

  -- RLS: a non-member cannot read the rounds
  perform set_config('request.jwt.claims', json_build_object('sub', nm)::text, true);
  select count(*) into v_seen from public.rounds where lobby_id=v_lobby;
  if v_seen <> 0 then raise exception 'RLS should hide rounds from a non-member, saw %', v_seen; end if;
  raise notice 'OK: RLS hides rounds from a non-member';

  -- finish after the game timer
  perform set_config('role','postgres',true);
  update public.lobbies set game_ends_at = now() - interval '1 second' where id=v_lobby;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  perform public.finish_game(v_lobby);
  if (select status from public.lobbies where id=v_lobby) <> 'finished' then
    raise exception 'expected status finished';
  end if;
  raise notice 'OK: finish_game ends the game after game_ends_at';

  perform set_config('role','postgres',true);
  delete from public.lobbies where id=v_lobby;
  delete from auth.users where id in (h,g,nm);
exception when others then
  perform set_config('role','postgres',true);
  delete from public.lobbies where host_id='00000000-0000-0000-0000-0000000000c1';
  delete from auth.users where id in ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3');
  raise;
end $$;
```

- [ ] **Step 2: Run**

Run: `docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/game.test.sql`
Expected: a series of `OK:` notices, no error. Confirm cleanup:
`docker exec supabase_db_heartsup psql -U postgres -d postgres -c "select count(*) from auth.users where id::text like '00000000-0000-0000-0000-0000000000c%';"` → `0`.

- [ ] **Step 3: Commit**
```bash
git add supabase/tests/game.test.sql
git commit -m "test: DB assertions for the game loop (scoring, feedback, rotation, finish, RLS)"
```

---

## Task 11: README + manual smoke walkthrough

**Files:** Modify `README.md`

- [ ] **Step 1: Document SP3**

READ `README.md`, update the intro line to include SP3, and append before `## Tests`:
```markdown
## Sub-project 3: Core Game Loop

From the lobby, the host starts a timed game. Turns rotate by join order; the active guesser's
phone shows a hidden 1–10 rating + keyword(s) (held to the forehead) and reads tilt — up = correct
(+1), down = pass — drawing card after card until the per-turn timer ends, then the turn rotates.
When the host-picked total timer runs out, everyone lands on the leaderboard. Game state lives in
`security definer` RPCs; the client never writes game tables. Keyword text is resolved server-side
into `rounds.keywords` (the lexicon tables aren't client-readable).

### Manual smoke test (two browser sessions)
1. Host: Play → Host a game → pick a mode + a short duration (3 min) → Create lobby.
2. Guest: join by code; host taps Start.
3. The guesser's screen shows a big rating + keyword(s); tap Correct/Pass (or tilt on a phone).
   Scores update live on both screens; the spectator sees "X is guessing".
4. When the timer expires, both land on the leaderboard with the winner highlighted.
```

- [ ] **Step 2: Run the full suite + build**

Run: `npm test && npm run build`
Expected: all pass.

- [ ] **Step 3: Commit**
```bash
git add README.md
git commit -m "docs: SP3 game loop + manual smoke walkthrough"
```

---

## Acceptance Criteria (Sub-project 3)

- [ ] Migrations `0010`/`0011` apply: lobby timer columns, round combo/keywords columns, RLS on rounds/feedback, `turn_len`, and the game RPCs; `create_lobby` takes a duration.
- [ ] `lib/game.ts`, `useTilt`/`tilt.ts`, `useGame`, `GamePlay`, `Leaderboard`, and the CreateLobby duration picker are unit-tested and passing.
- [ ] Routing: `/game/:id` → GamePlay (guesser vs spectator), `/game/:id/results` → Leaderboard; GameStub removed.
- [ ] Keyword draw respects mode, low-coherence suppression, and the per-lobby 5-round cooldown; words are resolved into `rounds.keywords`.
- [ ] DB integration test confirms scoring, feedback, turn rotation (after timer), finish (after timer), and RLS on rounds.
- [ ] `npm test` and `npm run build` pass.

## Out of scope (SP4 / later)

- Adaptive coherence re-computation from `feedback` (nudging `coherence`) → SP4.
- Full Figma UI/visual pass (landscape layouts, confetti, real assets) → after SP3.
