import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getLobby, getLobbyPlayers, type Lobby, type LobbyPlayer } from "../lib/lobby";

export interface LobbyState {
  loading: boolean;
  lobby: Lobby | null;
  players: LobbyPlayer[];
  onlineIds: Set<string>;
}

export function useLobby(lobbyId: string, selfId: string | undefined): LobbyState {
  const [loading, setLoading] = useState(true);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    const refetchRoster = async () => {
      try { const rows = await getLobbyPlayers(lobbyId); if (active) setPlayers(rows); }
      catch { /* transient; next event will refetch */ }
    };
    const refetchLobby = async () => {
      try { const l = await getLobby(lobbyId); if (active) setLobby(l); }
      catch { /* transient */ }
    };

    void (async () => {
      try {
        const [l, rows] = await Promise.all([getLobby(lobbyId), getLobbyPlayers(lobbyId)]);
        if (!active) return;
        setLobby(l);
        setPlayers(rows);
      } finally {
        if (active) setLoading(false);
      }
    })();

    const channel = supabase.channel(`lobby:${lobbyId}`);
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lobby_players", filter: `lobby_id=eq.${lobbyId}` },
        () => { void refetchRoster(); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` },
        () => { void refetchLobby(); },
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, Array<{ profile_id?: string }>>;
        const ids = new Set<string>();
        for (const metas of Object.values(state)) for (const m of metas) if (m.profile_id) ids.add(m.profile_id);
        if (active) setOnlineIds(ids);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && selfId) void channel.track({ profile_id: selfId });
      });

    return () => { active = false; void supabase.removeChannel(channel); };
  }, [lobbyId, selfId]);

  return { loading, lobby, players, onlineIds };
}
