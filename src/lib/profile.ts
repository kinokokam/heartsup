import { supabase } from "./supabaseClient";

export interface Profile {
  id: string;
  display_name: string | null;
  avatar: string | null;
  current_game_code: string | null;
}

export async function getProfile(): Promise<Profile | null> {
  // Owner-only RLS scopes this to the caller's own row, so no .eq filter and no
  // getUser round-trip are needed. maybeSingle() returns null (not an error)
  // when unauthenticated, since RLS yields zero rows.
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar, current_game_code")
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function updateProfile(patch: { display_name?: string; avatar?: string }): Promise<void> {
  // `sql_safe_updates` is on for the PostgREST connection, so an UPDATE with no WHERE
  // clause is rejected *before* RLS is consulted — we must filter by the caller's id.
  // getSession() reads the cached session locally (no network round-trip).
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not authenticated");
  const { error } = await supabase.from("profiles").update(patch).eq("id", session.user.id);
  if (error) throw error;
}

export async function assignGameCode(): Promise<string> {
  const { data, error } = await supabase.rpc("assign_game_code");
  if (error) throw error;
  return data as string;
}

export async function clearGameCode(): Promise<void> {
  const { error } = await supabase.rpc("clear_game_code");
  if (error) throw error;
}
