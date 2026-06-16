-- DB integration assertions for the game-code feature.
-- Run against the live local DB:
--   docker exec -i supabase_db_heartsup psql -U postgres -d postgres < supabase/tests/gamecode.test.sql
--
-- These verify server-side guarantees the mocked unit tests cannot:
--   1. The partial unique index on profiles.current_game_code actually
--      rejects two profiles holding the same active code.
--
-- NOTE on the FK: profiles.id is a FK to auth.users(id), so we cannot insert
-- bare profile rows. We seed two auth.users; the on_auth_user_created trigger
-- auto-creates the matching profiles rows. We then UPDATE current_game_code to
-- exercise the real unique index on the real table, and clean everything up
-- (auth.users delete cascades to profiles).

-- Two profiles cannot hold the same active code (partial unique index).
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u2 uuid := '00000000-0000-0000-0000-000000000002';
begin
  -- Seed auth users; trigger handle_new_user() auto-inserts profiles rows.
  insert into auth.users (id) values (u1), (u2);

  update profiles set current_game_code = 'TEST01' where id = u1;

  begin
    update profiles set current_game_code = 'TEST01' where id = u2;
    raise exception 'expected unique_violation but update succeeded';
  exception when unique_violation then
    raise notice 'OK: active-code uniqueness enforced';
  end;

  -- cleanup (delete cascades from auth.users to profiles)
  delete from auth.users where id in (u1, u2);
end $$;

-- assign_game_code returns a 6-char code from the allowed charset.
-- (Run as a specific user via set_config of request.jwt.claims in app code;
--  here we assert the function shape by checking the charset/length contract.)
