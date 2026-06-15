# heartsup Sub-project 0 — Resume Notes

**Status: COMPLETE (15/15)** as of 2026-06-15. Branch: `feat/foundation-data-pipeline`.
**Plan:** [2026-06-15-heartsup-foundation.md](2026-06-15-heartsup-foundation.md)

## Completion summary
All tasks done. Datasets were placed in repo-root `data/` (gitignored). The POS dataset
turned out to be **per-POS files** (`verbs.csv`/`nouns.csv`/`adjectives.csv`, headerless,
word in col 0), not a single `[word, pos]` file — so `run.ts` reads per file, cleans
(pure-alpha, len 3–12), caps + even-samples (nouns→600, adj→400), and dedupes the **46**
unique slang terms. Seeding filters degenerate same-stem combos. A grants migration
(`0005_grants.sql`) was needed so `service_role` could write the tables. Final DB:
`pos_words=1172`, `slang_words=46`, `word_pairs=3427`, `word_triples=848`. Coherence ranks
sensibly (`cut/slice` 0.70 ≫ `cost/mobile` 0.27). 18 app + 13 pipeline tests pass; app builds.

Follow-ups for later: common-word frequency filter to remove archaic junk nouns; RLS policies
(Sub-project 1); sync exact Figma token values when building real screens.

---
## Historical (mid-build pause point): 10 of 15 tasks complete

### ✅ Done & committed
- **Task 1** Scaffold (Vite + React 19 + TS). Note: stack resolved to **Vite 8 / rolldown-vite**.
- **Task 2** Vitest (deduped to **vitest 4.x** at root because of Vite 8).
- **Task 3** PWA — `vite-plugin-pwa@1.3.0`, manifest + `sw.js` emit on build. Placeholder icons in `public/`.
- **Task 4** Design tokens — `src/theme/tokens.ts`. **Values are sampled from the Figma export image, NOT the live Figma file.** Sync exact values via Figma MCP when building real screens (Sub-project 1+).
- **Task 5** Base components — `Button`, `Card`, `ScreenBackground` + shell `App.tsx`.
- **Task 6** Local Supabase + pgvector. **Custom ports: API `54421`, DB `54422`** (set in `supabase/config.toml` to avoid conflicts). Real local keys are in repo-root `.env` (gitignored). `migration 0001_extensions` applied.
- **Task 7** Lexicon schema — `0002_lexicon.sql` (`pos_words`, `slang_words`, `keywords` view; `vector(384)`).
- **Task 8** Coherence + multiplayer schema — `0003_coherence.sql`, `0004_multiplayer.sql` (7 tables). **No RLS yet** (deferred to Sub-projects 1–2).
- **Task 9 (Part A only)** Pipeline workspace — `pipeline/` (vitest 2.1.9, tsx, typescript).
- **Task 10** `pipeline/src/clean.ts` — fixed a real bug vs the plan: `classifyPos("pronoun")` must return `other` (guard added before the `noun` substring check).
- **Task 11** `pipeline/src/embed.ts` — `cosine()` + lazy `embed()` via `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384-dim). `_embedder` typed `any`.
- **Task 12** `pipeline/src/seed.ts` — `topKPairs`, `topKTriples`.
- **Task 14 (pure logic only)** `pipeline/src/draw.ts` — `pickCombo` (coherence ranking + cooldown + floor).

**Verification at pause:** 18 tests pass (5 app + 13 pipeline), `npm run build` clean, DB schema fully migrated (0001–0004).

## ⏸ Remaining — ALL blocked on the two Kaggle datasets
Datasets needed in `pipeline/data/raw/`:
- `likithagedipudi/genz-slang-evolution-tracker-2020-2025`
- `thedevastator/common-english-parts-of-speech`

Access blocked at pause: Kaggle MCP not exposing tools, no `kaggle` CLI, no `~/.kaggle/kaggle.json`. Resolve one of: drop CSVs manually / set up CLI creds / re-activate Kaggle MCP.

### Tasks to finish once data is present
- **Task 9 (Part B)** — download both datasets into `pipeline/data/raw/`; verify `≥2` CSVs.
- **Task 13** — `pipeline/src/load.ts` (idempotent upserts: `upsertPosWords`/`upsertSlangWords`/`upsertPairs`/`upsertTriples`).
  - ⚠️ **dotenv path fix:** pipeline runs from `pipeline/` but `.env` is at repo root. Use `dotenv.config({ path: "../.env" })` (or resolve to repo root) — plain `import "dotenv/config"` will NOT find the root `.env`.
  - Uses `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from root `.env`.
- **Task 14 (Part B)** — `pipeline/src/run.ts` orchestration (ingest → clean → embed → seed → load).
  - ⚠️ **Inspect the actual CSV column layouts first** — the plan assumed `[word, pos]` for POS and `[term, meaning, era]` for slang. Verify real headers before wiring column indices. Consider a real CSV parser if quoting/commas appear in fields.
  - `TOP_K = 20`.
- **Task 15** — README run/pipeline instructions + run the acceptance checks (all four DB counts > 0; spot-check a coherent verb+noun outranks an incoherent one).

## Acceptance criteria (Sub-project 0) — pending data
- [ ] `npm run dev` serves installable PWA themed with tokens. *(buildable now; tokens approximate)*
- [x] Supabase migrations create all tables + pgvector.
- [ ] Pipeline populates `pos_words`/`slang_words`/`word_pairs`/`word_triples` with sensibly-seeded coherence.
- [ ] `pickCombo` selects per-mode respecting cooldown + floor. *(logic done + tested; needs real data end-to-end)*
- [x] All unit tests pass (app + pipeline).

## After Sub-project 0
Next: brainstorm **Sub-project 1 (Auth + Profile + Game codes)** — its own spec → plan → build. See decomposition in [../specs/2026-06-15-heartsup-design.md](../specs/2026-06-15-heartsup-design.md) §4.
