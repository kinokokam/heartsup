import { useLocation, Link } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { tokens } from "../theme/tokens";

export function CheckEmail() {
  const { state } = useLocation() as { state?: { email?: string } };
  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 36, margin: 0 }}>Check your email</h1>
      <p style={{ textAlign: "center", maxWidth: 300 }}>
        We sent a magic link to <strong>{state?.email ?? "your inbox"}</strong>. Tap it to log in.
      </p>
      <p style={{ opacity: 0.7, fontSize: 14 }}>Didn’t get it? Check spam, or <Link to="/login" style={{ color: tokens.color.accent }}>try again</Link>.</p>
    </ScreenBackground>
  );
}
