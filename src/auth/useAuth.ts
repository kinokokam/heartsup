import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "../lib/profile";

export interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  signIn: (email: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
