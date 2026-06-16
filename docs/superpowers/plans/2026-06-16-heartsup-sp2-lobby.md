# heartsup Sub-project 2 — Lobby & Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the lobby/waiting-room layer — host or join a lobby by code, a live roster with online status, and a host "Start game" that transitions everyone — on top of SP1 auth/profile.

**Architecture:** All lobby mutations go through `security definer` Postgres RPCs (clients never write the tables); member-only RLS gates reads. A `lib/lobby.ts` module is the sole caller of those RPCs/queries. A `useLobby(lobbyId)` hook owns the realtime subscription (Postgres Changes for the authoritative roster/status + Supabase Presence for online/offline). Screens are presentational. Player name/avatar are snapshotted onto `lobby_players` at join so the roster needs no cross-user `profiles` read.

**Tech Stack:** React 19, react-router-dom v7, `@supabase/supabase-js` v2 (Realtime channels + Presence), Vitest 4 + Testing Library + `user-event`, local Supabase (Postgres + Realtime, API `54421`, DB container `supabase_db_heartsup`).

> **Environment notes for executors:**
> - Local Supabase: API `54421`, DB `54422`, Studio `54423`, Mailpit `54424`. Repo-root `.env` holds `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.
> - DB verification: `docker exec supabase_db_heartsup psql -U postgres -d postgres -c "<sql>"`.
> - Tables `lobbies`/`lobby_players`/`profiles` already exist (SP0 `0004_multiplayer.sql`). SP1 added profiles RLS + game-code RPCs (migrations `0006`/`0007`).
> - Vitest 4 mock typing: use `vi.fn<() => T>()` (single generic), never the old `vi.fn<[], T>()`.
> - The full suite + `npm run build` (`tsc -b && vite build`) currently pass — keep them green after every task.

---

## File Structure

```
src/
├─ lib/
│  └─ lobby.ts                 # ONLY module issuing lobby DB/RPC calls + error-message mapping
│  └─ lobby.test.ts
├─ realtime/
│  ├─ useLobby.ts              # subscription hook: Postgres Changes + Presence -> { lobby, players, onlineIds }
│  └─ useLobby.test.tsx
├─ screens/
│  ├─ PlayMenu.tsx             ├─ CreateLobby.tsx   ├─ JoinLobby.tsx   ├─ LobbyRoom.tsx   └─ GameStub.tsx
│  ├─ CreateLobby.test.tsx     ├─ JoinLobby.test.tsx   └─ LobbyRoom.test.tsx
├─ App.tsx                     # + /play, /lobby/new, /lobby/join, /lobby/:id, /game/:id routes
├─ App.test.tsx                # + a /play route test
└─ screens/Home.tsx            # "Play" becomes an enabled link to /play
supabase/migrations/0008_lobby_rpcs.sql
supabase/tests/lobby.test.sql
```

---

## Task 1: Migration `0008_lobby_rpcs.sql` (RLS, RPCs, realtime publication)

**Files:**
- Create: `supabase/migrations/0008_lobby_rpcs.sql`

- [ ] **Step 1: Confirm the live table shapes before writing**

Run:
```bash
docker exec supabase_db_heartsup psql -U postgres -d postgres -c "\d lobbies" -c "\d lobby_players"
```
Expected: `lobbies(id,code,host_id,mode,status,game_ends_at,created_at)` with `code` carrying a unique constraint `lobbies_code_key`; `lobby_players(lobby_id,profile_id,joined_at,score,is_current_turn)` with PK `(lobby_id,profile_id)`. If the unique constraint has a different name, note it and use the actual name in Step 2's `drop constraint`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0008_lobby_rpcs.sql`:
```sql
-- SP2: lobby RLS (member-only reads), name/avatar snapshot columns, RPCs, realtime.

-- Codes only need to be unique among joinable (active) lobbies, not finished ones,
-- so a host can re-use their personal code across sessions. Replace the full-unique
-- constraint with a partial unique index.
alter table lobbies drop constraint lobbies_code_key;
create unique index lobbies_active_code_uniq on lobbies (code)
  where status in ('waiting', 'playing');

-- Snapshot the player's name/avatar onto the roster row at join time, so the roster
-- renders without a cross-user read of profiles (profiles RLS stays owner-only).
alter table lobby_players add column display_name text;
alter table lobby_players add column avatar text;

-- Member-only reads. No client insert/update/delete — all writes go through the RPCs below.
alter table lobbies enable row level security;
alter table lobby_players enable row level security;

create policy "members read lobby" on lobbies for select
  using (exists (select 1 from lobby_players lp
                 where lp.lobby_id = lobbies.id and lp.profile_id = auth.uid()));

create policy "members read roster" on lobby_players for select
  using (exists (select 1 from lobby_players self
                 where self.lobby_id = lobby_players.lobby_id and self.profile_id = auth.uid()));

-- Create a lobby using the caller's current personal game code as the lobby code.
create function create_lobby(p_mode text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare v_code text; v_name text; v_avatar text; v_lobby uuid;
begin
  if p_mode not in ('easy','medium','hard') then
    raise exception 'invalid_mode';
  end if;
  select current_game_code, display_name, avatar
    into v_code, v_name, v_avatar
    from public.profiles where id = auth.uid();
  if v_code is null then
    raise exception 'no_game_code';
  end if;
  if exists (select 1 from public.lobbies
             where host_id = auth.uid() and status in ('waiting','playing')) then
    raise exception 'already_hosting';
  end if;
  insert into public.lobbies (code, host_id, mode, status)
    values (v_code, auth.uid(), p_mode, 'waiting')
    returning id into v_lobby;
  insert into public.lobby_players (lobby_id, profile_id, display_name, avatar)
    values (v_lobby, auth.uid(), v_name, v_avatar);
  return v_lobby;
end; $$;

-- Resolve a waiting lobby by code and add the caller (idempotent; capped at 8).
create function join_lobby(p_code text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare v_lobby uuid; v_count int; v_name text; v_avatar text;
begin
  select id into v_lobby from public.lobbies
    where code = upper(trim(p_code)) and status = 'waiting';
  if v_lobby is null then
    raise exception 'lobby_not_found';
  end if;
  if exists (select 1 from public.lobby_players
             where lobby_id = v_lobby and profile_id = auth.uid()) then
    return v_lobby; -- already a member
  end if;
  select count(*) into v_count from public.lobby_players where lobby_id = v_lobby;
  if v_count >= 8 then
    raise exception 'lobby_full';
  end if;
  select display_name, avatar into v_name, v_avatar
    from public.profiles where id = auth.uid();
  insert into public.lobby_players (lobby_id, profile_id, display_name, avatar)
    values (v_lobby, auth.uid(), v_name, v_avatar);
  return v_lobby;
end; $$;

-- Host leaving closes the lobby; a guest leaving removes only their row.
create function leave_lobby(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.lobbies
             where id = p_lobby_id and host_id = auth.uid()) then
    update public.lobbies set status = 'finished' where id = p_lobby_id;
  else
    delete from public.lobby_players
      where lobby_id = p_lobby_id and profile_id = auth.uid();
  end if;
end; $$;

-- Host-only start; requires >=2 players and a waiting lobby.
create function start_game(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if not exists (select 1 from public.lobbies
                 where id = p_lobby_id and host_id = auth.uid() and status = 'waiting') then
    raise exception 'not_host_or_not_waiting';
  end if;
  select count(*) into v_count from public.lobby_players where lobby_id = p_lobby_id;
  if v_count < 2 then
    raise exception 'not_enough_players';
  end if;
  update public.lobbies set status = 'playing' where id = p_lobby_id;
end; $$;

grant execute on function create_lobby(text) to authenticated;
grant execute on function join_lobby(text)   to authenticated;
grant execute on function leave_lobby(uuid)  to authenticated;
grant execute on function start_game(uuid)   to authenticated;

-- Realtime: publish roster + lobby row changes so clients get live updates.
alter publication supabase_realtime add table public.lobby_players;
alter publication supabase_realtime add table public.lobbies;
```

- [ ] **Step 3: Apply the migration**

Run:
```bash
npx supabase migration up
```
Expected: `0008` applies with no error.

- [ ] **Step 4: Verify objects**

Run:
```bash
docker exec supabase_db_heartsup psql -U postgres -d postgres -c "
select proname from pg_proc where proname in ('create_lobby','join_lobby','leave_lobby','start_game') order by proname;
select policyname from pg_policies where tablename in ('lobbies','lobby_players') order by policyname;
select indexname from pg_indexes where indexname='lobbies_active_code_uniq';
select column_name from information_schema.columns where table_name='lobby_players' and column_name in ('display_name','avatar') order by column_name;
select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename in ('lobbies','lobby_players') order by tablename;"
```
Expected: 4 functions; 2 policies; the partial index; both new columns; both tables in the publication.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_lobby_rpcs.sql
git commit -m "feat: lobby RLS + create/join/leave/start RPCs + realtime publication"
```

---

## Task 2: `lib/lobby.ts` data access (TDD, mocked supabase)

**Files:**
- Create: `src/lib/lobby.ts`, `src/lib/lobby.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/lobby.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const order = vi.fn();
const eq2 = vi.fn(() => ({ order }));
const maybeSingle = vi.fn();
const eq1 = vi.fn(() => ({ maybeSingle }));
const select = vi.fn((cols: string) => (cols.includes("game_ends_at") ? { eq: eq1 } : { eq: eq2 }));
const from = vi.fn(() => ({ select }));
const rpc = vi.fn();

vi.mock("./supabaseClient", () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}));

import {
  createLobby, joinLobby, leaveLobby, startGame, getLobby, getLobbyPlayers,
  lobbyErrorMessage, LobbyError,
} from "./lobby";

beforeEach(() => { vi.clearAllMocks(); });

describe("lobby data access", () => {
  it("createLobby calls the RPC with the mode and returns the id", async () => {
    rpc.mockResolvedValue({ data: "L1", error: null });
    const id = await createLobby("medium");
    expect(rpc).toHaveBeenCalledWith("create_lobby", { p_mode: "medium" });
    expect(id).toBe("L1");
  });
  it("joinLobby calls the RPC with the code and returns the id", async () => {
    rpc.mockResolvedValue({ data: "L2", error: null });
    const id = await joinLobby("ABC234");
    expect(rpc).toHaveBeenCalledWith("join_lobby", { p_code: "ABC234" });
    expect(id).toBe("L2");
  });
  it("joinLobby maps a known RPC error to a typed LobbyError", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'P0001: lobby_full' } });
    await expect(joinLobby("ABC234")).rejects.toMatchObject({ code: "lobby_full" });
  });
  it("leaveLobby and startGame call their RPCs", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await leaveLobby("L1");
    expect(rpc).toHaveBeenCalledWith("leave_lobby", { p_lobby_id: "L1" });
    await startGame("L1");
    expect(rpc).toHaveBeenCalledWith("start_game", { p_lobby_id: "L1" });
  });
  it("getLobby reads the row by id", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "waiting", game_ends_at: null }, error: null });
    const l = await getLobby("L1");
    expect(from).toHaveBeenCalledWith("lobbies");
    expect(l?.status).toBe("waiting");
  });
  it("getLobbyPlayers returns rows ordered by joined_at", async () => {
    order.mockResolvedValue({ data: [
      { lobby_id: "L1", profile_id: "u1", joined_at: "t1", score: 0, display_name: "Q", avatar: "😀" },
    ], error: null });
    const rows = await getLobbyPlayers("L1");
    expect(from).toHaveBeenCalledWith("lobby_players");
    expect(order).toHaveBeenCalledWith("joined_at", { ascending: true });
    expect(rows[0].display_name).toBe("Q");
  });
  it("lobbyErrorMessage maps codes to friendly text and falls back", () => {
    expect(lobbyErrorMessage(new LobbyError("lobby_not_found", "x"))).toMatch(/no game/i);
    expect(lobbyErrorMessage(new Error("boom"))).toMatch(/something went wrong/i);
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- src/lib/lobby`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/lobby.ts`:
```ts
import { supabase } from "./supabaseClient";

export type LobbyStatus = "waiting" | "playing" | "finished";
export type LobbyMode = "easy" | "medium" | "hard";

export interface Lobby {
  id: string;
  code: string;
  host_id: string;
  mode: LobbyMode;
  status: LobbyStatus;
  game_ends_at: string | null;
}

export interface LobbyPlayer {
  lobby_id: string;
  profile_id: string;
  joined_at: string;
  score: number;
  display_name: string | null;
  avatar: string | null;
}

export class LobbyError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LobbyError";
  }
}

const KNOWN_CODES = [
  "lobby_not_found", "lobby_full", "not_enough_players",
  "no_game_code", "already_hosting", "invalid_mode", "not_host_or_not_waiting",
];

function throwRpc(error: { message: string }): never {
  const found = KNOWN_CODES.find((c) => error.message.includes(c));
  throw new LobbyError(found ?? "lobby_error", error.message);
}

const MESSAGES: Record<string, string> = {
  lobby_not_found: "No game found with that code.",
  lobby_full: "That lobby is full (8 players max).",
  not_enough_players: "You need at least 2 players to start.",
  no_game_code: "You need a game code first — try logging out and back in.",
  already_hosting: "You're already hosting a game.",
};

export function lobbyErrorMessage(e: unknown): string {
  if (e instanceof LobbyError && MESSAGES[e.code]) return MESSAGES[e.code];
  return "Something went wrong. Please try again.";
}

export async function createLobby(mode: LobbyMode): Promise<string> {
  const { data, error } = await supabase.rpc("create_lobby", { p_mode: mode });
  if (error) throwRpc(error);
  return data as string;
}

export async function joinLobby(code: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_lobby", { p_code: code });
  if (error) throwRpc(error);
  return data as string;
}

export async function leaveLobby(lobbyId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_lobby", { p_lobby_id: lobbyId });
  if (error) throwRpc(error);
}

export async function startGame(lobbyId: string): Promise<void> {
  const { error } = await supabase.rpc("start_game", { p_lobby_id: lobbyId });
  if (error) throwRpc(error);
}

export async function getLobby(lobbyId: string): Promise<Lobby | null> {
  const { data, error } = await supabase
    .from("lobbies")
    .select("id, code, host_id, mode, status, game_ends_at")
    .eq("id", lobbyId)
    .maybeSingle();
  if (error) throw error;
  return data as Lobby | null;
}

export async function getLobbyPlayers(lobbyId: string): Promise<LobbyPlayer[]> {
  const { data, error } = await supabase
    .from("lobby_players")
    .select("lobby_id, profile_id, joined_at, score, display_name, avatar")
    .eq("lobby_id", lobbyId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LobbyPlayer[];
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `npm test -- src/lib/lobby`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lobby.ts src/lib/lobby.test.ts
git commit -m "feat: lobby data-access module + error mapping"
```

---

## Task 3: `useLobby` realtime hook (TDD, mocked channel)

**Files:**
- Create: `src/realtime/useLobby.ts`, `src/realtime/useLobby.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/realtime/useLobby.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const getLobby = vi.fn();
const getLobbyPlayers = vi.fn();
vi.mock("../lib/lobby", () => ({
  getLobby: (...a: unknown[]) => getLobby(...a),
  getLobbyPlayers: (...a: unknown[]) => getLobbyPlayers(...a),
}));

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
let presence: Record<string, Array<{ profile_id: string }>> = {};
const track = vi.fn(() => Promise.resolve());
const channel = {
  on(type: string, cfg: { table?: string }, cb: Handler) {
    handlers[type === "presence" ? "presence" : `pg:${cfg.table}`] = cb;
    return channel;
  },
  subscribe(cb?: (s: string) => void) { cb?.("SUBSCRIBED"); return channel; },
  track,
  presenceState: () => presence,
};
const removeChannel = vi.fn();
vi.mock("../lib/supabaseClient", () => ({
  supabase: { channel: () => channel, removeChannel: (...a: unknown[]) => removeChannel(...a) },
}));

import { useLobby } from "./useLobby";

beforeEach(() => {
  vi.clearAllMocks();
  presence = {};
  getLobby.mockResolvedValue({ id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "waiting", game_ends_at: null });
  getLobbyPlayers.mockResolvedValue([{ lobby_id: "L1", profile_id: "u1", joined_at: "t1", score: 0, display_name: "Q", avatar: "😀" }]);
});

describe("useLobby", () => {
  it("loads the initial lobby + roster and tracks presence", async () => {
    const { result } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lobby?.status).toBe("waiting");
    expect(result.current.players).toHaveLength(1);
    expect(track).toHaveBeenCalledWith({ profile_id: "u1" });
  });

  it("refetches the roster on a lobby_players change", async () => {
    const { result } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    getLobbyPlayers.mockResolvedValue([
      { lobby_id: "L1", profile_id: "u1", joined_at: "t1", score: 0, display_name: "Q", avatar: "😀" },
      { lobby_id: "L1", profile_id: "u2", joined_at: "t2", score: 0, display_name: "R", avatar: "🦄" },
    ]);
    act(() => { handlers["pg:lobby_players"](); });
    await waitFor(() => expect(result.current.players).toHaveLength(2));
  });

  it("reflects presence sync into onlineIds", async () => {
    const { result } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    presence = { u1: [{ profile_id: "u1" }], u2: [{ profile_id: "u2" }] };
    act(() => { handlers["presence"](); });
    await waitFor(() => expect(result.current.onlineIds.has("u2")).toBe(true));
  });

  it("refetches the lobby on a lobbies change (status -> playing)", async () => {
    const { result } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    getLobby.mockResolvedValue({ id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "playing", game_ends_at: null });
    act(() => { handlers["pg:lobbies"](); });
    await waitFor(() => expect(result.current.lobby?.status).toBe("playing"));
  });

  it("removes the channel on unmount", async () => {
    const { result, unmount } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- useLobby`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/realtime/useLobby.ts`:
```ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getLobby, getLobbyPlayers, type Lobby, type LobbyPlayer } from "../lib/lobby";

export interface LobbyState {
  loading: boolean;
  lobby: Lobby | null;
  players: LobbyPlayer[];
  onlineIds: Set<string>;
}

export function useLobby(lobbyId: string, selfId: string | undefined): LobbyState {
  const [loading, setLoading] = useState(true);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    const refetchRoster = async () => {
      try { const rows = await getLobbyPlayers(lobbyId); if (active) setPlayers(rows); }
      catch { /* transient; next event will refetch */ }
    };
    const refetchLobby = async () => {
      try { const l = await getLobby(lobbyId); if (active) setLobby(l); }
      catch { /* transient */ }
    };

    (async () => {
      try {
        const [l, rows] = await Promise.all([getLobby(lobbyId), getLobbyPlayers(lobbyId)]);
        if (!active) return;
        setLobby(l);
        setPlayers(rows);
      } finally {
        if (active) setLoading(false);
      }
    })();

    const channel = supabase
      .channel(`lobby:${lobbyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lobby_players", filter: `lobby_id=eq.${lobbyId}` }, () => { void refetchRoster(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` }, () => { void refetchLobby(); })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, Array<{ profile_id?: string }>>;
        const ids = new Set<string>();
        for (const metas of Object.values(state)) for (const m of metas) if (m.profile_id) ids.add(m.profile_id);
        if (active) setOnlineIds(ids);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && selfId) void channel.track({ profile_id: selfId });
      });

    return () => { active = false; void supabase.removeChannel(channel); };
  }, [lobbyId, selfId]);

  return { loading, lobby, players, onlineIds };
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `npm test -- useLobby`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/realtime/useLobby.ts src/realtime/useLobby.test.tsx
git commit -m "feat: useLobby realtime hook (Postgres Changes + Presence)"
```

---

## Task 4: PlayMenu, CreateLobby, JoinLobby screens (TDD)

**Files:**
- Create: `src/screens/PlayMenu.tsx`, `src/screens/CreateLobby.tsx`, `src/screens/JoinLobby.tsx`
- Create: `src/screens/CreateLobby.test.tsx`, `src/screens/JoinLobby.test.tsx`

Existing deps: `ScreenBackground`, `Button` (forwards native props), `tokens`, `src/lib/gameCode.ts` (`normalizeGameCode`, `isValidGameCode`), `src/lib/lobby.ts`.

- [ ] **Step 1: Write failing tests**

Create `src/screens/CreateLobby.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const createLobby = vi.fn();
const navigate = vi.fn();
vi.mock("../lib/lobby", async (orig) => ({ ...(await orig<typeof import("../lib/lobby")>()), createLobby: (...a: unknown[]) => createLobby(...a) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));

import { CreateLobby } from "./CreateLobby";

describe("CreateLobby", () => {
  it("creates a lobby with the chosen mode and navigates to the room", async () => {
    createLobby.mockResolvedValue("L9");
    render(<MemoryRouter><CreateLobby /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /medium/i }));
    await userEvent.click(screen.getByRole("button", { name: /create lobby/i }));
    expect(createLobby).toHaveBeenCalledWith("medium");
    expect(navigate).toHaveBeenCalledWith("/lobby/L9");
  });
  it("shows a friendly error when create fails", async () => {
    const { LobbyError } = await import("../lib/lobby");
    createLobby.mockRejectedValue(new LobbyError("already_hosting", "x"));
    render(<MemoryRouter><CreateLobby /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /create lobby/i }));
    expect(await screen.findByText(/already hosting/i)).toBeInTheDocument();
  });
});
```

Create `src/screens/JoinLobby.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const joinLobby = vi.fn();
const navigate = vi.fn();
vi.mock("../lib/lobby", async (orig) => ({ ...(await orig<typeof import("../lib/lobby")>()), joinLobby: (...a: unknown[]) => joinLobby(...a) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));

import { JoinLobby } from "./JoinLobby";

describe("JoinLobby", () => {
  it("normalizes the code, joins, and navigates to the room", async () => {
    joinLobby.mockResolvedValue("L5");
    render(<MemoryRouter><JoinLobby /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/code/i), "abc234");
    await userEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(joinLobby).toHaveBeenCalledWith("ABC234");
    expect(navigate).toHaveBeenCalledWith("/lobby/L5");
  });
  it("rejects an invalid code format without calling the RPC", async () => {
    render(<MemoryRouter><JoinLobby /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/code/i), "abc");
    await userEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(joinLobby).not.toHaveBeenCalled();
    expect(await screen.findByText(/6 characters/i)).toBeInTheDocument();
  });
  it("shows a friendly error when the lobby is not found", async () => {
    const { LobbyError } = await import("../lib/lobby");
    joinLobby.mockRejectedValue(new LobbyError("lobby_not_found", "x"));
    render(<MemoryRouter><JoinLobby /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/code/i), "ABC234");
    await userEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(await screen.findByText(/no game found/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- CreateLobby JoinLobby`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement PlayMenu**

Create `src/screens/PlayMenu.tsx`:
```tsx
import { Link } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";

export function PlayMenu() {
  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 40, margin: 0 }}>Play</h1>
      <Link to="/lobby/new"><Button>Host a game</Button></Link>
      <Link to="/lobby/join"><Button>Join a game</Button></Link>
      <Link to="/home"><Button>Back</Button></Link>
    </ScreenBackground>
  );
}
```

- [ ] **Step 4: Implement CreateLobby**

Create `src/screens/CreateLobby.tsx`:
```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { createLobby, lobbyErrorMessage, type LobbyMode } from "../lib/lobby";
import { tokens } from "../theme/tokens";

const MODES: { value: LobbyMode; label: string; hint: string }[] = [
  { value: "easy", label: "Easy", hint: "1 keyword" },
  { value: "medium", label: "Medium", hint: "verb + noun" },
  { value: "hard", label: "Hard", hint: "adjective + noun + verb" },
];

export function CreateLobby() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LobbyMode>("easy");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createLobby(mode);
      navigate(`/lobby/${id}`);
    } catch (e) {
      setBusy(false);
      setError(lobbyErrorMessage(e));
    }
  };

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 32, margin: 0 }}>Host a game</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space[2], width: 260 }}>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            onClick={() => setMode(m.value)}
            style={{
              padding: tokens.space[3],
              borderRadius: tokens.radius.md,
              border: mode === m.value ? `3px solid ${tokens.color.accent}` : "3px solid transparent",
              background: mode === m.value ? tokens.color.primary : "rgba(255,255,255,0.08)",
              color: tokens.color.text,
              fontFamily: tokens.font.family,
              fontWeight: tokens.font.weightBold,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {m.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>— {m.hint}</span>
          </button>
        ))}
      </div>
      <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create lobby"}</Button>
      {error && <p style={{ color: tokens.color.danger, margin: 0 }}>{error}</p>}
    </ScreenBackground>
  );
}
```

- [ ] **Step 5: Implement JoinLobby**

Create `src/screens/JoinLobby.tsx`:
```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { joinLobby, lobbyErrorMessage } from "../lib/lobby";
import { normalizeGameCode, isValidGameCode } from "../lib/gameCode";
import { tokens } from "../theme/tokens";

export function JoinLobby() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    const normalized = normalizeGameCode(code);
    if (!isValidGameCode(normalized)) {
      setError("A game code is 6 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await joinLobby(normalized);
      navigate(`/lobby/${id}`);
    } catch (e) {
      setBusy(false);
      setError(lobbyErrorMessage(e));
    }
  };

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 32, margin: 0 }}>Join a game</h1>
      <label htmlFor="code" style={{ fontWeight: tokens.font.weightBold }}>Game code</label>
      <input
        id="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
        style={{ padding: tokens.space[3], borderRadius: tokens.radius.md, border: "none", fontSize: 24, letterSpacing: 4, width: 200, textAlign: "center", textTransform: "uppercase" }}
      />
      <Button onClick={join} disabled={busy}>{busy ? "Joining…" : "Join"}</Button>
      {error && <p style={{ color: tokens.color.danger, margin: 0 }}>{error}</p>}
    </ScreenBackground>
  );
}
```

- [ ] **Step 6: Run (expect PASS)**

Run: `npm test -- CreateLobby JoinLobby`
Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/screens/PlayMenu.tsx src/screens/CreateLobby.tsx src/screens/CreateLobby.test.tsx src/screens/JoinLobby.tsx src/screens/JoinLobby.test.tsx
git commit -m "feat: PlayMenu, CreateLobby, JoinLobby screens"
```

---

## Task 5: LobbyRoom + GameStub screens (TDD)

**Files:**
- Create: `src/screens/LobbyRoom.tsx`, `src/screens/GameStub.tsx`
- Create: `src/screens/LobbyRoom.test.tsx`

Deps: `useLobby` (Task 3), `useAuth` (`profile.id`), `GameCodeBadge`, `Button`, `ScreenBackground`, `leaveLobby`/`startGame` from `lib/lobby`, `useParams`/`useNavigate`.

- [ ] **Step 1: Write failing tests**

Create `src/screens/LobbyRoom.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { LobbyState } from "../realtime/useLobby";

const useLobby = vi.fn<() => LobbyState>();
const startGame = vi.fn();
const leaveLobby = vi.fn();
const navigate = vi.fn();
vi.mock("../realtime/useLobby", () => ({ useLobby: () => useLobby() }));
vi.mock("../lib/lobby", async (orig) => ({ ...(await orig<typeof import("../lib/lobby")>()), startGame: (...a: unknown[]) => startGame(...a), leaveLobby: (...a: unknown[]) => leaveLobby(...a) }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ profile: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: "ABC234" } }) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate, useParams: () => ({ id: "L1" }) }));

import { LobbyRoom } from "./LobbyRoom";

function state(over: Partial<LobbyState>): LobbyState {
  return { loading: false, lobby: { id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "waiting", game_ends_at: null }, players: [], onlineIds: new Set(), ...over };
}
const p = (id: string, name: string) => ({ lobby_id: "L1", profile_id: id, joined_at: id, score: 0, display_name: name, avatar: "😀" });

beforeEach(() => { vi.clearAllMocks(); });

describe("LobbyRoom", () => {
  it("shows the code and roster", () => {
    useLobby.mockReturnValue(state({ players: [p("u1", "Q"), p("u2", "R")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    expect(screen.getByText("ABC234")).toBeInTheDocument();
    expect(screen.getByText("Q")).toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
  });
  it("host can start once there are 2+ players", async () => {
    startGame.mockResolvedValue(undefined);
    useLobby.mockReturnValue(state({ players: [p("u1", "Q"), p("u2", "R")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    const start = screen.getByRole("button", { name: /start game/i });
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(startGame).toHaveBeenCalledWith("L1");
  });
  it("host start button is disabled with fewer than 2 players", () => {
    useLobby.mockReturnValue(state({ players: [p("u1", "Q")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /start game/i })).toBeDisabled();
  });
  it("navigates to the game screen when status becomes playing", () => {
    useLobby.mockReturnValue(state({ lobby: { id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "playing", game_ends_at: null }, players: [p("u1", "Q"), p("u2", "R")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    expect(navigate).toHaveBeenCalledWith("/game/L1");
  });
  it("leaving calls leaveLobby and goes home", async () => {
    leaveLobby.mockResolvedValue(undefined);
    useLobby.mockReturnValue(state({ players: [p("u1", "Q")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /leave/i }));
    expect(leaveLobby).toHaveBeenCalledWith("L1");
    expect(navigate).toHaveBeenCalledWith("/home", { replace: true });
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- LobbyRoom`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement LobbyRoom**

Create `src/screens/LobbyRoom.tsx`:
```tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { GameCodeBadge } from "../components/GameCodeBadge";
import { useAuth } from "../auth/useAuth";
import { useLobby } from "../realtime/useLobby";
import { leaveLobby, startGame } from "../lib/lobby";
import { tokens } from "../theme/tokens";

export function LobbyRoom() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { loading, lobby, players, onlineIds } = useLobby(id, profile?.id);

  const isHost = !!lobby && lobby.host_id === profile?.id;
  const status = lobby?.status;
  // Presence-only UX: once presence has synced (set non-empty), flag an absent host.
  const hostOffline = !!lobby && !isHost && onlineIds.size > 0 && !onlineIds.has(lobby.host_id);

  useEffect(() => {
    if (status === "playing") navigate(`/game/${id}`);
    else if (status === "finished" && !isHost) navigate("/home", { replace: true });
  }, [status, isHost, id, navigate]);

  // Loaded but not a member / closed lobby -> nothing to show.
  if (!loading && !lobby) {
    return <ScreenBackground><p>This lobby isn’t available.</p><Button onClick={() => navigate("/home", { replace: true })}>Back home</Button></ScreenBackground>;
  }

  const leave = async () => { await leaveLobby(id); navigate("/home", { replace: true }); };
  const start = async () => { await startGame(id); };

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 28, margin: 0 }}>Lobby</h1>
      {hostOffline && <p style={{ color: tokens.color.danger, margin: 0 }}>Host disconnected — they may have left.</p>}
      {lobby && <GameCodeBadge code={lobby.code} />}
      <p style={{ opacity: 0.7, margin: 0 }}>Mode: {lobby?.mode}</p>
      <ul style={{ listStyle: "none", padding: 0, width: 260, display: "flex", flexDirection: "column", gap: tokens.space[2] }}>
        {players.map((pl) => (
          <li key={pl.profile_id} style={{ display: "flex", alignItems: "center", gap: tokens.space[2] }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: onlineIds.has(pl.profile_id) ? tokens.color.success : "rgba(255,255,255,0.25)" }} />
            <span style={{ fontSize: 22 }}>{pl.avatar}</span>
            <span style={{ fontWeight: tokens.font.weightBold }}>{pl.display_name}</span>
            {lobby?.host_id === pl.profile_id && <span style={{ opacity: 0.7, fontSize: 12 }}>host</span>}
          </li>
        ))}
      </ul>
      {isHost ? (
        <Button onClick={start} disabled={players.length < 2}>Start game</Button>
      ) : (
        <p style={{ opacity: 0.8 }}>Waiting for the host to start…</p>
      )}
      <Button onClick={leave} style={{ background: tokens.color.danger }}>Leave</Button>
    </ScreenBackground>
  );
}
```

- [ ] **Step 4: Implement GameStub**

Create `src/screens/GameStub.tsx`:
```tsx
import { Link } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { tokens } from "../theme/tokens";

export function GameStub() {
  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 32, margin: 0 }}>Game starting…</h1>
      <p style={{ opacity: 0.8, maxWidth: 300, textAlign: "center" }}>
        The core game loop arrives in Sub-project 3. For now, this is where the round begins.
      </p>
      <Link to="/home" style={{ color: tokens.color.accent, fontWeight: tokens.font.weightBold }}>Back home</Link>
    </ScreenBackground>
  );
}
```

- [ ] **Step 5: Run (expect PASS)**

Run: `npm test -- LobbyRoom`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/screens/LobbyRoom.tsx src/screens/LobbyRoom.test.tsx src/screens/GameStub.tsx
git commit -m "feat: LobbyRoom waiting room + GameStub placeholder"
```

---

## Task 6: Wire routing + enable Home "Play"

**Files:**
- Modify: `src/App.tsx`, `src/App.test.tsx`, `src/screens/Home.tsx`

- [ ] **Step 1: Add a failing route test**

In `src/App.test.tsx`, add this test inside the existing `describe("App routes", ...)` block (keep the existing tests and the existing `auth`/`base` setup at the top of the file):
```tsx
  it("shows the Play menu at /play for an authed, profiled user", () => {
    auth.mockReturnValue(base({ session: { user: { id: "u1" } } as never, profile: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: "ABC234" } }));
    render(<MemoryRouter initialEntries={["/play"]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /host a game/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `npm test -- App`
Expected: FAIL — no "Host a game" button (route not wired).

- [ ] **Step 3: Add the routes**

In `src/App.tsx`, add the imports after the existing screen imports:
```tsx
import { PlayMenu } from "./screens/PlayMenu";
import { CreateLobby } from "./screens/CreateLobby";
import { JoinLobby } from "./screens/JoinLobby";
import { LobbyRoom } from "./screens/LobbyRoom";
import { GameStub } from "./screens/GameStub";
```
Then add these routes inside `<Routes>` immediately before the `<Route path="*" ... />` catch-all:
```tsx
      <Route path="/play" element={<RequireAuth><RequireProfile><PlayMenu /></RequireProfile></RequireAuth>} />
      <Route path="/lobby/new" element={<RequireAuth><RequireProfile><CreateLobby /></RequireProfile></RequireAuth>} />
      <Route path="/lobby/join" element={<RequireAuth><RequireProfile><JoinLobby /></RequireProfile></RequireAuth>} />
      <Route path="/lobby/:id" element={<RequireAuth><RequireProfile><LobbyRoom /></RequireProfile></RequireAuth>} />
      <Route path="/game/:id" element={<RequireAuth><RequireProfile><GameStub /></RequireProfile></RequireAuth>} />
```

- [ ] **Step 4: Enable the Home "Play" button**

In `src/screens/Home.tsx`, replace the disabled placeholder line:
```tsx
      <Button disabled>Play (coming soon)</Button>
```
with an enabled link:
```tsx
      <Link to="/play"><Button>Play</Button></Link>
```
(`Link` is already imported in Home.tsx.)

- [ ] **Step 5: Run full suite + build (expect PASS)**

Run: `npm test && npm run build`
Expected: all tests pass; `tsc -b && vite build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/screens/Home.tsx
git commit -m "feat: wire lobby routes + enable Home Play"
```

---

## Task 7: DB integration test for the lobby RPCs

**Files:**
- Create: `supabase/tests/lobby.test.sql`

This exercises the real server-side guarantees (RPC happy paths, the 8-player cap, host-leave-closes, RLS) that the mocked unit tests cannot. It seeds `auth.users` (the `handle_new_user` trigger from SP1 auto-creates the matching `profiles` rows) and calls the RPCs as a specific user via `request.jwt.claims`.

- [ ] **Step 1: Write the SQL assertion script**

Create `supabase/tests/lobby.test.sql`:
```sql
-- DB integration assertions for SP2 lobby RPCs. Run against the live local DB:
--   docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/lobby.test.sql
-- Seeds auth.users (trigger auto-creates profiles), sets request.jwt.claims to act as a user,
-- and asserts create/join/cap/start/leave + RLS. Cleans up via auth.users cascade.

do $$
declare h uuid := '00000000-0000-0000-0000-0000000000a1'; -- host
        g uuid := '00000000-0000-0000-0000-0000000000a2'; -- guest
        v_lobby uuid; v_status text;
begin
  insert into auth.users (id) values (h), (g);
  update public.profiles set current_game_code = 'HOST01', display_name = 'Host' where id = h;
  update public.profiles set display_name = 'Guest' where id = g;

  -- Act as the host: create a lobby.
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  v_lobby := public.create_lobby('easy');
  if (select code from public.lobbies where id = v_lobby) <> 'HOST01' then
    raise exception 'expected lobby code = host game code';
  end if;
  raise notice 'OK: create_lobby uses host code and seats the host';

  -- start_game with only the host should fail (needs 2+).
  begin
    perform public.start_game(v_lobby);
    raise exception 'expected not_enough_players';
  exception when others then
    if sqlerrm not like '%not_enough_players%' then raise; end if;
    raise notice 'OK: start_game blocked with <2 players';
  end;

  -- Act as the guest: join.
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  if public.join_lobby('host01') <> v_lobby then
    raise exception 'expected join to resolve same lobby (case-insensitive)';
  end if;
  raise notice 'OK: join_lobby resolves the lobby by code';

  -- RLS: guest can read the lobby they are now in.
  if (select count(*) from public.lobbies where id = v_lobby) <> 1 then
    raise exception 'expected member to read their lobby under RLS';
  end if;

  -- Now host can start (2 players).
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  perform public.start_game(v_lobby);
  select status into v_status from public.lobbies where id = v_lobby;
  if v_status <> 'playing' then raise exception 'expected status playing'; end if;
  raise notice 'OK: start_game flips status to playing with 2 players';

  -- Host leave closes the lobby.
  perform public.leave_lobby(v_lobby);
  select status into v_status from public.lobbies where id = v_lobby;
  if v_status <> 'finished' then raise exception 'expected status finished after host leave'; end if;
  raise notice 'OK: host leave closes the lobby';

  -- cleanup (cascades to lobbies/lobby_players via FKs).
  delete from auth.users where id in (h, g);
exception when others then
  -- ensure cleanup even on failure, then re-raise so the failure is visible
  delete from auth.users where id in (h, g);
  raise;
end $$;

-- RLS sanity: with no jwt claims (anon), selecting the (now-deleted) lobby yields nothing,
-- and RLS is enabled on both tables.
select relname, relrowsecurity from pg_class where relname in ('lobbies','lobby_players') order by relname;
```
Note: cleanup runs on both the success path (end of the `do` block) and the failure path (the `exception` handler), so test rows never linger regardless of outcome.

- [ ] **Step 2: Run the script**

Run:
```bash
docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/lobby.test.sql
```
Expected: a series of `OK: ...` notices, the final two-row `relrowsecurity = t` for both tables, and no errors. Confirm no test rows remain:
```bash
docker exec supabase_db_heartsup psql -U postgres -d postgres -c "select count(*) from auth.users where id::text like '00000000-0000-0000-0000-0000000000a%';"
```
Expected: `0`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/lobby.test.sql
git commit -m "test: DB assertions for lobby RPCs + RLS"
```

---

## Task 8: README + manual smoke walkthrough

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document SP2**

READ `README.md` first to match its style. Update the top line that lists sub-projects to include SP2, and append a new section just before `## Tests`:
```markdown
## Sub-project 2: Lobby & Realtime

Host or join a waiting-room lobby by code, see a live roster, and have the host start the game.
Lobby reads use member-only RLS; all writes go through `security definer` RPCs. The roster
updates via Supabase **Postgres Changes**, and online/offline status via Supabase **Presence**.

### Manual smoke test (two browser sessions)
1. Log in as user A (host), set up a profile. On Home tap **Play → Host a game**, pick a mode,
   **Create lobby**. Note the 6-char code on the lobby screen.
2. In a second browser (or private window), log in as user B (guest), set up a profile.
   **Play → Join a game**, enter A's code, **Join**.
3. User A sees user B appear in the roster live, each with a green online dot.
4. With 2+ players, A taps **Start game** → both sessions land on the "Game starting…" screen.
5. From a fresh lobby, A tapping **Leave** closes it and bounces B back Home.
```

- [ ] **Step 2: Run the full suite + build**

Run: `npm test && npm run build`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: SP2 lobby flow + manual smoke walkthrough"
```

---

## Acceptance Criteria (Sub-project 2)

- [ ] Migration `0008` applies: member-only RLS on `lobbies`/`lobby_players`, snapshot `display_name`/`avatar` columns, partial active-code unique index, `create_lobby`/`join_lobby`/`leave_lobby`/`start_game` RPCs, both tables in the realtime publication.
- [ ] `lib/lobby.ts` (data access + error mapping), `useLobby` (Postgres Changes + Presence), and all screens are unit-tested and passing.
- [ ] Routing: Home **Play** → `/play` → host/join → `/lobby/:id`; host start transitions everyone to `/game/:id`.
- [ ] Lobby code = host's personal game code; join is case-insensitive; cap 8; min 2 to start; host leave closes the lobby.
- [ ] DB integration test confirms RPC happy paths, the player cap, host-leave-closes, and RLS; both tables have RLS enabled.
- [ ] Manual smoke (two sessions: host creates, guest joins live, host starts, host leave closes) works end-to-end.
- [ ] `npm test` and `npm run build` pass.
```
