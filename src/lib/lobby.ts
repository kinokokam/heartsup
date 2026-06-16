import { supabase } from "./supabaseClient";

export type LobbyStatus = "waiting" | "playing" | "finished";
export type LobbyMode = "easy" | "medium" | "hard";

export interface Lobby {
  id: string;
  code: string;
  host_id: string;
  mode: LobbyMode;
  status: LobbyStatus;
  game_ends_at: string | null;
}

export interface LobbyPlayer {
  lobby_id: string;
  profile_id: string;
  joined_at: string;
  score: number;
  display_name: string | null;
  avatar: string | null;
}

export class LobbyError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LobbyError";
  }
}

const KNOWN_CODES = [
  "lobby_not_found", "lobby_full", "not_enough_players",
  "no_game_code", "already_hosting", "invalid_mode", "not_host_or_not_waiting",
];

function throwRpc(error: { message: string }): never {
  const found = KNOWN_CODES.find((c) => error.message.includes(c));
  throw new LobbyError(found ?? "lobby_error", error.message);
}

const MESSAGES: Record<string, string> = {
  lobby_not_found: "No game found with that code.",
  lobby_full: "That lobby is full (8 players max).",
  not_enough_players: "You need at least 2 players to start.",
  no_game_code: "You need a game code first — try logging out and back in.",
  already_hosting: "You're already hosting a game.",
};

export function lobbyErrorMessage(e: unknown): string {
  if (e instanceof LobbyError && MESSAGES[e.code]) return MESSAGES[e.code];
  return "Something went wrong. Please try again.";
}

export async function createLobby(mode: LobbyMode, durationSeconds = 300): Promise<string> {
  const { data, error } = await supabase.rpc("create_lobby", { p_mode: mode, p_duration_seconds: durationSeconds });
  if (error) throwRpc(error);
  return data as string;
}

export async function joinLobby(code: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_lobby", { p_code: code });
  if (error) throwRpc(error);
  return data as string;
}

export async function leaveLobby(lobbyId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_lobby", { p_lobby_id: lobbyId });
  if (error) throwRpc(error);
}

export async function startGame(lobbyId: string): Promise<void> {
  const { error } = await supabase.rpc("start_game", { p_lobby_id: lobbyId });
  if (error) throwRpc(error);
}

export async function getLobby(lobbyId: string): Promise<Lobby | null> {
  const { data, error } = await supabase
    .from("lobbies")
    .select("id, code, host_id, mode, status, game_ends_at")
    .eq("id", lobbyId)
    .maybeSingle();
  if (error) throw error;
  return data as Lobby | null;
}

export async function getLobbyPlayers(lobbyId: string): Promise<LobbyPlayer[]> {
  const { data, error } = await supabase
    .from("lobby_players")
    .select("lobby_id, profile_id, joined_at, score, display_name, avatar")
    .eq("lobby_id", lobbyId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LobbyPlayer[];
}
