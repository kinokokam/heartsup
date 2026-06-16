import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { joinLobby, lobbyErrorMessage } from "../lib/lobby";
import { normalizeGameCode, isValidGameCode } from "../lib/gameCode";
import { tokens } from "../theme/tokens";

export function JoinLobby() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    const normalized = normalizeGameCode(code);
    if (!isValidGameCode(normalized)) {
      setError("A game code is 6 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await joinLobby(normalized);
      navigate(`/lobby/${id}`);
    } catch (e) {
      setBusy(false);
      setError(lobbyErrorMessage(e));
    }
  };

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 32, margin: 0 }}>Join a game</h1>
      <label htmlFor="code" style={{ fontWeight: tokens.font.weightBold }}>Game code</label>
      <input
        id="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
        style={{ padding: tokens.space[3], borderRadius: tokens.radius.md, border: "none", fontSize: 24, letterSpacing: 4, width: 200, textAlign: "center", textTransform: "uppercase" }}
      />
      <Button onClick={join} disabled={busy}>{busy ? "Joining…" : "Join"}</Button>
      {error && <p style={{ color: tokens.color.danger, margin: 0 }}>{error}</p>}
    </ScreenBackground>
  );
}
