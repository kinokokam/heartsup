import { Link } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { useAuth } from "../auth/useAuth";
import { tokens } from "../theme/tokens";

export function Home() {
  const { profile } = useAuth();
  return (
    <ScreenBackground>
      <div style={{ position: "absolute", top: tokens.space[4], right: tokens.space[4], display: "flex", alignItems: "center", gap: tokens.space[2] }}>
        <span style={{ fontSize: 24 }}>{profile?.avatar}</span>
        <span style={{ fontWeight: tokens.font.weightBold }}>{profile?.display_name}</span>
      </div>
      <h1 style={{ fontSize: 56, margin: 0 }}>Hearts UP!</h1>
      <Link to="/play"><Button>Play</Button></Link>
      <Link to="/profile"><Button>My Profile</Button></Link>
      <Link to="/how-to-play"><Button>How to Play</Button></Link>
    </ScreenBackground>
  );
}
