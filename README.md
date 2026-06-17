# heartsup

A networked party game — a *Heads Up!* × TikTok "you're a 10/10 but…" mashup. Each player is
on their own phone; one player at a time holds a hidden 1–10 rating to their forehead while
friends improvise a scenario from drawn keywords. Tilt **up** = guessed it (point), **down** =
pass. Keyword combos come from an adaptive, community-trained coherence engine.

This repo currently contains **Sub-project 0: Foundation & data pipeline**, **Sub-project 1:
Auth + Profile + Game codes**, **Sub-project 2: Lobby & Realtime**, **Sub-project 3: Core
Game Loop**, and **Sub-project 4: Adaptive Coherence Engine**. See the design and plans under
[`docs/superpowers/`](docs/superpowers/).

## Stack

- **Client:** React + TypeScript + Vite, installable **PWA** (`vite-plugin-pwa`).
- **Backend:** Supabase (Postgres + `pgvector` + Auth + Realtime), local via the Supabase CLI.
- **Pipeline:** Node/TypeScript (`pipeline/`) — ingests Kaggle datasets, embeds words locally
  (`@xenova/transformers`, MiniLM, 384-dim), seeds word-pair/triple coherence by cosine similarity.

## Prerequisites

- Node 20+ / npm 10+
- Docker (for local Supabase)

## Run the app

```bash
npm install
cp .env.example .env          # then fill from `npx supabase start` output
npx supabase start            # pulls Docker images on first run
npx supabase migration up     # applies migrations 0001–0005 (incl. pgvector + grants)
npm run dev                   # installable PWA at the printed localhost URL
```

> Local Supabase here uses **custom ports** (API `54421`, DB `54422`) set in
> `supabase/config.toml` to avoid conflicts. The repo-root `.env` holds the local keys and is
> gitignored.

## Run the data pipeline

1. Download the two Kaggle datasets and unzip their CSVs into a top-level `data/` directory
   (gitignored):
   - `likithagedipudi/genz-slang-evolution-tracker-2020-2025` → `data/genz_slang_usage_2020_2025.csv`
   - `thedevastator/common-english-parts-of-speech` → `data/verbs.csv`, `data/nouns.csv`, `data/adjectives.csv`, …
2. Seed the database (requires local Supabase running):

```bash
cd pipeline
npm install
npx tsx src/run.ts
```

This populates `pos_words`, `slang_words`, `word_pairs`, and `word_triples`. It is idempotent —
the lexicon upserts on conflict and the coherence tables are reseeded each run.

**Tuning** (constants at the top of `pipeline/src/run.ts`): `NOUN_CAP`, `ADJ_CAP`,
`TOP_K_PAIR`, and the triple-seed subset sizes (`T_ADJ`/`T_NOUN`/`T_VERB`, `TOP_K_TRIPLE`).
Caps keep local embedding + the cartesian triple seed tractable and curate a fun vocabulary.

## Sub-project 1: Auth + Profile + Game codes

Run the app (`npm run dev`) with local Supabase up. Magic-link emails are captured by the local
**Mailpit** inbox at http://127.0.0.1:54424 (no real email is sent in local dev).

### Manual smoke test

1. Visit http://localhost:5173 → redirected to `/login`.
2. Enter an email, "Send me a link" → `/check-email`.
3. Open Mailpit (http://127.0.0.1:54424), open the newest email, click the magic link.
4. First time → `/setup`: enter a name, pick an emoji, "Let's play" → `/home`.
5. Open "My Profile" → your 6-char game code shows with a Copy button.
6. "Log out" → back to `/login`. Logging in again issues a NEW game code.

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

## Sub-project 4: Adaptive Coherence Engine

Keyword-combo coherence learns from play. SP0 seeds `coherence` by embedding similarity; during a
game each card's outcome nudges that combo's coherence — guessed raises it, passed lowers it
(bounded EMA, clamped `[0,1]`), applied server-side inside `submit_outcome`. Combos players riff on
get drawn more (the draw biases by coherence); combos they keep passing decay below the 0.15
suppression floor and stop appearing. Coherence is never client-writable — it changes only through
the `apply_feedback` path behind the guesser-scoped `submit_outcome` RPC.

Verify the learning math against the live DB:
```bash
docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/coherence.test.sql
```

## Tests

```bash
npm test                  # app + pipeline tests (vitest)
cd pipeline && npm test   # pipeline tests only
```

## Known follow-ups (post Sub-project 0)

- The raw POS word lists contain archaic/obscure entries (e.g. `withwind`, `foremath`); a
  common-word frequency filter would further curate the seed vocabulary.
- Multiplayer tables have no RLS policies yet — added with Auth in Sub-project 1.
- Design tokens (`src/theme/tokens.ts`) are approximated from the Figma export; sync exact
  values via the Figma MCP when building real screens.

