import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { createLobby, lobbyErrorMessage, type LobbyMode } from "../lib/lobby";
import { tokens } from "../theme/tokens";

const MODES: { value: LobbyMode; label: string; hint: string }[] = [
  { value: "easy", label: "Easy", hint: "1 keyword" },
  { value: "medium", label: "Medium", hint: "verb + noun" },
  { value: "hard", label: "Hard", hint: "adjective + noun + verb" },
];

const DURATIONS: { value: number; label: string }[] = [
  { value: 180, label: "3 min" },
  { value: 300, label: "5 min" },
  { value: 600, label: "10 min" },
];

export function CreateLobby() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LobbyMode>("easy");
  const [duration, setDuration] = useState(300);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createLobby(mode, duration);
      navigate(`/lobby/${id}`);
    } catch (e) {
      setBusy(false);
      setError(lobbyErrorMessage(e));
    }
  };

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 32, margin: 0 }}>Host a game</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space[2], width: 260 }}>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            onClick={() => setMode(m.value)}
            style={{
              padding: tokens.space[3],
              borderRadius: tokens.radius.md,
              border: mode === m.value ? `3px solid ${tokens.color.accent}` : "3px solid transparent",
              background: mode === m.value ? tokens.color.primary : "rgba(255,255,255,0.08)",
              color: tokens.color.text,
              fontFamily: tokens.font.family,
              fontWeight: tokens.font.weightBold,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {m.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>— {m.hint}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: tokens.space[2] }}>
        {DURATIONS.map((d) => (
          <button
            key={d.value}
            type="button"
            aria-pressed={duration === d.value}
            onClick={() => setDuration(d.value)}
            style={{
              padding: tokens.space[2],
              borderRadius: tokens.radius.md,
              border: duration === d.value ? `3px solid ${tokens.color.accent}` : "3px solid transparent",
              background: duration === d.value ? tokens.color.primary : "rgba(255,255,255,0.08)",
              color: tokens.color.text,
              fontFamily: tokens.font.family,
              fontWeight: tokens.font.weightBold,
              cursor: "pointer",
            }}
          >
            {d.label}
          </button>
        ))}
      </div>
      <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create lobby"}</Button>
      {error && <p style={{ color: tokens.color.danger, margin: 0 }}>{error}</p>}
    </ScreenBackground>
  );
}
