-- DB integration assertions for SP2 lobby RPCs. Run against the live local DB:
--   docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/lobby.test.sql
--
-- These run the reads as the `authenticated` role (via `set role` + request.jwt.claims) so
-- the member-only RLS policies are actually enforced — superuser bypasses RLS, which would
-- make the read assertions vacuous (and would not catch policy recursion). Seeding and
-- cleanup run as the superuser; the SP1 handle_new_user trigger auto-creates profiles rows.
-- lobbies.host_id -> profiles is ON DELETE NO ACTION, so test lobbies are deleted before
-- auth.users (which cascades to profiles); lobby_players cascades from the lobbies delete.

-- ── Block 1: create → start-gate → join → member RLS read → start → host-leave-closes ──
do $$
declare h uuid := '00000000-0000-0000-0000-0000000000a1'; -- host
        g uuid := '00000000-0000-0000-0000-0000000000a2'; -- guest
        v_lobby uuid; v_status text; v_seen int;
begin
  insert into auth.users (id) values (h), (g);
  update public.profiles set current_game_code = 'HOST01', display_name = 'Host' where id = h;
  update public.profiles set display_name = 'Guest' where id = g;

  perform set_config('role', 'authenticated', true);

  -- Host creates a lobby; its code is the host's personal game code.
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

  -- Guest joins (case-insensitive code).
  perform set_config('request.jwt.claims', json_build_object('sub', g)::text, true);
  if public.join_lobby('host01') <> v_lobby then
    raise exception 'expected join to resolve same lobby (case-insensitive)';
  end if;
  raise notice 'OK: join_lobby resolves the lobby by code';

  -- RLS (enforced under the authenticated role): a member can read their lobby.
  -- This is also the path that previously hit infinite policy recursion.
  select count(*) into v_seen from public.lobbies where id = v_lobby;
  if v_seen <> 1 then raise exception 'expected member to read their lobby under RLS, saw %', v_seen; end if;
  raise notice 'OK: member can read their lobby under RLS (no recursion)';

  -- Host starts (2 players) and then leaves to close the lobby.
  perform set_config('request.jwt.claims', json_build_object('sub', h)::text, true);
  perform public.start_game(v_lobby);
  select status into v_status from public.lobbies where id = v_lobby;
  if v_status <> 'playing' then raise exception 'expected status playing'; end if;
  raise notice 'OK: start_game flips status to playing with 2 players';

  perform public.leave_lobby(v_lobby);
  select status into v_status from public.lobbies where id = v_lobby;
  if v_status <> 'finished' then raise exception 'expected status finished after host leave'; end if;
  raise notice 'OK: host leave closes the lobby';

  perform set_config('role', 'postgres', true);
  delete from public.lobbies where host_id in (h, g);
  delete from auth.users where id in (h, g);
exception when others then
  perform set_config('role', 'postgres', true);
  delete from public.lobbies where host_id in (h, g);
  delete from auth.users where id in (h, g);
  raise;
end $$;

-- ── Block 2: 8-player cap (9th rejected) + non-member RLS denial ──
do $$
declare host uuid := '00000000-0000-0000-0000-0000000000b0';
        ninth uuid := '00000000-0000-0000-0000-0000000000b8';
        nonmember uuid := '00000000-0000-0000-0000-0000000000b9';
        guests uuid[] := array[
          '00000000-0000-0000-0000-0000000000b1'::uuid,
          '00000000-0000-0000-0000-0000000000b2',
          '00000000-0000-0000-0000-0000000000b3',
          '00000000-0000-0000-0000-0000000000b4',
          '00000000-0000-0000-0000-0000000000b5',
          '00000000-0000-0000-0000-0000000000b6',
          '00000000-0000-0000-0000-0000000000b7'];
        v_lobby uuid; gu uuid; v_count int;
begin
  insert into auth.users (id) values (host), (ninth), (nonmember);
  insert into auth.users (id) select unnest(guests);
  update public.profiles set current_game_code = 'CAP001' where id = host;

  perform set_config('role', 'authenticated', true);

  -- Host creates (1 player), then 7 guests join → 8 total (the cap).
  perform set_config('request.jwt.claims', json_build_object('sub', host)::text, true);
  v_lobby := public.create_lobby('easy');
  foreach gu in array guests loop
    perform set_config('request.jwt.claims', json_build_object('sub', gu)::text, true);
    perform public.join_lobby('CAP001');
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', host)::text, true);
  select count(*) into v_count from public.lobby_players where lobby_id = v_lobby;
  if v_count <> 8 then raise exception 'expected 8 players seated, got %', v_count; end if;
  raise notice 'OK: lobby seats up to 8 players';

  -- The 9th join is rejected.
  perform set_config('request.jwt.claims', json_build_object('sub', ninth)::text, true);
  begin
    perform public.join_lobby('CAP001');
    raise exception 'expected lobby_full';
  exception when others then
    if sqlerrm not like '%lobby_full%' then raise; end if;
    raise notice 'OK: join_lobby rejects the 9th player (cap 8)';
  end;

  -- A non-member cannot read the lobby or its roster under RLS.
  perform set_config('request.jwt.claims', json_build_object('sub', nonmember)::text, true);
  if (select count(*) from public.lobbies where id = v_lobby) <> 0 then
    raise exception 'RLS should hide the lobby from a non-member';
  end if;
  if (select count(*) from public.lobby_players where lobby_id = v_lobby) <> 0 then
    raise exception 'RLS should hide the roster from a non-member';
  end if;
  raise notice 'OK: RLS hides lobby + roster from a non-member';

  perform set_config('role', 'postgres', true);
  delete from public.lobbies where host_id = host;
  delete from auth.users where id = host or id = ninth or id = nonmember;
  delete from auth.users where id in (select unnest(guests));
exception when others then
  perform set_config('role', 'postgres', true);
  delete from public.lobbies where host_id = '00000000-0000-0000-0000-0000000000b0';
  delete from auth.users where id::text like '00000000-0000-0000-0000-0000000000b%';
  raise;
end $$;

-- RLS sanity: RLS is enabled on both tables.
select relname, relrowsecurity from pg_class where relname in ('lobbies','lobby_players') order by relname;
