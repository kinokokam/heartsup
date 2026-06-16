-- Owner-only RLS on profiles (deferred from SP0).
alter table profiles enable row level security;
create policy "own profile read"   on profiles for select using (auth.uid() = id);
create policy "own profile insert" on profiles for insert with check (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);

-- Auto-create a profile row for every new auth user.
create function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id) values (new.id);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- One active (non-null) game code per value, across all logged-in users.
create unique index profiles_active_code_uniq on profiles (current_game_code)
  where current_game_code is not null;

-- Atomically assign a fresh unique 6-char code to the caller; retry on collision.
create function assign_game_code() returns text language plpgsql security definer as $$
declare code text; chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    code := '';
    for i in 1..6 loop code := code || substr(chars, floor(random()*length(chars))::int + 1, 1); end loop;
    begin
      update profiles set current_game_code = code where id = auth.uid();
      return code;
    exception when unique_violation then
      -- collided with another active code; loop and try again
    end;
  end loop;
end; $$;

create function clear_game_code() returns void language plpgsql security definer as $$
begin
  update profiles set current_game_code = null where id = auth.uid();
end; $$;

grant execute on function assign_game_code() to authenticated;
grant execute on function clear_game_code() to authenticated;
