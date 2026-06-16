-- Harden SECURITY DEFINER functions by pinning an empty search_path (Supabase advisory).
-- Recreate the three definer functions from 0006 with `set search_path = ''` and
-- schema-qualify all object references. `create or replace` keeps the existing
-- `on_auth_user_created` trigger (which references handle_new_user by name) working.

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end; $$;

create or replace function public.assign_game_code() returns text language plpgsql security definer set search_path = '' as $$
declare code text; chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    code := '';
    for i in 1..6 loop code := code || substr(chars, floor(random()*length(chars))::int + 1, 1); end loop;
    begin
      update public.profiles set current_game_code = code where id = auth.uid();
      return code;
    exception when unique_violation then
      -- collided with another active code; loop and try again
    end;
  end loop;
end; $$;

create or replace function public.clear_game_code() returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set current_game_code = null where id = auth.uid();
end; $$;
