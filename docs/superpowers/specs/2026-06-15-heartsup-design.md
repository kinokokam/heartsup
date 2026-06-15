# heartsup — Design Spec

**Date:** 2026-06-15
**Status:** Approved (whole-system architecture + Sub-project 0 detailed)

## 1. Overview

heartsup is a networked multiplayer party game — a rendition of *Heads Up!* crossed with
the TikTok "you're a 10/10 but…" poker-card trend. Each player holds their own phone. One
player at a time is the **guesser**: a hidden 1–10 rating shows on their screen (held to their
forehead — friends can see it, they can't) along with one or more **keywords**. Friends
improvise a scenario weaving the keyword(s) in — *"You're a 10/10 but you wear slippers
everywhere"* — and the guesser calls out a number. The guesser tilts the phone **UP** = "I got
it" (point) or **DOWN** = pass (no point). Turn rotates to the next player. The game runs for a
fixed total duration, then shows **Time's Up!** and a **Scoreboard**.

A twist on the original: the keyword combos are drawn from an **adaptive, community-trained
coherence engine** so the random words actually fit together well enough to riff on.

### Platform decisions (locked)

| Concern | Decision |
|---|---|
| Client | React + TypeScript + Vite, installable **PWA** (no app store; share a URL) |
| Tilt | Browser `DeviceMotion`/`DeviceOrientation`, with on-screen-button fallback |
| Backend | **Supabase** — Auth + Postgres + Realtime |
| Auth | **Email magic link** (passwordless) |
| Multiplayer | Each player on own phone; join a lobby via a shared **game code** |
| UI baseline | The **heartsup Figma file**, read via the Figma MCP |
| Data | Two Kaggle datasets, ingested via the Kaggle MCP |

### Game modes

| Mode | Keywords | Part-of-speech pattern | Total game length |
|---|---|---|---|
| Easy | 1 | noun (or any single word) | 30 min |
| Medium | 2 | verb + noun | 30 min |
| Hard | 3 | adjective + noun + verb | 20 min |

The timer is the **whole game's** duration; players cycle through cards (turn rotating after
each tilt) until the clock hits zero. Scoring is **+1 per correct guess**. Correctness is
honor-system, kept honest because friends can see the rating the guesser cannot.

## 2. System Architecture

```
Client (React PWA)
  Auth/Profile (magic link) | Lobby (realtime) | Game loop (timer/UI) | Tilt sensor
  └ Figma-derived design tokens + component library
        │
Supabase
  Auth (magic link) | Postgres | Realtime channels
  users/profiles, game_codes | lobbies, rounds, feedback, scores
  word_pairs/triples, slang/pos_words (lexicon + coherence)
        ▲
Data pipeline (offline, rerunnable)
  Kaggle MCP → CSV → clean/tag → embed (pgvector) → seed coherence tables
```

- **Client**: React + TS + Vite; PWA via `vite-plugin-pwa` (manifest + service worker for
  install + offline shell). UI from a component library derived from the Figma file.
- **Tilt**: abstracted behind a `useTilt()` hook (UP = correct/point, DOWN = pass) with an
  on-screen-button fallback for desktop testing and iOS permission edge cases.
- **Backend**: Supabase. Game state (turn, current card, scores) lives in Postgres and syncs
  via Realtime channels; lobby membership via Supabase presence.
- **Data pipeline**: separate offline Node scripts; pulls Kaggle datasets, cleans/tags,
  computes embeddings, seeds coherence tables. Rerunnable/idempotent.
- **Coherence engine**: reads/writes `word_pairs`/`word_triples`; the game loop calls
  `drawKeywords(mode, lobbyId)` which respects coherence ranking + 5-round cooldown +
  suppression of low-coherence combos.

## 3. Data Model (Postgres / Supabase)

```sql
-- Identity
profiles            -- 1:1 with auth.users
  id (uuid, =auth.uid)  display_name  avatar  created_at
  current_game_code     -- regenerated on logout, persists during session

-- Lexicon (seeded by the data pipeline)
pos_words           -- common-english-parts-of-speech
  id  word  pos ('noun'|'verb'|'adjective'|...)  embedding(vector)
slang_words         -- genz-slang-evolution-tracker
  id  term  meaning  pos_guess  era  embedding(vector)
-- unified `keywords` view tagged by pos + source

-- Coherence engine (pipeline seeds; Sub-project 4 updates)
word_pairs          -- medium (verb + noun)
  id  word_a_id  word_b_id  coherence (float)
  times_shown  times_guessed  times_passed  last_used_round
word_triples        -- hard (adjective + noun + verb)
  id  word_a_id  word_b_id  word_c_id  coherence  + same counters

-- Multiplayer
lobbies
  id  code  host_id  mode  status ('waiting'|'playing'|'finished')
  game_ends_at  created_at
lobby_players       -- join order = turn order
  lobby_id  profile_id  joined_at  score  is_current_turn
rounds              -- one per card
  id  lobby_id  player_id  rating (1-10)  keyword_ids[]
  outcome ('guessed'|'passed'|null)  started_at  ended_at
feedback            -- drives coherence learning
  round_id  combo_id (pair/triple)  signal ('+'|'-')  created_at
```

**Notes**
- Embeddings via `pgvector`; enables cosine-similarity seeding and nearest-neighbor queries.
- `word_pairs`/`word_triples` seeded with semantic similarity, then `coherence` nudged by
  `feedback`. `last_used_round` enforces the 5-round cooldown; very-low `coherence` rows are
  suppressed from draws.
- Turn order = `lobby_players.joined_at`. Score `+1` per `guessed` outcome.
- **RLS**: players read/write only lobbies they belong to; lexicon/coherence tables are
  read-only to clients — coherence writes go through a server-side function so scores can't be
  gamed.

## 4. Decomposition & Build Order

Each sub-project gets its own spec → plan → build cycle. Order chosen so each stage is
independently testable.

| # | Sub-project | Delivers | Depends on |
|---|---|---|---|
| 0 | Foundation & data pipeline | Repo scaffold (React PWA + Supabase), Kaggle ingestion, embedding-seeded coherence tables, Figma design tokens | — |
| 1 | Auth + Profile + Game codes | Magic-link login, profile screen, per-session game code (regenerates on logout) | 0 |
| 2 | Lobby & real-time presence | Create/join lobby via code, live player list, host starts game | 1 |
| 3 | Core game loop | Mode select, hidden rating, keyword draw, timer, tilt → scoring, Time's Up, Scoreboard (device-local first, then wired to lobby) | 0, 2 |
| 4 | Adaptive coherence engine | guess(+)/pass(−) updates global scores, 5-round cooldown, suppression | 0, 3 |

## 5. Sub-project 0 — Foundation & Data Pipeline (detailed)

### A. Repo foundation
- Scaffold: Vite + React + TypeScript; PWA via `vite-plugin-pwa` (manifest + service worker);
  ESLint/Prettier; Vitest.
- Supabase: local dev via Supabase CLI; migrations in `supabase/migrations/`; enable
  `pgvector`.
- Design tokens: connect the Figma MCP, read the heartsup file, extract colors/type/spacing/
  radii into `tokens.ts` + base components (Button, Card, Screen background) in the confetti
  style. Full screens are built per later sub-project; #0 establishes tokens + primitives.
- Env/secrets handling; README with run instructions.

### B. Data pipeline (`/pipeline`, Node + TypeScript, rerunnable)
1. **Ingest** — via Kaggle MCP, download
   `likithagedipudi/genz-slang-evolution-tracker-2020-2025` and
   `thedevastator/common-english-parts-of-speech` to `/pipeline/data/raw`.
2. **Clean & tag** — normalize casing/dupes; POS dataset → `pos_words`
   (noun/verb/adjective); slang → `slang_words` with best-effort POS guess + meaning + era.
   Drop unusable rows; log counts.
3. **Embed** — one embedding per word/term using a **local model** (`transformers.js`, no API
   key/cost). Store as `pgvector`.
4. **Seed coherence** — generate candidate `word_pairs` (verb×noun) and `word_triples`
   (adj×noun×verb). To avoid combinatorial explosion, seed only the **top-K = 20** most
   semantically similar partners per word (nearest-neighbor); `coherence = cosine similarity`,
   counters = 0.
5. **Load** — idempotent upsert into Supabase.

### Acceptance criteria (Sub-project 0)
- `npm run dev` serves an installable PWA shell themed with Figma tokens.
- Supabase migrations create all tables + `pgvector`.
- `npm run pipeline` populates `pos_words`, `slang_words`, `word_pairs`, `word_triples` with
  non-zero, sensibly-seeded coherence — spot-check: *(wear, slipper)* scores higher than
  *(eat, slipper)*.
- A `drawKeywords(mode)` stub pulls a coherent combo per mode from seeded data (no learning
  yet — that's #4).

### Defaults (overridable)
- Embeddings: local model (`transformers.js`).
- Top-K = 20 partners per word for seeding (tunable).

## 6. Open Questions / Deferred to later sub-projects
- Exact tilt thresholds + iOS permission UX flow → Sub-project 3.
- Reconnect/disconnect handling in live lobbies → Sub-project 2.
- Coherence update math (learning rate, suppression threshold, cooldown=5 rounds) → Sub-project 4.
- Avatar source for profiles → Sub-project 1.
