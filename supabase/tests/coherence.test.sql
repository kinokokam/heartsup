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

-- ── Block 1b: the triple branch nudges word_triples (symmetry with pair) ──
do $$
declare v_id bigint; v_c real;
begin
  insert into public.word_triples (word_a_id, word_b_id, word_c_id, coherence)
    values (1, 2, 3, 0.50) returning id into v_id;
  perform public.apply_feedback(v_id, 'triple', '+');
  select coherence into v_c from public.word_triples where id = v_id;
  if abs(v_c - 0.525) > 0.0001 then raise exception 'triple guessed nudge wrong: %', v_c; end if;
  perform public.apply_feedback(v_id, 'triple', '-');
  select coherence into v_c from public.word_triples where id = v_id;
  if v_c >= 0.525 then raise exception 'triple passed did not decay: %', v_c; end if;
  raise notice 'OK: triple branch nudges word_triples up then down';
  delete from public.word_triples where id = v_id;
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
