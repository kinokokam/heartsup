import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const limit = vi.fn(() => ({ maybeSingle }));
const orderRounds = vi.fn(() => ({ limit }));
const isFn = vi.fn(() => ({ order: orderRounds }));
const orderScores = vi.fn();
const eq = vi.fn((col: string) => (col === "lobby_id" ? { is: isFn, order: orderScores } : { is: isFn, order: orderScores }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn((..._a: unknown[]) => ({ select }));
const rpc = vi.fn();

vi.mock("./supabaseClient", () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}));

import { submitOutcome, advanceTurn, finishGame, getCurrentRound, getScores, gameErrorMessage, GameError } from "./game";

beforeEach(() => { vi.clearAllMocks(); });

describe("game data access", () => {
  it("submitOutcome calls the RPC and returns the next round", async () => {
    rpc.mockResolvedValue({ data: { id: 2, rating: 7, keywords: ["cat"], combo_kind: "single", outcome: null }, error: null });
    const r = await submitOutcome(1, "guessed");
    expect(rpc).toHaveBeenCalledWith("submit_outcome", { p_round_id: 1, p_outcome: "guessed" });
    expect(r?.rating).toBe(7);
  });
  it("advanceTurn and finishGame call their RPCs", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await advanceTurn("L1");
    expect(rpc).toHaveBeenCalledWith("advance_turn", { p_lobby_id: "L1" });
    await finishGame("L1");
    expect(rpc).toHaveBeenCalledWith("finish_game", { p_lobby_id: "L1" });
  });
  it("submitOutcome maps a known RPC error to a typed GameError", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "P0001: not_your_turn" } });
    await expect(submitOutcome(1, "guessed")).rejects.toMatchObject({ code: "not_your_turn" });
  });
  it("getCurrentRound reads the open round for the lobby", async () => {
    maybeSingle.mockResolvedValue({ data: { id: 5, lobby_id: "L1", player_id: "u1", rating: 4, keywords: ["x"], combo_id: 1, combo_kind: "single", outcome: null }, error: null });
    const r = await getCurrentRound("L1");
    expect(from).toHaveBeenCalledWith("rounds");
    expect(r?.id).toBe(5);
  });
  it("getScores reads ordered lobby_players", async () => {
    orderScores.mockResolvedValue({ data: [{ profile_id: "u1", display_name: "Q", avatar: "😀", score: 2, is_current_turn: true }], error: null });
    const s = await getScores("L1");
    expect(from).toHaveBeenCalledWith("lobby_players");
    expect(s[0].score).toBe(2);
  });
  it("gameErrorMessage maps codes and falls back", () => {
    expect(gameErrorMessage(new GameError("turn_not_over", "x"))).toMatch(/turn isn.t over/i);
    expect(gameErrorMessage(new Error("boom"))).toMatch(/something went wrong/i);
  });
});
