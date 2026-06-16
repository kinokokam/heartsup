# heartsup

A networked party game — a *Heads Up!* × TikTok "you're a 10/10 but…" mashup. Each player is
on their own phone; one player at a time holds a hidden 1–10 rating to their forehead while
friends improvise a scenario from drawn keywords. Tilt **up** = guessed it (point), **down** =
pass. Keyword combos come from an adaptive, community-trained coherence engine.

This repo currently contains **Sub-project 0: Foundation & data pipeline** and **Sub-project 1:
Auth + Profile + Game codes**. See the design and plans under
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

