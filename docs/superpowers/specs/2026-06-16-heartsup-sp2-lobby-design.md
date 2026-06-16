# heartsup Sub-project 2 — Lobby & Realtime — Design Spec

**Date:** 2026-06-16
**Status:** Approved
**Depends on:** Sub-project 1 (auth, profile, per-session game code). See
[2026-06-15-heartsup-design.md](2026-06-15-heartsup-design.md) for the whole-system design and
[2026-06-16-heartsup-sp1-auth-design.md](2026-06-16-heartsup-sp1-auth-design.md) for the auth layer.

## 1. Goal

Players create or join a waiting-room **lobby** via a code, see a **live roster** (with
online/offline status), and the **host starts the game**. After SP2 the app is demoable as:
log in → set profile → host or join a lobby by code → watch friends appear live → host taps
"Start game" → everyone transitions together.

**Scope ends at the transition to `playing`.** Actual gameplay — rounds, turn rotation, hidden
rating, keyword draw, tilt scoring, timer, scoreboard — is Sub-project 3. SP2 only delivers the
lobby/waiting-room and the realtime plumbing that SP3 will build on.

This sub-project builds on the `lobbies`, `lobby_players`, and `profiles` tables already created
in SP0's `0004_multiplayer.sql`, and reuses SP1's per-session game code and `GameCodeBadge` /
`gameCode.ts` helpers.

## 2. Decisions (locked)

| Concern | Decision |
|---|---|
| Lobby code | A lobby's `code` **= the host's `current_game_code`** at creation. Friends join with the host's personal code (shown on their Profile). |
| Cross-user code lookup | A scoped `security definer` RPC resolves a **`waiting`** lobby by exact code without RLS exposing other lobbies (this is the lookup SP1 deferred). |
| Realtime sync | **Postgres Changes** (authoritative: `lobby_players` + `lobbies`) **+ Supabase Presence** (online/offline + disconnect detection), channel `lobby:{id}` keyed by `profile_id`. |
| Host leaves/disconnects (explicit) | Host's explicit Leave **closes the lobby for everyone** (status → `finished`); remaining players are bounced Home. No host migration. |
| Non-host leave / rejoin | Leave **deletes** the `lobby_players` row (live-removed). Rejoin via code **re-adds at the end** of the join order. |
| Player cap | **Soft cap 8.** Joins beyond 8 are rejected with a clear message. |
| Min players to start | **2** (one guesser + at least one improviser). "Start game" disabled below this. |
| Turn order | `lobby_players.joined_at` ascending (persisted now; consumed by SP3). |
| Lobby writes | All mutations go through `security definer` RPCs; clients never write `lobbies`/`lobby_players` directly. |
| State | A `useLobby(lobbyId)` hook owns the subscription; no global lobby provider (YAGNI). |

**Out of scope (SP3+):** gameplay, turn loop, keyword draw, scoring, timer, scoreboard,
server-side auto-close of host-crashed lobbies (deferred to a scheduled cleanup — see §6).

## 3. Data model & server logic — migration `0008_lobby_rpcs.sql`

The tables exist (SP0 `0004_multiplayer.sql`). SP2 adds RLS and the RPCs. Reminder of the
relevant columns:

```
lobbies        ( id uuid pk, code text unique, host_id uuid -> profiles,
                 mode text check (easy|medium|hard), status text default 'waiting'
                 check (waiting|playing|finished), game_ends_at timestamptz, created_at )
lobby_players  ( lobby_id uuid -> lobbies on delete cascade,
                 profile_id uuid -> profiles on delete cascade,
                 joined_at timestamptz default now(), score int default 0,
                 is_current_turn bool default false, pk (lobby_id, profile_id) )
```

**A. RLS — members read only their own lobbies; no client writes:**
```sql
alter table lobbies enable row level security;
alter table lobby_players enable row level security;

-- A member can read a lobby they belong to.
create policy "members read lobby" on lobbies for select
  using (exists (select 1 from lobby_players lp
                 where lp.lobby_id = lobbies.id and lp.profile_id = auth.uid()));

-- A member can read the roster of a lobby they belong to.
create policy "members read roster" on lobby_players for select
  using (exists (select 1 from lobby_players self
                 where self.lobby_id = lobby_players.lobby_id and self.profile_id = auth.uid()));
```
No `insert`/`update`/`delete` policies are granted to clients — all mutations flow through the
`security definer` RPCs below (which run as owner and bypass RLS, but are each scoped to
`auth.uid()`). This keeps the cross-user join lookup safe: a non-member cannot read a lobby
directly, but `join_lobby(code)` can resolve it server-side.

**B. RPCs** (all `language plpgsql security definer set search_path = ''`, schema-qualified,
granted `execute` to `authenticated`):

- **`create_lobby(p_mode text) returns uuid`** — requires the caller's `public.profiles.current_game_code`
  is not null and the caller has no existing lobby in status `waiting`/`playing` they host;
  raises a clear exception otherwise. Inserts a `lobbies` row (`code` = caller's `current_game_code`,
  `host_id` = `auth.uid()`, `mode` = `p_mode`, `status` `waiting`) and the host's `lobby_players`
  row. Returns the new lobby id. Validates `p_mode in ('easy','medium','hard')`.

- **`join_lobby(p_code text) returns uuid`** — looks up a lobby `where code = upper(trim(p_code))
  and status = 'waiting'`. Raises `lobby_not_found` if none; `lobby_full` if it already has 8
  players; if the caller already has a row, returns the lobby id unchanged (idempotent).
  Otherwise inserts a `lobby_players` row (default `joined_at = now()` → end of order). Returns
  the lobby id.

- **`leave_lobby(p_lobby_id uuid) returns void`** — if `auth.uid()` is the lobby's `host_id`,
  set the lobby's `status = 'finished'`; otherwise delete the caller's `lobby_players` row. No-op
  if the caller is not a member.

- **`start_game(p_lobby_id uuid) returns void`** — host-only (raises if caller ≠ `host_id`);
  requires the lobby is `waiting` and has ≥2 players (raises `not_enough_players`); sets
  `status = 'playing'`. Leaves `game_ends_at` null (SP3 sets the timer).

Exceptions use stable codes/messages the client maps to friendly text (e.g. `lobby_not_found`,
`lobby_full`, `not_enough_players`, `no_game_code`, `already_hosting`).

## 4. Client architecture

```
src/
├─ lib/
│  └─ lobby.ts            # ONLY module issuing lobby DB/RPC calls
├─ realtime/
│  └─ useLobby.ts         # subscription hook: Postgres Changes + Presence -> live state
├─ screens/
│  ├─ PlayMenu.tsx        ├─ CreateLobby.tsx   ├─ JoinLobby.tsx   └─ LobbyRoom.tsx
└─ (existing) App.tsx routing, components/*, auth/*, theme/*
supabase/migrations/0008_lobby_rpcs.sql
supabase/tests/lobby.test.sql
```

**Boundaries:**
- `lib/lobby.ts` is the only module touching the `lobbies`/`lobby_players` tables or lobby RPCs.
  Exports: `Lobby` + `LobbyPlayer` interfaces, `createLobby(mode)`, `joinLobby(code)`,
  `leaveLobby(lobbyId)`, `startGame(lobbyId)`, `getLobby(lobbyId)`, `getLobbyPlayers(lobbyId)`.
  RPC errors are caught and re-thrown as typed errors carrying the stable code so screens can map
  them to friendly messages.
- `useLobby(lobbyId)` owns the realtime lifecycle: on mount it fetches the initial lobby + roster,
  subscribes to Postgres Changes for `lobby_players` (filter `lobby_id=eq.{id}`) and `lobbies`
  (filter `id=eq.{id}`), and joins a Presence channel `lobby:{id}` tracking `{ profile_id }`.
  It exposes `{ loading, lobby, players, onlineIds }` where `players` is the DB roster ordered by
  `joined_at` and `onlineIds` is a `Set<string>` of currently-present profile ids. Cleans up the
  channel on unmount.
- Screens are presentational: read `useAuth()` + `useLobby()`, call `lib/lobby.ts` actions,
  navigate on state transitions.

## 5. Screens & routing

All lobby routes are behind `RequireAuth` + `RequireProfile`.

- **PlayMenu** (`/play`) — replaces the Home "Play" placeholder target. Two buttons:
  "Host a game" → `/lobby/new`, "Join a game" → `/lobby/join`. Back to Home.
- **CreateLobby** (`/lobby/new`) — mode selector (Easy / Medium / Hard with one-line
  descriptions: 1 keyword / verb+noun / adjective+noun+verb), "Create lobby" → `createLobby(mode)`
  → navigate to `/lobby/{id}`.
- **JoinLobby** (`/lobby/join`) — code input that normalizes + validates with SP1's `gameCode.ts`;
  "Join" → `joinLobby(code)`; maps `lobby_not_found`/`lobby_full` to inline messages and stays on
  the page; on success navigate to `/lobby/{id}`.
- **LobbyRoom** (`/lobby/:id`) — the waiting room:
  - Shows the lobby code via `GameCodeBadge` (copy to share) and the mode.
  - Live player list: avatar + name per `lobby_players` row, an **online dot** (green if in
    `onlineIds`, grey otherwise), and a "host" marker on `host_id`.
  - **Host** sees a "Start game" button, disabled when `players.length < 2`; non-hosts see
    "Waiting for the host to start…".
  - **Leave** button → `leaveLobby(id)` → navigate Home.
  - Reactions to live state: when `lobby.status` becomes `playing`, everyone navigates to
    `/game/{id}` (a placeholder screen in SP2 — "Game starting… (coming in SP3)"); when
    `lobby.status` becomes `finished` (host closed it), non-hosts see a brief "Host ended the
    lobby" and are bounced Home.

Routing additions in `App.tsx`: `/play`, `/lobby/new`, `/lobby/join`, `/lobby/:id`, and a
placeholder `/game/:id`. Home's "Play (coming soon)" button becomes an enabled link to `/play`.

## 6. Error handling & disconnect

- **Join failures** (`lobby_not_found`, `lobby_full`, lobby already `playing`) → inline error on
  the Join screen; never navigate.
- **Create failures** (`no_game_code`, `already_hosting`) → inline error on Create screen.
- **Explicit Leave is authoritative.** Host Leave sets `status = 'finished'`; the `lobbies`
  Postgres-Changes event lands on every member and bounces non-hosts Home. Non-host Leave deletes
  the row; the removal lands live on others' rosters.
- **Ungraceful disconnect is presence-only UX.** A player whose Presence drops is shown greyed
  (offline) but their row persists (only explicit Leave removes it). If the **host** goes offline,
  members see a "Host disconnected" banner and may Leave.
- **Stale lobby cleanup** (host crashes without leaving): true server-side auto-close needs a
  scheduled job; this is **deferred** as a follow-up (a periodic query closing `waiting` lobbies
  older than a TTL, or whose host has no membership). No server daemon is added in SP2. This is
  consistent with the locked "close for everyone" decision — explicit host Leave covers the
  common path; crashed-host lobbies simply go stale until cleanup.

## 7. Testing

- **Unit (Vitest, mocked supabase):** `lib/lobby.ts` — each function calls the right RPC/query and
  maps RPC errors to typed errors (`createLobby`→`create_lobby`, `joinLobby`→`join_lobby`, etc.).
- **Hook (mocked channel):** `useLobby` — merges the initial roster, applies a simulated
  Postgres-Changes insert/delete to `players`, reflects Presence sync into `onlineIds`, and
  surfaces `lobby.status` transitions. No real network.
- **Screen tests:** PlayMenu navigation; CreateLobby create-then-navigate; JoinLobby
  validation + error mapping; LobbyRoom host-vs-guest rendering and the `<2 players` start gate;
  navigation on `status = playing`.
- **DB integration (live local DB):** `create_lobby` sets `code` = host code and inserts the host;
  `join_lobby` adds a member and rejects a 9th; `start_game` requires host + ≥2 players;
  `leave_lobby` as host closes the lobby; RLS blocks a non-member `select` on a lobby.
- **Manual smoke (documented in the plan):** two browser sessions (two profiles) — host creates,
  guest joins by code, host sees guest appear live with an online dot, host starts → both land on
  the placeholder game screen; host Leave from a fresh lobby bounces the guest Home.

## 8. Out of scope / later

- Gameplay, turn rotation, keyword draw, scoring, timer, scoreboard → SP3.
- Scheduled cleanup of crashed-host / stale `waiting` lobbies → follow-up cron.
- Host migration, spectators, kicking players, lobby chat → not planned for SP2.
- Real Figma token sync (tokens still approximated from the export).
