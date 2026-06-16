-- SP3 game-loop schema: lobby timer columns, round combo/keywords, RLS on rounds/feedback.

alter table lobbies add column duration_seconds int not null default 300;
alter table lobbies add column turn_ends_at timestamptz;

alter table rounds add column combo_id bigint;
alter table rounds add column combo_kind text check (combo_kind in ('single','pair','triple'));
alter table rounds add column keywords text[];   -- resolved word text (client can't read lexicon)

-- feedback.combo_kind currently allows only pair|triple; easy mode needs 'single'.
alter table feedback drop constraint feedback_combo_kind_check;
alter table feedback add constraint feedback_combo_kind_check check (combo_kind in ('single','pair','triple'));

-- Per-turn length by mode (seconds). Server-authoritative; client mirrors for display only.
create function public.turn_len(p_mode text) returns int
  language sql immutable set search_path = '' as $$
  select case p_mode when 'easy' then 45 when 'medium' then 60 when 'hard' then 75 else 60 end;
$$;

-- Member-only reads; writes happen only through the SP3 RPCs.
alter table rounds enable row level security;
alter table feedback enable row level security;

create policy "members read rounds" on rounds for select
  using (public.is_lobby_member(lobby_id));
create policy "members read feedback" on feedback for select
  using (exists (select 1 from public.rounds r
                 where r.id = feedback.round_id and public.is_lobby_member(r.lobby_id)));

grant select on public.rounds to authenticated;
grant select on public.feedback to authenticated;

-- Realtime delivery of the live card. FULL replica identity so RLS can authorize UPDATEs
-- (outcome changes) on the changed row, not just the PK.
alter table public.rounds replica identity full;
alter publication supabase_realtime add table public.rounds;
