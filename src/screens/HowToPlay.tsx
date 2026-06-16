import { Link } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { tokens } from "../theme/tokens";

export function HowToPlay() {
  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 32, margin: 0 }}>How to Play</h1>
      <ul style={{ maxWidth: 320, lineHeight: 1.5 }}>
        <li>Hold your phone to your forehead — you can’t see your rating, your friends can.</li>
        <li>Friends improvise: “You’re a 10/10 but…” weaving in the keyword(s).</li>
        <li>Guess your number. Tilt <strong>up</strong> if you got it (point!), <strong>down</strong> to pass.</li>
        <li>Modes: Easy (1 word), Medium (2 words), Hard (3 words).</li>
      </ul>
      <Link to="/home" style={{ color: tokens.color.accent, fontWeight: tokens.font.weightBold }}>Back home</Link>
    </ScreenBackground>
  );
}
