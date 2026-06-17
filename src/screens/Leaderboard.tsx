import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { getScores, type Score } from "../lib/game";
import { tokens } from "../theme/tokens";

export function Leaderboard() {
  const { id = "" } = useParams();
  const [scores, setScores] = useState<Score[]>([]);

  useEffect(() => {
    let active = true;
    getScores(id).then((s) => { if (active) setScores(s); }).catch(() => {});
    return () => { active = false; };
  }, [id]);

  const ranked = [...scores].sort((a, b) => b.score - a.score);

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 36, margin: 0 }}>Time's up!</h1>
      {ranked[0] && <p style={{ color: tokens.color.accent, fontWeight: tokens.font.weightBold }}>🏆 Winner: {ranked[0].display_name ?? "Player"}</p>}
      <ul style={{ listStyle: "none", padding: 0, width: 280, display: "flex", flexDirection: "column", gap: tokens.space[2] }}>
        {ranked.map((s, i) => (
          <li key={s.profile_id} style={{ display: "flex", justifyContent: "space-between", fontWeight: i === 0 ? tokens.font.weightBold : 400 }}>
            <span>{i + 1}. {s.avatar} {s.display_name ?? "Player"}</span>
            <span>{s.score}</span>
          </li>
        ))}
      </ul>
      <Link to="/home"><Button>Home</Button></Link>
    </ScreenBackground>
  );
}
