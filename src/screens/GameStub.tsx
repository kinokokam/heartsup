import { Link } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { tokens } from "../theme/tokens";

export function GameStub() {
  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 32, margin: 0 }}>Game starting…</h1>
      <p style={{ opacity: 0.8, maxWidth: 300, textAlign: "center" }}>
        The core game loop arrives in Sub-project 3. For now, this is where the round begins.
      </p>
      <Link to="/home" style={{ color: tokens.color.accent, fontWeight: tokens.font.weightBold }}>Back home</Link>
    </ScreenBackground>
  );
}
