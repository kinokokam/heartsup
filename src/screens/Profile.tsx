import { useNavigate } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { GameCodeBadge } from "../components/GameCodeBadge";
import { useAuth } from "../auth/useAuth";
import { tokens } from "../theme/tokens";

export function Profile() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const logout = async () => { await signOut(); navigate("/login", { replace: true }); };
  return (
    <ScreenBackground>
      <span style={{ fontSize: 64 }}>{profile?.avatar}</span>
      <h1 style={{ fontSize: 32, margin: 0 }}>{profile?.display_name}</h1>
      <p style={{ opacity: 0.7, margin: 0 }}>Your game code</p>
      {profile?.current_game_code && <GameCodeBadge code={profile.current_game_code} />}
      <Button onClick={logout} style={{ background: tokens.color.danger }}>Log out</Button>
    </ScreenBackground>
  );
}
