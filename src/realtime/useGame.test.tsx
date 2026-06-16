import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const getLobby = vi.fn();
const getCurrentRound = vi.fn();
const getScores = vi.fn();
vi.mock("../lib/lobby", () => ({ getLobby: (...a: unknown[]) => getLobby(...a) }));
vi.mock("../lib/game", () => ({
  getCurrentRound: (...a: unknown[]) => getCurrentRound(...a),
  getScores: (...a: unknown[]) => getScores(...a),
}));

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
const channel = {
  on(_type: string, cfg: { table?: string }, cb: Handler) { handlers[`pg:${cfg.table}`] = cb; return channel; },
  subscribe(cb?: (s: string) => void) { cb?.("SUBSCRIBED"); return channel; },
};
const removeChannel = vi.fn();
vi.mock("../lib/supabaseClient", () => ({
  supabase: { channel: () => channel, removeChannel: (...a: unknown[]) => removeChannel(...a) },
}));

import { useGame } from "./useGame";

beforeEach(() => {
  vi.clearAllMocks();
  getLobby.mockResolvedValue({ id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "playing", game_ends_at: "2030-01-01T00:00:00Z", turn_ends_at: "2030-01-01T00:00:30Z" });
  getCurrentRound.mockResolvedValue({ id: 5, lobby_id: "L1", player_id: "u1", rating: 7, keywords: ["cat"], combo_id: 3, combo_kind: "single", outcome: null });
  getScores.mockResolvedValue([
    { profile_id: "u1", display_name: "Q", avatar: "😀", score: 2, is_current_turn: true },
    { profile_id: "u2", display_name: "R", avatar: "🦄", score: 1, is_current_turn: false },
  ]);
});

describe("useGame", () => {
  it("loads game state and flags my turn", async () => {
    const { result } = renderHook(() => useGame("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe("playing");
    expect(result.current.currentRound?.rating).toBe(7);
    expect(result.current.isMyTurn).toBe(true);
    expect(result.current.currentGuesser?.display_name).toBe("Q");
    expect(result.current.scores).toHaveLength(2);
  });
  it("is not my turn for a different user", async () => {
    const { result } = renderHook(() => useGame("L1", "u2"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isMyTurn).toBe(false);
  });
  it("refetches when a rounds change arrives", async () => {
    const { result } = renderHook(() => useGame("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    getCurrentRound.mockResolvedValue({ id: 6, lobby_id: "L1", player_id: "u1", rating: 3, keywords: ["dog"], combo_id: 4, combo_kind: "single", outcome: null });
    act(() => { handlers["pg:rounds"](); });
    await waitFor(() => expect(result.current.currentRound?.rating).toBe(3));
  });
  it("removes the channel on unmount", async () => {
    const { result, unmount } = renderHook(() => useGame("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});
