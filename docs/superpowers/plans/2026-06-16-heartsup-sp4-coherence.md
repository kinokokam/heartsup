# heartsup Sub-project 4 — Adaptive Coherence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make keyword-combo `coherence` learn from play — nudge `word_pairs`/`word_triples.coherence` on each guessed (+) / passed (−) outcome, server-side, inside `submit_outcome`.

**Architecture:** One migration adds an `apply_feedback(combo_id, kind, signal)` `security definer` function (bounded EMA, clamped `[0,1]`, no-op for easy/`single`) and re-defines the SP3 `submit_outcome` RPC to call it after writing feedback. Backend-only: `submit_outcome`'s signature and return are unchanged, so no client/TS code changes. Decayed combos auto-suppress via SP3's existing `draw_card` floor; risen combos get drawn more via its coherence bias — no new draw logic.

**Tech Stack:** Postgres (Supabase), local DB container `supabase_db_heartsup`. `coherence` is `real` on both `word_pairs` and `word_triples`.

> **Environment notes for executors:**
> - Migrations through `0011` applied. DB verify: `docker exec supabase_db_heartsup psql -U postgres -d postgres -c "<sql>"`.
> - `word_pairs(id bigint identity, word_a_id, word_b_id, coherence real default 0, times_shown/guessed/passed int, last_used_round)`; `word_triples` adds `word_c_id`. No FK on `word_*_id`, so test rows can use arbitrary word ids.
> - `authenticated` has NO select on the lexicon/coherence tables; read them as the `postgres` superuser in tests.
> - Full TS suite + `npm run build` currently pass (100 tests) — `submit_outcome` is unchanged externally, so they must stay green.

---

## File Structure

```
supabase/migrations/0012_adaptive_coherence.sql   # apply_feedback() + submit_outcome calls it
supabase/tests/coherence.test.sql                 # nudge up/down/clamp/no-op + end-to-end submit
README.md                                          # SP4 section
```

---

## Task 1: Migration `0012_adaptive_coherence.sql` (apply_feedback + submit_outcome wiring)

**Files:** Create `supabase/migrations/0012_adaptive_coherence.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0012_adaptive_coherence.sql`:
```sql
-- SP4: adaptive coherence. Nudge a combo's coherence from each outcome (bounded EMA),
-- called inline from submit_outcome. pair/triple learn; 'single' (pos_words) has no
-- coherence column so it is a no-op. Updates run only inside this security-definer path,
-- so clients can't write coherence directly.

create function public.apply_feedback(p_combo_id bigint, p_combo_kind text, p_signal text)
  returns void language plpgsql security definer set search_path = '' as $$
declare lr real := 0.05;  -- learning rate (tunable)
begin
  if p_combo_kind = 'pair' then
    update public.word_pairs
       set coherence = greatest(0, least(1,
             case when p_signal = '+' then coherence + lr * (1 - coherence)
                  else coherence - lr * coherence end))
     where id = p_combo_id;
  elsif p_combo_kind = 'triple' then
    update public.word_triples
       set coherence = greatest(0, least(1,
             case when p_signal = '+' then coherence + lr * (1 - coherence)
                  else coherence - lr * coherence end))
     where id = p_combo_id;
  end if;
  -- 'single' (pos_words) has no coherence: no-op.
end; $$;

grant execute on function public.apply_feedback(bigint, text, text) to authenticated;

-- Re-define submit_outcome (SP3) to feed the learner after writing feedback + counters.
-- Identical to the 0011 version except for the single `perform public.apply_feedback(...)` line.
create or replace function public.submit_outcome(p_round_id bigint, p_outcome text) returns public.rounds
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

  -- SP4: nudge coherence from this outcome.
  perform public.apply_feedback(v_combo_id, v_kind, case when p_outcome = 'guessed' then '+' else '-' end);

  return public.draw_card(v_lobby);
end; $$;
```

- [ ] **Step 2: Apply**

Run: `npx supabase migration up`
Expected: `0012` applies, no error.

- [ ] **Step 3: Smoke-verify the function + nudge direction**

Run:
```bash
docker exec -i supabase_db_heartsup psql -U postgres -d postgres <<'SQL'
do $$
declare v_id bigint; v_c real;
begin
  insert into public.word_pairs (word_a_id, word_b_id, coherence) values (1, 2, 0.50) returning id into v_id;
  perform public.apply_feedback(v_id, 'pair', '+');
  select coherence into v_c from public.word_pairs where id = v_id;
  if abs(v_c - 0.525) > 0.0001 then raise exception 'expected ~0.525, got %', v_c; end if;
  raise notice 'OK: guessed nudge 0.50 -> %', v_c;
  delete from public.word_pairs where id = v_id;
end $$;
SQL
```
Expected: `NOTICE: OK: guessed nudge 0.50 -> 0.525`, no error, temp row removed.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0012_adaptive_coherence.sql
git commit -m "feat: adaptive coherence — apply_feedback EMA wired into submit_outcome"
```

---

## Task 2: DB integration test `coherence.test.sql`

**Files:** Create `supabase/tests/coherence.test.sql`

- [ ] **Step 1: Write the script**

Create `supabase/tests/coherence.test.sql`:
```sql
-- DB integration assertions for SP4 adaptive coherence. Run:
--   docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/coherence.test.sql
-- Block 1 tests apply_feedback directly (superuser is fine — no RLS surface).
-- Block 2 drives it end-to-end through submit_outcome under the authenticated role.

-- ── Block 1: apply_feedback math (up / down / clamp / single no-op) ──
do $$
declare v_id bigint; v_c real; v_c2 real;
begin
  insert into public.word_pairs (word_a_id, word_b_id, coherence) values (1, 2, 0.50) returning id into v_id;

  -- guessed raises toward 1
  perform public.apply_feedback(v_id, 'pair', '+');
  select coherence into v_c from public.word_pairs where id = v_id;
  if abs(v_c - 0.525) > 0.0001 then raise exception 'guessed nudge wrong: %', v_c; end if;
  raise notice 'OK: guessed nudge raises coherence (0.50 -> %)', v_c;

  -- many passes decay toward 0, clamped >= 0
  for i in 1..300 loop perform public.apply_feedback(v_id, 'pair', '-'); end loop;
  select coherence into v_c from public.word_pairs where id = v_id;
  if v_c < 0 then raise exception 'coherence went negative: %', v_c; end if;
  if v_c >= 0.525 then raise exception 'passes did not decay coherence: %', v_c; end if;
  raise notice 'OK: passes decay coherence, clamped >= 0 (now %)', v_c;

  -- many guesses rise toward 1, clamped <= 1
  for i in 1..500 loop perform public.apply_feedback(v_id, 'pair', '+'); end loop;
  select coherence into v_c from public.word_pairs where id = v_id;
  if v_c > 1 then raise exception 'coherence exceeded 1: %', v_c; end if;
  raise notice 'OK: guesses raise coherence, clamped <= 1 (now %)', v_c;

  -- 'single' is a no-op: the pair row is untouched
  select coherence into v_c from public.word_pairs where id = v_id;
  perform public.apply_feedback(v_id, 'single', '+');
  select coherence into v_c2 from public.word_pairs where id = v_id;
  if v_c2 <> v_c then raise exception 'single feedback should be a no-op (% -> %)', v_c, v_c2; end if;
  raise notice 'OK: single feedback is a no-op';

  delete from public.word_pairs where id = v_id;
end $$;

-- ── Block 2: end-to-end — submit_outcome(guessed) raises the drawn pair's coherence ──
do $$
declare h uuid := '00000000-0000-0000-0000-0000000000d1';
        g uuid := '00000000-0000-0000-0000-0000000000d2';
        v_lobby uuid; v_round public.rounds; v_orig real; v_after real;
begin
  insert into auth.users (id) values (h),(g);
  update public.profiles set current_game_code='COH001', display_name='H' where id=h;
  update public.profiles set display_name='G' where id=g;

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  v_lobby := public.create_lobby('medium', 180);
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  perform public.join_lobby('COH001');
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  perform public.start_game(v_lobby);
  select * into v_round from public.rounds where lobby_id=v_lobby and outcome is null order by id desc limit 1;

  -- pin the drawn pair's coherence to a known value (as superuser), then play the card
  perform set_config('role','postgres',true);
  select coherence into v_orig from public.word_pairs where id = v_round.combo_id;
  update public.word_pairs set coherence = 0.50 where id = v_round.combo_id;

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  perform public.submit_outcome(v_round.id, 'guessed');

  perform set_config('role','postgres',true);
  select coherence into v_after from public.word_pairs where id = v_round.combo_id;
  if abs(v_after - 0.525) > 0.0001 then
    raise exception 'submit_outcome(guessed) should nudge pair 0.50 -> ~0.525, got %', v_after;
  end if;
  raise notice 'OK: submit_outcome(guessed) feeds the learner (0.50 -> %)', v_after;

  -- restore the pair's coherence and clean up
  update public.word_pairs set coherence = v_orig where id = v_round.combo_id;
  delete from public.lobbies where id=v_lobby;
  delete from auth.users where id in (h,g);
exception when others then
  perform set_config('role','postgres',true);
  delete from public.lobbies where host_id='00000000-0000-0000-0000-0000000000d1';
  delete from auth.users where id in ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2');
  raise;
end $$;
```

- [ ] **Step 2: Run**

Run: `docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/coherence.test.sql`
Expected: the `OK:` notices (guessed nudge, decay+clamp, rise+clamp, single no-op, end-to-end), NO error. Confirm cleanup:
`docker exec supabase_db_heartsup psql -U postgres -d postgres -c "select count(*) from auth.users where id::text like '00000000-0000-0000-0000-0000000000d%';"` → `0`.

If anything fails (a clamp edge, a `for i` loop quirk, or the end-to-end assertion), diagnose and adapt so the committed `.sql` runs clean AND still meaningfully proves the nudge direction, clamping, no-op, and the submit_outcome wiring. Report any adaptation.

- [ ] **Step 3: Commit**
```bash
git add supabase/tests/coherence.test.sql
git commit -m "test: DB assertions for adaptive coherence (EMA nudge, clamp, no-op, end-to-end)"
```

---

## Task 3: README + full-suite/build confirmation

**Files:** Modify `README.md`

- [ ] **Step 1: Document SP4**

READ `README.md`, update the intro line to include SP4 (Adaptive Coherence Engine) alongside SP0–SP3, and append before `## Tests`:
```markdown
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
```

- [ ] **Step 2: Confirm the full suite + build stay green**

Run: `npm test -- --no-file-parallelism && npm run build`
Expected: all tests pass, build succeeds (SP4 changed no TS — this confirms `submit_outcome`'s unchanged external contract didn't break anything).

- [ ] **Step 3: Commit**
```bash
git add README.md
git commit -m "docs: SP4 adaptive coherence engine"
```

---

## Acceptance Criteria (Sub-project 4)

- [ ] Migration `0012` applies: `apply_feedback(bigint,text,text)` exists (granted to `authenticated`) and `submit_outcome` calls it after writing feedback.
- [ ] `apply_feedback` raises coherence on `+`, lowers on `-`, clamps to `[0,1]`, and no-ops for `single`.
- [ ] `submit_outcome('guessed')` measurably raises the drawn pair's coherence (end-to-end DB test).
- [ ] `coherence.test.sql` passes with clean cleanup; the full TS suite + build stay green.

## Out of scope (later)

- Time-decay / batch recompute over the feedback log; per-word propagation; LR/threshold tuning from data.
- The full Figma UI/visual pass (after all functionality).
