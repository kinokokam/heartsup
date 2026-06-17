-- DB integration assertions for the SP3 game loop. Run:
--   docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/game.test.sql
-- Runs as the authenticated role so RLS is enforced. Seeds/cleans up as superuser.

do $$
declare h uuid := '00000000-0000-0000-0000-0000000000c1';
        g uuid := '00000000-0000-0000-0000-0000000000c2';
        nm uuid := '00000000-0000-0000-0000-0000000000c3';
        v_lobby uuid; v_round public.rounds; v_next public.rounds; v_score int; v_fb int; v_seen int;
begin
  insert into auth.users (id) values (h),(g),(nm);
  update public.profiles set current_game_code='GAME01', display_name='H' where id=h;
  update public.profiles set display_name='G' where id=g;

  perform set_config('role','authenticated',true);

  -- create (medium = pairs), join, start
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  v_lobby := public.create_lobby('medium', 180);
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  perform public.join_lobby('GAME01');
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  perform public.start_game(v_lobby);

  select * into v_round from public.rounds where lobby_id=v_lobby and outcome is null order by id desc limit 1;
  if v_round.combo_kind <> 'pair' or array_length(v_round.keywords,1) <> 2 then
    raise exception 'expected a 2-word pair card, got kind=% kw=%', v_round.combo_kind, v_round.keywords;
  end if;
  if v_round.rating < 1 or v_round.rating > 10 then raise exception 'rating out of range: %', v_round.rating; end if;
  raise notice 'OK: start_game seats host and draws a pair card (rating %, words %)', v_round.rating, v_round.keywords;

  -- guesser scores; feedback + next card
  v_next := public.submit_outcome(v_round.id, 'guessed');
  select score into v_score from public.lobby_players where lobby_id=v_lobby and profile_id=h;
  if v_score <> 1 then raise exception 'expected host score 1, got %', v_score; end if;
  select count(*) into v_fb from public.feedback where round_id=v_round.id and signal='+';
  if v_fb <> 1 then raise exception 'expected one + feedback row'; end if;
  if v_next.id = v_round.id or v_next.outcome is not null then raise exception 'expected a fresh next card'; end if;
  raise notice 'OK: submit_outcome scores, writes feedback, draws next card';

  -- a non-guesser cannot submit
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  begin
    perform public.submit_outcome(v_next.id, 'guessed');
    raise exception 'expected not_your_turn';
  exception when others then
    if sqlerrm not like '%not_your_turn%' then raise; end if;
    raise notice 'OK: a non-guesser cannot submit (not_your_turn)';
  end;

  -- advance_turn rejected before the timer, allowed after
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  begin
    perform public.advance_turn(v_lobby);
    raise exception 'expected turn_not_over';
  exception when others then
    if sqlerrm not like '%turn_not_over%' then raise; end if;
    raise notice 'OK: advance_turn blocked before turn_ends_at';
  end;
  perform set_config('role','postgres',true);
  update public.lobbies set turn_ends_at = now() - interval '1 second' where id=v_lobby;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  perform public.advance_turn(v_lobby);
  if (select profile_id from public.lobby_players where lobby_id=v_lobby and is_current_turn) <> g then
    raise exception 'expected turn to rotate to guest';
  end if;
  raise notice 'OK: advance_turn rotates to the next player after the timer';

  -- RLS: a non-member cannot read the rounds
  perform set_config('request.jwt.claims', json_build_object('sub', nm)::text, true);
  select count(*) into v_seen from public.rounds where lobby_id=v_lobby;
  if v_seen <> 0 then raise exception 'RLS should hide rounds from a non-member, saw %', v_seen; end if;
  raise notice 'OK: RLS hides rounds from a non-member';

  -- finish after the game timer
  perform set_config('role','postgres',true);
  update public.lobbies set game_ends_at = now() - interval '1 second' where id=v_lobby;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  perform public.finish_game(v_lobby);
  if (select status from public.lobbies where id=v_lobby) <> 'finished' then
    raise exception 'expected status finished';
  end if;
  raise notice 'OK: finish_game ends the game after game_ends_at';

  perform set_config('role','postgres',true);
  delete from public.lobbies where id=v_lobby;
  delete from auth.users where id in (h,g,nm);
exception when others then
  perform set_config('role','postgres',true);
  delete from public.lobbies where host_id='00000000-0000-0000-0000-0000000000c1';
  delete from auth.users where id in ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3');
  raise;
end $$;
