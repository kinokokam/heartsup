# heartsup Sub-project 4 — Adaptive Coherence Engine — Design Spec

**Date:** 2026-06-16
**Status:** Approved
**Depends on:** SP0 (seeded `word_pairs`/`word_triples` coherence), SP3 (writes `feedback` rows +
combo counters; enforces cooldown + suppression in `draw_card`). See
[2026-06-15-heartsup-design.md](2026-06-15-heartsup-design.md) for the whole-system design and
[2026-06-16-heartsup-sp3-game-loop-design.md](2026-06-16-heartsup-sp3-game-loop-design.md).

## 1. Goal

Make keyword-combo `coherence` **learn from play**. SP0 seeded `coherence` by embedding cosine
similarity; SP3 records each card's outcome as a `feedback` row (`+` guessed / `-` passed) and
bumps `times_shown/guessed/passed`, and already enforces the **per-lobby 5-round cooldown** and
**low-coherence suppression (≥ 0.15)** inside `draw_card`. SP4 adds the missing piece: **nudge a
combo's `coherence` on each outcome**, server-side, so the community gradually trains which combos
are actually riffable. Combos players keep guessing drift up (drawn more, since `draw_card` biases
by coherence); combos they keep passing decay until they cross below the suppression floor and stop
being drawn — connecting the two existing mechanics with no new draw logic.

This is the final functional sub-project. It is **backend-only**: `submit_outcome`'s signature and
return value are unchanged, so `lib/game.ts` and the screens are untouched.

## 2. Decisions (locked)

| Concern | Decision |
|---|---|
| Update timing | **Inline** — `submit_outcome` calls a new `apply_feedback(combo_id, kind, signal)` immediately after writing the feedback row + bumping counters |
| Formula | **Bounded EMA.** guessed: `coherence := coherence + LR·(1 − coherence)`; passed: `coherence := coherence − LR·coherence`. `LR = 0.05` (a tunable constant in the function). Result clamped to `[0,1]`. |
| Seed handling | **Mutate `coherence` directly** — no schema/column change; the SP0 similarity is the starting point and feedback drifts it |
| Easy mode (`single`) | A `single` combo is a `pos_words` row with **no `coherence` column → `apply_feedback` is a no-op**; only `pair`/`triple` learn |
| Authority | Update runs only inside a `security definer` function reachable via `submit_outcome` (itself guesser-scoped), so coherence can't be written directly by clients or gamed |

**Why EMA:** it is self-clamping near the bounds (a combo near 1 barely rises on another guess; a
combo near 0 barely falls), needs no separate base column, and is monotone per signal — easy to
reason about and to assert in tests.

## 3. Data & server logic — migration `0012_adaptive_coherence.sql`

No schema changes. Two function definitions:

**A. `apply_feedback(p_combo_id bigint, p_combo_kind text, p_signal text) returns void`**
(`language plpgsql security definer set search_path = ''`, granted to `authenticated`):
```
LR constant = 0.05
if p_combo_kind = 'pair':
   update public.word_pairs
     set coherence = greatest(0, least(1,
         case when p_signal = '+' then coherence + LR * (1 - coherence)
              else coherence - LR * coherence end))
   where id = p_combo_id;
elsif p_combo_kind = 'triple':
   same update against public.word_triples
-- 'single' (and any other kind): no-op (pos_words has no coherence)
```

**B. `create or replace function submit_outcome(...)`** — the SP3 RPC, unchanged except that
**after** the existing `feedback` insert + `times_guessed/times_passed` bump it calls
`perform public.apply_feedback(v_combo_id, v_kind, case when p_outcome='guessed' then '+' else '-' end);`
Scoring, drawing the next card, the return value, and all guards stay exactly as SP3 defined them.

The clamp keeps `coherence` in `[0,1]`. Seeded cosine values are already ≤ 1; the floor protects
against any pre-existing 0/negative seed. Because `draw_card` (SP3) suppresses `coherence < 0.15`,
a combo that decays past that floor is automatically dropped from future draws with no extra code.

## 4. Testing

- **DB integration** (`supabase/tests/coherence.test.sql`, run via `docker exec … psql`; the
  function is a plain server function so a superuser block is fine — no RLS surface here):
  - Seed a `word_pairs` row at a known `coherence` (e.g. 0.50). Call `apply_feedback(id,'pair','+')`
    → assert `coherence` rose and `≈ 0.50 + 0.05·0.50 = 0.525` (within a tolerance), and stays ≤ 1.
  - Call `apply_feedback(id,'pair','-')` several times → assert it strictly decreases each time and
    clamps ≥ 0 (never negative).
  - Call `apply_feedback(id,'single','+')` → assert it does nothing (no error, the pair row that
    happens to share the id is untouched / there is no single coherence to change).
  - End-to-end: seed two users + a medium lobby, `start_game`, capture the drawn round's
    `combo_id`/its current `coherence`, `submit_outcome(round,'guessed')`, then assert that pair's
    `coherence` increased — proving `submit_outcome` now feeds the learner. Clean up all test rows.
- **Regression:** run the full TS suite + build — `submit_outcome`'s signature/return are unchanged,
  so nothing client-side should break; this just confirms it.

## 5. Out of scope / later

- Time-decay or recency-weighting of old feedback (EMA already favors recent outcomes implicitly);
  a batch `recompute_coherence()` over the feedback log.
- Per-word (rather than per-combo) propagation; learning-rate A/B; tuning `LR` or the 0.15
  suppression floor from data.
- Generating/seeding new combos as vocabulary grows (data-pipeline concern).
- The full Figma UI/visual pass — still scheduled after all functionality lands.
