import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { useAuth } from "../auth/useAuth";
import { tokens } from "../theme/tokens";

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email);
    setBusy(false);
    if (error) { setError(error); return; }
    navigate("/check-email", { state: { email } });
  };

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 48, margin: 0 }}>Hearts UP!</h1>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: tokens.space[3], width: 280 }}>
        <label htmlFor="email" style={{ fontWeight: tokens.font.weightBold }}>Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: tokens.space[3], borderRadius: tokens.radius.md, border: "none", fontSize: 16 }}
        />
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send me a link"}</Button>
        {error && <p style={{ color: tokens.color.danger, margin: 0 }}>{error}</p>}
      </form>
    </ScreenBackground>
  );
}
