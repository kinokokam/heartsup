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
