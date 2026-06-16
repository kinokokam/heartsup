-- SP2: lobby RLS (member-only reads), name/avatar snapshot columns, RPCs, realtime.

-- Codes only need to be unique among joinable (active) lobbies, not finished ones,
-- so a host can re-use their personal code across sessions. Replace the full-unique
-- constraint with a partial unique index.
alter table lobbies drop constraint lobbies_code_key;
create unique index lobbies_active_code_uniq on lobbies (code)
  where status in ('waiting', 'playing');

-- Snapshot the player's name/avatar onto the roster row at join time, so the roster
-- renders without a cross-user read of profiles (profiles RLS stays owner-only).
alter table lobby_players add column display_name text;
alter table lobby_players add column avatar text;

-- Member-only reads. No client insert/update/delete — all writes go through the RPCs below.
alter table lobbies enable row level security;
alter table lobby_players enable row level security;

create policy "members read lobby" on lobbies for select
  using (exists (select 1 from lobby_players lp
                 where lp.lobby_id = lobbies.id and lp.profile_id = auth.uid()));

create policy "members read roster" on lobby_players for select
  using (exists (select 1 from lobby_players self
                 where self.lobby_id = lobby_players.lobby_id and self.profile_id = auth.uid()));

-- Create a lobby using the caller's current personal game code as the lobby code.
create function create_lobby(p_mode text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare v_code text; v_name text; v_avatar text; v_lobby uuid;
begin
  if p_mode not in ('easy','medium','hard') then
    raise exception 'invalid_mode';
  end if;
  select current_game_code, display_name, avatar
    into v_code, v_name, v_avatar
    from public.profiles where id = auth.uid();
  if v_code is null then
    raise exception 'no_game_code';
  end if;
  if exists (select 1 from public.lobbies
             where host_id = auth.uid() and status in ('waiting','playing')) then
    raise exception 'already_hosting';
  end if;
  insert into public.lobbies (code, host_id, mode, status)
    values (v_code, auth.uid(), p_mode, 'waiting')
    returning id into v_lobby;
  insert into public.lobby_players (lobby_id, profile_id, display_name, avatar)
    values (v_lobby, auth.uid(), v_name, v_avatar);
  return v_lobby;
end; $$;

-- Resolve a waiting lobby by code and add the caller (idempotent; capped at 8).
create function join_lobby(p_code text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare v_lobby uuid; v_count int; v_name text; v_avatar text;
begin
  select id into v_lobby from public.lobbies
    where code = upper(trim(p_code)) and status = 'waiting';
  if v_lobby is null then
    raise exception 'lobby_not_found';
  end if;
  if exists (select 1 from public.lobby_players
             where lobby_id = v_lobby and profile_id = auth.uid()) then
    return v_lobby; -- already a member
  end if;
  select count(*) into v_count from public.lobby_players where lobby_id = v_lobby;
  if v_count >= 8 then
    raise exception 'lobby_full';
  end if;
  select display_name, avatar into v_name, v_avatar
    from public.profiles where id = auth.uid();
  insert into public.lobby_players (lobby_id, profile_id, display_name, avatar)
    values (v_lobby, auth.uid(), v_name, v_avatar);
  return v_lobby;
end; $$;

-- Host leaving closes the lobby; a guest leaving removes only their row.
create function leave_lobby(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.lobbies
             where id = p_lobby_id and host_id = auth.uid()) then
    update public.lobbies set status = 'finished' where id = p_lobby_id;
  else
    delete from public.lobby_players
      where lobby_id = p_lobby_id and profile_id = auth.uid();
  end if;
end; $$;

-- Host-only start; requires >=2 players and a waiting lobby.
create function start_game(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if not exists (select 1 from public.lobbies
                 where id = p_lobby_id and host_id = auth.uid() and status = 'waiting') then
    raise exception 'not_host_or_not_waiting';
  end if;
  select count(*) into v_count from public.lobby_players where lobby_id = p_lobby_id;
  if v_count < 2 then
    raise exception 'not_enough_players';
  end if;
  update public.lobbies set status = 'playing' where id = p_lobby_id;
end; $$;

grant execute on function create_lobby(text) to authenticated;
grant execute on function join_lobby(text)   to authenticated;
grant execute on function leave_lobby(uuid)  to authenticated;
grant execute on function start_game(uuid)   to authenticated;

-- Realtime: publish roster + lobby row changes so clients get live updates.
alter publication supabase_realtime add table public.lobby_players;
alter publication supabase_realtime add table public.lobbies;
