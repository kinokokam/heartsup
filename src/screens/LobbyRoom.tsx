import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { GameCodeBadge } from "../components/GameCodeBadge";
import { useAuth } from "../auth/useAuth";
import { useLobby } from "../realtime/useLobby";
import { leaveLobby, startGame } from "../lib/lobby";
import { tokens } from "../theme/tokens";

export function LobbyRoom() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { loading, lobby, players, onlineIds } = useLobby(id, profile?.id);

  const isHost = !!lobby && lobby.host_id === profile?.id;
  const status = lobby?.status;
  // Presence-only UX: once presence has synced (set non-empty), flag an absent host.
  const hostOffline = !!lobby && !isHost && onlineIds.size > 0 && !onlineIds.has(lobby.host_id);

  useEffect(() => {
    if (status === "playing") navigate(`/game/${id}`);
    else if (status === "finished" && !isHost) navigate("/home", { replace: true });
  }, [status, isHost, id, navigate]);

  // Loaded but not a member / closed lobby -> nothing to show.
  if (!loading && !lobby) {
    return <ScreenBackground><p>This lobby isn’t available.</p><Button onClick={() => navigate("/home", { replace: true })}>Back home</Button></ScreenBackground>;
  }

  const leave = async () => { await leaveLobby(id); navigate("/home", { replace: true }); };
  const start = async () => { await startGame(id); };

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 28, margin: 0 }}>Lobby</h1>
      {hostOffline && <p style={{ color: tokens.color.danger, margin: 0 }}>Host disconnected — they may have left.</p>}
      {lobby && <GameCodeBadge code={lobby.code} />}
      <p style={{ opacity: 0.7, margin: 0 }}>Mode: {lobby?.mode}</p>
      <ul style={{ listStyle: "none", padding: 0, width: 260, display: "flex", flexDirection: "column", gap: tokens.space[2] }}>
        {players.map((pl) => (
          <li key={pl.profile_id} style={{ display: "flex", alignItems: "center", gap: tokens.space[2] }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: onlineIds.has(pl.profile_id) ? tokens.color.success : "rgba(255,255,255,0.25)" }} />
            <span style={{ fontSize: 22 }}>{pl.avatar}</span>
            <span style={{ fontWeight: tokens.font.weightBold }}>{pl.display_name ?? "Player"}</span>
            {lobby?.host_id === pl.profile_id && <span style={{ opacity: 0.7, fontSize: 12 }}>host</span>}
          </li>
        ))}
      </ul>
      {isHost ? (
        <Button onClick={start} disabled={players.length < 2}>Start game</Button>
      ) : (
        <p style={{ opacity: 0.8 }}>Waiting for the host to start…</p>
      )}
      <Button onClick={leave} style={{ background: tokens.color.danger }}>Leave</Button>
    </ScreenBackground>
  );
}
