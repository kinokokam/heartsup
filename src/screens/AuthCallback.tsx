import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { useAuth } from "../auth/useAuth";
import { assignGameCode } from "../lib/profile";

export function AuthCallback() {
  const { loading, session, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      // Give supabase a beat to parse tokens from the URL before declaring failure.
      const t = setTimeout(() => setExpired(true), 1500);
      return () => clearTimeout(t);
    }
    (async () => {
      try {
        if (!profile?.display_name) { navigate("/setup", { replace: true }); return; }
        if (!profile.current_game_code) { await assignGameCode(); await refreshProfile(); }
        navigate("/home", { replace: true });
      } catch {
        // Don't strand the user on "Signing you in…" forever.
        setExpired(true);
      }
    })();
  }, [loading, session, profile, navigate, refreshProfile]);

  if (expired) {
    return (
      <ScreenBackground>
        <h1 style={{ fontSize: 32 }}>Link expired</h1>
        <p>That magic link didn’t work. Request a new one.</p>
        <Button onClick={() => navigate("/login")}>Back to login</Button>
      </ScreenBackground>
    );
  }
  return <ScreenBackground><p>Signing you in…</p></ScreenBackground>;
}
