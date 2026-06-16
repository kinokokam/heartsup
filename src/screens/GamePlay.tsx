import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { useAuth } from "../auth/useAuth";
import { useGame } from "../realtime/useGame";
import { useTilt } from "../hooks/useTilt";
import { submitOutcome, advanceTurn, finishGame, type Outcome } from "../lib/game";
import { tokens } from "../theme/tokens";

function secondsLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

export function GamePlay() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { loading, status, currentRound, scores, isMyTurn, currentGuesser, gameEndsAt, turnEndsAt } = useGame(id, profile?.id);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const submit = useCallback((o: Outcome) => {
    if (currentRound) submitOutcome(currentRound.id, o).catch(() => {});
  }, [currentRound]);

  const onUp = useCallback(() => submit("guessed"), [submit]);
  const onDown = useCallback(() => submit("passed"), [submit]);
  const { permission, requestPermission, supported } = useTilt({ enabled: isMyTurn && status === "playing", onUp, onDown });

  useEffect(() => {
    if (status === "finished") navigate(`/game/${id}/results`, { replace: true });
  }, [status, id, navigate]);

  const gameLeft = secondsLeft(gameEndsAt);
  const turnLeft = secondsLeft(turnEndsAt);
  useEffect(() => {
    if (status !== "playing") return;
    if (gameLeft <= 0) { finishGame(id).catch(() => {}); return; }
    if (turnLeft <= 0 && isMyTurn) { advanceTurn(id).catch(() => {}); }
  }, [status, gameLeft, turnLeft, isMyTurn, id]);

  if (loading) return <ScreenBackground><p>Loading…</p></ScreenBackground>;

  return (
    <ScreenBackground>
      <div style={{ position: "absolute", top: tokens.space[3], right: tokens.space[4], fontWeight: tokens.font.weightBold }}>
        ⏱ {Math.floor(gameLeft / 60)}:{String(gameLeft % 60).padStart(2, "0")}
      </div>
      {isMyTurn ? (
        <>
          <p style={{ opacity: 0.7, margin: 0 }}>Your turn · {turnLeft}s</p>
          <div style={{ fontSize: 96, fontWeight: tokens.font.weightBold, color: tokens.color.accent, lineHeight: 1 }}>
            {currentRound?.rating}
          </div>
          <p style={{ fontSize: 28, fontWeight: tokens.font.weightBold }}>{currentRound?.keywords.join(" · ")}</p>
          {supported && permission !== "granted" ? (
            <Button onClick={requestPermission}>Enable tilt</Button>
          ) : null}
          <div style={{ display: "flex", gap: tokens.space[3] }}>
            <Button onClick={onUp} style={{ background: tokens.color.success }}>Correct ▲</Button>
            <Button onClick={onDown} style={{ background: tokens.color.danger }}>Pass ▼</Button>
          </div>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 32, margin: 0 }}>{currentGuesser?.display_name ?? "Someone"} is guessing…</h1>
          <p style={{ opacity: 0.7 }}>Give them clues!</p>
        </>
      )}
      <ul style={{ listStyle: "none", padding: 0, width: 260, display: "flex", flexDirection: "column", gap: tokens.space[1] }}>
        {scores.map((s) => (
          <li key={s.profile_id} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{s.avatar} {s.display_name ?? "Player"}</span>
            <span style={{ fontWeight: tokens.font.weightBold }}>{s.score}</span>
          </li>
        ))}
      </ul>
    </ScreenBackground>
  );
}
