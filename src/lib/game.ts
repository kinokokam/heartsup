import { supabase } from "./supabaseClient";

export type Outcome = "guessed" | "passed";
export type ComboKind = "single" | "pair" | "triple";

export interface Round {
  id: number;
  lobby_id: string;
  player_id: string;
  rating: number;
  keywords: string[];
  combo_id: number;
  combo_kind: ComboKind;
  outcome: Outcome | null;
}

export interface Score {
  profile_id: string;
  display_name: string | null;
  avatar: string | null;
  score: number;
  is_current_turn: boolean;
}

export class GameError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "GameError";
  }
}

const KNOWN_CODES = [
  "not_your_turn", "round_closed", "game_not_playing", "turn_not_over",
  "not_a_member", "no_keywords_available", "invalid_outcome",
];

function throwRpc(error: { message: string }): never {
  const found = KNOWN_CODES.find((c) => error.message.includes(c));
  throw new GameError(found ?? "game_error", error.message);
}

const MESSAGES: Record<string, string> = {
  not_your_turn: "It's not your turn.",
  round_closed: "That card was already answered.",
  game_not_playing: "This game isn't in progress.",
  turn_not_over: "The turn isn't over yet.",
  no_keywords_available: "Ran out of keyword combos — try another mode.",
};

export function gameErrorMessage(e: unknown): string {
  if (e instanceof GameError && MESSAGES[e.code]) return MESSAGES[e.code];
  return "Something went wrong. Please try again.";
}

export async function submitOutcome(roundId: number, outcome: Outcome): Promise<Round> {
  const { data, error } = await supabase.rpc("submit_outcome", { p_round_id: roundId, p_outcome: outcome });
  if (error) throwRpc(error);
  return data as Round;
}

export async function advanceTurn(lobbyId: string): Promise<void> {
  const { error } = await supabase.rpc("advance_turn", { p_lobby_id: lobbyId });
  if (error) throwRpc(error);
}

export async function finishGame(lobbyId: string): Promise<void> {
  const { error } = await supabase.rpc("finish_game", { p_lobby_id: lobbyId });
  if (error) throwRpc(error);
}

export async function getCurrentRound(lobbyId: string): Promise<Round | null> {
  const { data, error } = await supabase
    .from("rounds")
    .select("id, lobby_id, player_id, rating, keywords, combo_id, combo_kind, outcome")
    .eq("lobby_id", lobbyId)
    .is("outcome", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Round | null;
}

export async function getScores(lobbyId: string): Promise<Score[]> {
  const { data, error } = await supabase
    .from("lobby_players")
    .select("profile_id, display_name, avatar, score, is_current_turn")
    .eq("lobby_id", lobbyId)
    .order("score", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Score[];
}
