-- Fix infinite recursion in the SP2 lobby RLS policies.
--
-- The 0008 policies were mutually/self-recursive: reading `lobbies` ran a subquery
-- against `lobby_players`, which applied `lobby_players`' own SELECT policy, which
-- itself subqueried `lobby_players` again -> "infinite recursion detected in policy".
-- (Superuser bypasses RLS, so this only manifests under the `authenticated` role —
-- i.e. in the real app.)
--
-- Standard fix: do the membership check inside a SECURITY DEFINER function. Because it
-- runs as the owner with RLS bypassed internally, the policy no longer re-enters itself.

create function public.is_lobby_member(p_lobby uuid) returns boolean
  language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.lobby_players
    where lobby_id = p_lobby and profile_id = auth.uid()
  );
$$;

grant execute on function public.is_lobby_member(uuid) to authenticated;

drop policy "members read lobby" on lobbies;
drop policy "members read roster" on lobby_players;

create policy "members read lobby" on lobbies for select
  using (public.is_lobby_member(id));

create policy "members read roster" on lobby_players for select
  using (public.is_lobby_member(lobby_id));

-- Base table privileges for the `authenticated` role. SP0's 0005_grants only granted
-- service_role; RLS policies restrict WHICH rows a caller sees, but the role still needs
-- table-level grants. Reads run as `authenticated` (PostgREST + Realtime change delivery);
-- lobby writes go through the security-definer RPCs, so the lobby tables need SELECT only.
-- `profiles` also needs SELECT + UPDATE here because SP1 reads/updates it directly as
-- `authenticated` (closes a latent SP0/SP1 grant gap that only surfaces under the real role;
-- the auto-insert is done by the security-definer handle_new_user trigger, so no INSERT grant).
grant select on public.lobbies to authenticated;
grant select on public.lobby_players to authenticated;
grant select, update on public.profiles to authenticated;
