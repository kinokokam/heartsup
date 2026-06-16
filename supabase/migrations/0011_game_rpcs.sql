-- SP3 game-loop RPCs. All security definer, scoped to auth.uid()/membership.

-- create_lobby gains a host-picked total duration (3/5/10 min). Replaces the SP2 1-arg form.
drop function if exists public.create_lobby(text);
create function public.create_lobby(p_mode text, p_duration_seconds int default 300) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare v_code text; v_name text; v_avatar text; v_lobby uuid;
begin
  if p_mode not in ('easy','medium','hard') then raise exception 'invalid_mode'; end if;
  if p_duration_seconds not in (180, 300, 600) then raise exception 'invalid_duration'; end if;
  select current_game_code, display_name, avatar into v_code, v_name, v_avatar
    from public.profiles where id = auth.uid();
  if v_code is null then raise exception 'no_game_code'; end if;
  if exists (select 1 from public.lobbies where host_id = auth.uid() and status in ('waiting','playing')) then
    raise exception 'already_hosting';
  end if;
  insert into public.lobbies (code, host_id, mode, status, duration_seconds)
    values (v_code, auth.uid(), p_mode, 'waiting', p_duration_seconds) returning id into v_lobby;
  insert into public.lobby_players (lobby_id, profile_id, display_name, avatar)
    values (v_lobby, auth.uid(), v_name, v_avatar);
  return v_lobby;
end; $$;

-- Draw a card for the lobby's current guesser: random rating + a mode-appropriate keyword combo,
-- suppressing low coherence and combos used in this lobby's last 5 rounds. Resolves word text
-- into rounds.keywords (clients cannot read the lexicon tables). Returns the new round.
create function public.draw_card(p_lobby_id uuid) returns public.rounds
  language plpgsql security definer set search_path = '' as $$
declare v_mode text; v_player uuid; v_rating int;
        v_combo_id bigint; v_kind text; v_ids bigint[]; v_words text[];
        v_round public.rounds; v_floor real := 0.15;
begin
  select mode into v_mode from public.lobbies where id = p_lobby_id;
  select profile_id into v_player from public.lobby_players
    where lobby_id = p_lobby_id and is_current_turn limit 1;
  v_rating := floor(random() * 10)::int + 1;  -- 1..10

  if v_mode = 'easy' then
    v_kind := 'single';
    select w.id, array[w.id], array[w.word] into v_combo_id, v_ids, v_words
    from public.pos_words w
    where w.id not in (
      select r.combo_id from public.rounds r
      where r.lobby_id = p_lobby_id and r.combo_kind = 'single' and r.combo_id is not null
      order by r.id desc limit 5)
    order by random() limit 1;
  elsif v_mode = 'medium' then
    v_kind := 'pair';
    select s.id, array[s.a, s.b], array[s.wa, s.wb] into v_combo_id, v_ids, v_words
    from (
      select p.id, p.word_a_id a, p.word_b_id b, wa.word wa, wb.word wb
      from public.word_pairs p
      join public.pos_words wa on wa.id = p.word_a_id
      join public.pos_words wb on wb.id = p.word_b_id
      where p.coherence >= v_floor
        and p.id not in (
          select r.combo_id from public.rounds r
          where r.lobby_id = p_lobby_id and r.combo_kind = 'pair' and r.combo_id is not null
          order by r.id desc limit 5)
      order by p.coherence desc limit 50
    ) s order by random() limit 1;
  else
    v_kind := 'triple';
    select s.id, array[s.a, s.b, s.c], array[s.wa, s.wb, s.wc] into v_combo_id, v_ids, v_words
    from (
      select t.id, t.word_a_id a, t.word_b_id b, t.word_c_id c, wa.word wa, wb.word wb, wc.word wc
      from public.word_triples t
      join public.pos_words wa on wa.id = t.word_a_id
      join public.pos_words wb on wb.id = t.word_b_id
      join public.pos_words wc on wc.id = t.word_c_id
      where t.coherence >= v_floor
        and t.id not in (
          select r.combo_id from public.rounds r
          where r.lobby_id = p_lobby_id and r.combo_kind = 'triple' and r.combo_id is not null
          order by r.id desc limit 5)
      order by t.coherence desc limit 50
    ) s order by random() limit 1;
  end if;

  if v_combo_id is null then raise exception 'no_keywords_available'; end if;

  insert into public.rounds (lobby_id, player_id, rating, keyword_ids, combo_id, combo_kind, keywords)
    values (p_lobby_id, v_player, v_rating, v_ids, v_combo_id, v_kind, v_words)
    returning * into v_round;

  if v_kind = 'pair' then
    update public.word_pairs set times_shown = times_shown + 1 where id = v_combo_id;
  elsif v_kind = 'triple' then
    update public.word_triples set times_shown = times_shown + 1 where id = v_combo_id;
  end if;

  return v_round;
end; $$;

-- Host starts: timers + first guesser + first card. Replaces the SP2 start_game.
create or replace function public.start_game(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_mode text; v_dur int; v_first uuid;
begin
  select mode, duration_seconds into v_mode, v_dur from public.lobbies
    where id = p_lobby_id and host_id = auth.uid() and status = 'waiting';
  if not found then raise exception 'not_host_or_not_waiting'; end if;
  if (select count(*) from public.lobby_players where lobby_id = p_lobby_id) < 2 then
    raise exception 'not_enough_players';
  end if;
  select profile_id into v_first from public.lobby_players
    where lobby_id = p_lobby_id order by joined_at asc limit 1;
  update public.lobby_players set is_current_turn = (profile_id = v_first) where lobby_id = p_lobby_id;
  update public.lobbies
    set status = 'playing',
        game_ends_at = now() + make_interval(secs => v_dur),
        turn_ends_at = now() + make_interval(secs => public.turn_len(v_mode))
    where id = p_lobby_id;
  perform public.draw_card(p_lobby_id);
end; $$;

-- Guesser records a card outcome; scores, writes feedback, draws the next card. Returns new round.
create function public.submit_outcome(p_round_id bigint, p_outcome text) returns public.rounds
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

  return public.draw_card(v_lobby);
end; $$;

-- Rotate to the next guesser once the turn timer has elapsed (any member may trigger).
create function public.advance_turn(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_mode text; v_status text; v_turn_ends timestamptz; v_cur uuid; v_next uuid; v_cur_joined timestamptz;
begin
  if not public.is_lobby_member(p_lobby_id) then raise exception 'not_a_member'; end if;
  select mode, status, turn_ends_at into v_mode, v_status, v_turn_ends
    from public.lobbies where id = p_lobby_id;
  if v_status <> 'playing' then raise exception 'game_not_playing'; end if;
  if now() < v_turn_ends then raise exception 'turn_not_over'; end if;

  update public.rounds set outcome = 'passed', ended_at = now()
    where lobby_id = p_lobby_id and outcome is null;

  select profile_id into v_cur from public.lobby_players
    where lobby_id = p_lobby_id and is_current_turn limit 1;
  select joined_at into v_cur_joined from public.lobby_players
    where lobby_id = p_lobby_id and profile_id = v_cur;
  select profile_id into v_next from public.lobby_players
    where lobby_id = p_lobby_id and joined_at > v_cur_joined order by joined_at asc limit 1;
  if v_next is null then
    select profile_id into v_next from public.lobby_players
      where lobby_id = p_lobby_id order by joined_at asc limit 1;
  end if;

  update public.lobby_players set is_current_turn = (profile_id = v_next) where lobby_id = p_lobby_id;
  update public.lobbies set turn_ends_at = now() + make_interval(secs => public.turn_len(v_mode))
    where id = p_lobby_id;
  perform public.draw_card(p_lobby_id);
end; $$;

-- End the game once the total timer has elapsed. Idempotent; any member may call.
create function public.finish_game(p_lobby_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_status text; v_ends timestamptz;
begin
  if not public.is_lobby_member(p_lobby_id) then raise exception 'not_a_member'; end if;
  select status, game_ends_at into v_status, v_ends from public.lobbies where id = p_lobby_id;
  if v_status = 'playing' and now() >= v_ends then
    update public.rounds set outcome = 'passed', ended_at = now()
      where lobby_id = p_lobby_id and outcome is null;
    update public.lobbies set status = 'finished' where id = p_lobby_id;
  end if;
end; $$;

grant execute on function public.create_lobby(text, int)    to authenticated;
grant execute on function public.draw_card(uuid)            to authenticated;
grant execute on function public.start_game(uuid)           to authenticated;
grant execute on function public.submit_outcome(bigint, text) to authenticated;
grant execute on function public.advance_turn(uuid)         to authenticated;
grant execute on function public.finish_game(uuid)          to authenticated;
