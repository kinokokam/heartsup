import { useEffect, useState, useCallback, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { getProfile, clearGameCode, type Profile } from "../lib/profile";
import { AuthContext } from "./useAuth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const refreshProfile = useCallback(async () => {
    setProfile(await getProfile());
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        if (data.session) setProfile(await getProfile());
      } catch {
        // Degrade gracefully: an unreachable profile shouldn't trap the user
        // on a blank screen. Treat as "no profile" and let guards route.
        if (active) setProfile(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, newSession) => {
      setSession(newSession);
      try {
        setProfile(newSession ? await getProfile() : null);
      } catch {
        setProfile(null);
      }
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const signIn = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    return error ? { error: error.message } : {};
  }, []);

  const signOut = useCallback(async () => {
    await clearGameCode().catch(() => {});
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, session, profile, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
