import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getLobby, type Lobby } from "../lib/lobby";
import { getCurrentRound, getScores, type Round, type Score } from "../lib/game";

export interface GameState {
  loading: boolean;
  status: Lobby["status"] | null;
  lobby: Lobby | null;
  currentRound: Round | null;
  scores: Score[];
  isMyTurn: boolean;
  currentGuesser: Score | null;
  gameEndsAt: string | null;
  turnEndsAt: string | null;
}

export function useGame(lobbyId: string, selfId: string | undefined): GameState {
  const [loading, setLoading] = useState(true);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [scores, setScores] = useState<Score[]>([]);

  useEffect(() => {
    let active = true;
    const refetch = async () => {
      try {
        const [l, r, s] = await Promise.all([getLobby(lobbyId), getCurrentRound(lobbyId), getScores(lobbyId)]);
        if (!active) return;
        setLobby(l); setCurrentRound(r); setScores(s);
      } catch { /* transient; next event refetches */ }
    };
    void (async () => { await refetch(); if (active) setLoading(false); })();

    const channel = supabase.channel(`game:${lobbyId}`);
    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: `lobby_id=eq.${lobbyId}` }, () => { void refetch(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` }, () => { void refetch(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "lobby_players", filter: `lobby_id=eq.${lobbyId}` }, () => { void refetch(); })
      .subscribe();

    return () => { active = false; void supabase.removeChannel(channel); };
  }, [lobbyId]);

  const currentGuesser = scores.find((s) => s.is_current_turn) ?? null;
  return {
    loading,
    status: lobby?.status ?? null,
    lobby,
    currentRound,
    scores,
    isMyTurn: !!selfId && currentGuesser?.profile_id === selfId,
    currentGuesser,
    gameEndsAt: lobby?.game_ends_at ?? null,
    turnEndsAt: lobby?.turn_ends_at ?? null,
  };
}
