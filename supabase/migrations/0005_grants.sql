-- The data pipeline seeds the lexicon + coherence tables using the service_role key.
-- Tables created by migrations did not inherit default privileges for service_role,
-- so grant them explicitly. service_role is the trusted backend key (never exposed to
-- clients); client-facing RLS policies for anon/authenticated are added in a later
-- sub-project (Auth + lobbies).
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Ensure future tables in public are likewise accessible to service_role.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
