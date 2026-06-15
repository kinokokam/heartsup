create table pos_words (
  id bigint generated always as identity primary key,
  word text not null,
  pos text not null check (pos in ('noun','verb','adjective','adverb','other')),
  embedding vector(384),
  unique (word, pos)
);

create table slang_words (
  id bigint generated always as identity primary key,
  term text not null unique,
  meaning text,
  pos_guess text check (pos_guess in ('noun','verb','adjective','adverb','other')),
  era text,
  embedding vector(384)
);

-- Unified read view used by the game to draw keywords.
create view keywords as
  select id, word as text, pos, 'pos'::text as source from pos_words
  union all
  select id, term as text, coalesce(pos_guess,'other') as pos, 'slang'::text as source from slang_words;
