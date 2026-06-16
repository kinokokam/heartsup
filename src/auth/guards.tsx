import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./useAuth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();
  if (loading) return null;
  return session ? <>{children}</> : <Navigate to="/login" replace />;
}

export function RequireProfile({ children }: { children: ReactNode }) {
  const { loading, profile } = useAuth();
  if (loading) return null;
  return profile?.display_name ? <>{children}</> : <Navigate to="/setup" replace />;
}
