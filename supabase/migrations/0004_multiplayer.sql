create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar text,
  current_game_code text,
  created_at timestamptz not null default now()
);

create table lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid references profiles(id),
  mode text not null check (mode in ('easy','medium','hard')),
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  game_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table lobby_players (
  lobby_id uuid references lobbies(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  score int not null default 0,
  is_current_turn boolean not null default false,
  primary key (lobby_id, profile_id)
);

create table rounds (
  id bigint generated always as identity primary key,
  lobby_id uuid references lobbies(id) on delete cascade,
  player_id uuid references profiles(id),
  rating int not null check (rating between 1 and 10),
  keyword_ids bigint[] not null,
  outcome text check (outcome in ('guessed','passed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table feedback (
  id bigint generated always as identity primary key,
  round_id bigint references rounds(id) on delete cascade,
  combo_id bigint not null,
  combo_kind text not null check (combo_kind in ('pair','triple')),
  signal text not null check (signal in ('+','-')),
  created_at timestamptz not null default now()
);
