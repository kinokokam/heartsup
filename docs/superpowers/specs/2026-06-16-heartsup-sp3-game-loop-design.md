# heartsup Sub-project 3 — Core Game Loop — Design Spec

**Date:** 2026-06-16
**Status:** Approved
**Depends on:** SP0 (lexicon + coherence tables), SP1 (auth/profile), SP2 (lobby + realtime).
See [2026-06-15-heartsup-design.md](2026-06-15-heartsup-design.md) for the whole-system design,
and [2026-06-16-heartsup-sp2-lobby-design.md](2026-06-16-heartsup-sp2-lobby-design.md) for the
realtime/RPC patterns this builds on.

## 1. Goal

Make the lobby playable. From the host's "Start", the game rotates **timed turns**: the active
**guesser** holds their phone to their forehead and sees a hidden **1–10 rating + keyword(s)**;
friends improv a "you're a [rating]/10 but [keyword]…" scenario; the guesser registers **tilt up
= correct (+1)** / **tilt down = pass**, drawing card after card until their turn timer ends, then
the turn rotates. When the host-chosen total timer expires, everyone lands on a **leaderboard**.

State is server-authoritative (rounds, scores, whose turn) and synced via the SP2 realtime
groundwork (Postgres Changes + Presence). **SP3 ships functional/plain styling — the full Figma
UI/visual pass happens after SP3** (the app is landscape; exact palette already banked in
`tokens.ts`).

## 2. Decisions (locked)

| Concern | Decision |
|---|---|
| Turn structure | Rotating timed turns (Heads Up style); order = `lobby_players.joined_at`; one guesser active at a time |
| Per-turn length | By mode: **Easy 45s · Medium 60s · Hard 75s** |
| Game end | **Total game timer, host-picked at lobby create** (3 / 5 / 10 min); turns rotate until `game_ends_at`, then leaderboard |
| Tilt input | DeviceMotion behind a `useTilt()` hook (tilt up = correct, down = pass) + on-screen Correct/Pass fallback; handles iOS permission |
| Spectator view | Minimal: "X is guessing" + timer + live scores (no card shown — they read the guesser's forehead phone in person) |
| Rating | Random integer 1–10 per card |
| Keywords by mode | Easy = 1 word · Medium = verb+noun pair · Hard = adjective+noun+verb triple, drawn from the SP0 coherence/lexicon tables |
| Draw policy | Suppress very-low-coherence combos; per-lobby **5-round cooldown**; bias toward higher coherence with randomness |
| Card unit | One `rounds` row per card |
| Timer enforcement | Client-driven but **server-validated** (no daemon): active client calls `advance_turn` at turn end; any client calls `finish_game` once `game_ends_at` passes (idempotent); RPCs re-check deadlines server-side |
| Coherence learning | SP3 **writes** raw `feedback` + bumps combo counters; the adaptive coherence re-computation is **SP4** |

## 3. Game flow

```
host taps Start
  -> start_game: status 'playing', game_ends_at = now()+duration_seconds,
     earliest joined_at player = current guesser, turn_ends_at = now()+turnLen(mode),
     draw first card (rounds row: rating 1-10 + keyword combo)
  loop (per card):
     guesser's phone shows rating + keyword(s) big; reads tilt
       up   -> submit_outcome('guessed'): +1 guesser score, feedback '+', draw next card
       down -> submit_outcome('passed'):  feedback '-', draw next card
     when now() >= turn_ends_at:
       advance_turn -> is_current_turn moves to next joined_at (wraps), turn_ends_at reset,
                       draw their first card
  when now() >= game_ends_at:
     finish_game (idempotent) -> status 'finished'
  -> everyone navigates to leaderboard (final scores)
```

Spectators (not the current guesser) see "Cat is guessing…", the shared countdown, and the live
scoreboard. The guesser cannot see their own rating (phone is on their forehead); the rating +
keywords render large for the room to read.

## 4. Data model & server logic — migration `0010_game_loop.sql`

The `rounds` and `feedback` tables already exist (SP0 `0004_multiplayer.sql`). SP3 adds columns,
RLS, and RPCs.

**A. Column additions**
```sql
alter table lobbies add column duration_seconds int not null default 300; -- host-picked total
alter table lobbies add column turn_ends_at timestamptz;                    -- current turn deadline
```
`game_ends_at`, `status`, `mode` already exist on `lobbies`. `rounds` has
`(id, lobby_id, player_id, rating, keyword_ids[], outcome, started_at, ended_at)`. To link a card
to its coherence combo for feedback, SP3 also adds:
```sql
alter table rounds add column combo_id bigint;       -- word_pairs/word_triples id, or pos_words id
alter table rounds add column combo_kind text;        -- 'single' | 'pair' | 'triple'
```

**B. RLS (member-only reads; all writes via RPC), realtime publication**
```sql
alter table rounds   enable row level security;
alter table feedback enable row level security;
create policy "members read rounds" on rounds for select
  using (public.is_lobby_member(lobby_id));
-- feedback has no lobby_id; gate via its round
create policy "members read feedback" on feedback for select
  using (exists (select 1 from rounds r where r.id = feedback.round_id
                 and public.is_lobby_member(r.lobby_id)));
grant select on rounds, feedback to authenticated;
alter publication supabase_realtime add table public.rounds;
```
(`is_lobby_member()` is the SP2 security-definer helper from migration 0009.)

**C. RPCs** (`security definer set search_path = ''`, granted to `authenticated`):

- **`create_lobby(p_mode text, p_duration_seconds int)`** — extends the SP2 RPC to persist the
  host-chosen total duration on the lobby. (SP2 callers updated; default 300 if omitted.)

- **`draw_card(p_lobby_id uuid) returns rounds`** — internal helper callable by the current
  guesser / RPCs. Reads the lobby `mode`. Picks a random rating 1–10. Selects a keyword combo:
  - Easy → one `pos_words` row (`combo_kind='single'`).
  - Medium → one `word_pairs` row (`combo_kind='pair'`).
  - Hard → one `word_triples` row (`combo_kind='triple'`).
  Eligibility: exclude combos with `coherence` below a floor (suppression) and any `combo_id`
  used by this lobby's last 5 `rounds` (cooldown); order by `coherence desc` then random within a
  top window. Inserts a `rounds` row (`rating`, `keyword_ids[]`, `combo_id`, `combo_kind`,
  `started_at=now()`, `outcome=null`), bumps the combo's `times_shown`, returns the row.

- **`start_game(p_lobby_id uuid)`** — host-only, lobby must be `waiting` with ≥2 players (SP2
  guard kept). Sets `status='playing'`, `game_ends_at=now()+duration_seconds`, marks the earliest
  `joined_at` player `is_current_turn=true`, `turn_ends_at=now()+turnLen(mode)`, and calls
  `draw_card`.

- **`submit_outcome(p_round_id bigint, p_outcome text)`** — caller must be the round's
  `player_id` (current guesser) and the round must be open (`outcome is null`) and the game still
  `playing`. Sets `outcome`, `ended_at=now()`; if `guessed`, `+1` to the guesser's
  `lobby_players.score` and bump combo `times_guessed`; if `passed`, bump `times_passed`. Insert a
  `feedback` row (`round_id`, `combo_id`, `combo_kind`, `signal '+'/'-'`). Then `draw_card` for the
  same guesser and return the new round.

- **`advance_turn(p_lobby_id uuid)`** — only valid when `now() >= turn_ends_at` (server-checked).
  Moves `is_current_turn` to the next player by `joined_at` (wraps to first), resets
  `turn_ends_at=now()+turnLen(mode)`, closes any open round as `passed` (no feedback), draws the
  next guesser's first card.

- **`finish_game(p_lobby_id uuid)`** — idempotent; if `status='playing'` and `now() >=
  game_ends_at`, set `status='finished'` and close any open round. Safe to call from multiple
  clients (races converge).

`turnLen(mode)` mapping (Easy 45 / Medium 60 / Hard 75 s) lives in the RPCs (and mirrored as a
client constant for the countdown display only — the server is authoritative).

Stable error codes (mapped to friendly text client-side, like SP2): `not_your_turn`,
`round_closed`, `game_not_playing`, `turn_not_over`, `no_keywords_available`.

## 5. Client architecture

```
src/
├─ lib/game.ts            # ONLY module issuing game DB/RPC calls (startGame already in lobby.ts; new: submitOutcome, advanceTurn, finishGame, getCurrentRound, getScores) + Round/Score types + error mapping
├─ realtime/useGame.ts    # subscribes to rounds + lobbies + lobby_players; derives game state
├─ hooks/useTilt.ts       # DeviceMotion -> 'up'|'down'; on-screen fallback; iOS permission gate
├─ screens/GamePlay.tsx   # /game/:id — guesser vs spectator branches (replaces GameStub)
└─ screens/Leaderboard.tsx# /game/:id/results — final ranked scores
```

**Boundaries (mirroring SP1/SP2):**
- `lib/game.ts` is the only module issuing game RPC/DB calls. RPC errors → typed `GameError` +
  `gameErrorMessage`.
- `useGame(lobbyId, selfId)` owns the realtime subscription (extends the SP2 `useLobby` pattern):
  subscribes to `rounds` (current open card), `lobbies` (status, `game_ends_at`, `turn_ends_at`),
  and `lobby_players` (scores, `is_current_turn`). Exposes
  `{ loading, status, currentRound, isMyTurn, currentGuesser, scores, gameEndsAt, turnEndsAt }`.
- `useTilt({ onUp, onDown, enabled })` — wraps `DeviceMotionEvent`/`deviceorientation`; thresholds
  on beta (front/back tilt); exposes `requestPermission()` for iOS 13+ and a `supported` flag so
  the UI can show fallback buttons when motion is unavailable or denied.
- Screens are presentational: read `useAuth()` + `useGame()` + `useTilt()`, call `lib/game.ts`.

**GamePlay** branches on `isMyTurn`:
- Guesser: large rating + keyword(s); tilt up/down active; on-screen "Correct"/"Pass" fallback
  buttons; per-turn countdown.
- Spectator: "{guesser} is guessing…", shared countdown, live scoreboard.
- Drives advancement: when the local turn countdown reaches 0 and it's my turn → `advanceTurn`;
  when the game countdown reaches 0 → `finishGame` (any client). On `status='finished'` →
  navigate to `/game/:id/results`.

**Leaderboard** shows players ranked by score (ties broken by `joined_at`), highlights the winner,
and offers "Back to lobby" (host can host again) / "Home".

**CreateLobby** (SP2) gains a duration picker (3 / 5 / 10 min) passed to `createLobby(mode, secs)`.

## 6. Tilt detection

- `DeviceMotionEvent` / `deviceorientation`: read `beta` (x-axis tilt). Define thresholds: tilting
  the top of the phone away (forehead "nod down" = pass) vs toward (lift up = correct), with a
  neutral dead-zone and debounce so one gesture fires once. Exact thresholds tuned during build.
- iOS 13+ requires `DeviceMotionEvent.requestPermission()` from a user gesture — triggered by a
  "Start guessing" tap on the guesser's screen.
- When motion is unsupported/denied (desktop, permission off), show on-screen **Correct** / **Pass**
  buttons. The buttons and tilt both call the same `submit_outcome` path.

## 7. Testing

- **Unit (Vitest, mocked):** `lib/game.ts` (each fn → right RPC, error mapping); `useGame` state
  derivation (current round, isMyTurn, scores, status transitions) with a mocked channel like
  `useLobby.test`; `useTilt` (beta thresholds → up/down, dead-zone, fallback when unsupported).
- **Screen tests:** GamePlay guesser branch (shows rating+keyword, tilt/button → `submitOutcome`),
  spectator branch (shows "X is guessing" + scores, no card), navigation to results on
  `finished`; Leaderboard ranking + winner highlight; CreateLobby duration passed through.
- **DB integration (role-aware, live local DB):** `draw_card` returns a valid combo for each mode,
  respects the 5-round cooldown and low-coherence suppression; `submit_outcome` scores + writes
  feedback + bumps counters + draws next; `advance_turn` only after `turn_ends_at` and rotates
  correctly (wraps); `finish_game` idempotent + only after `game_ends_at`; RLS blocks a non-member
  from reading `rounds`/`feedback`.
- **Manual smoke (documented in plan):** two browser sessions — host creates with a short
  duration, both join, host starts, take turns (tilt or buttons), scores update live on both, timer
  expiry → leaderboard.

## 8. Out of scope / later

- Adaptive coherence re-computation from `feedback` (nudging `coherence`, decay, suppression
  thresholds) → **SP4**.
- Full Figma UI/visual pass (landscape layouts, confetti, pennant buttons, real assets) → after
  SP3, one coherent sweep.
- Mid-game reconnect/disconnect handling beyond what realtime + the idempotent RPCs give for free.
- Per-turn "ready/handoff" ceremony, animations, sound.
