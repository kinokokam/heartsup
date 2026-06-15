create table word_pairs (
  id bigint generated always as identity primary key,
  word_a_id bigint not null,
  word_b_id bigint not null,
  coherence real not null default 0,
  times_shown int not null default 0,
  times_guessed int not null default 0,
  times_passed int not null default 0,
  last_used_round bigint,
  unique (word_a_id, word_b_id)
);

create table word_triples (
  id bigint generated always as identity primary key,
  word_a_id bigint not null,
  word_b_id bigint not null,
  word_c_id bigint not null,
  coherence real not null default 0,
  times_shown int not null default 0,
  times_guessed int not null default 0,
  times_passed int not null default 0,
  last_used_round bigint,
  unique (word_a_id, word_b_id, word_c_id)
);

create index on word_pairs (coherence desc);
create index on word_triples (coherence desc);
