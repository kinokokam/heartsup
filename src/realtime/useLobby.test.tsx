import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const getLobby = vi.fn();
const getLobbyPlayers = vi.fn();
vi.mock("../lib/lobby", () => ({
  getLobby: (...a: unknown[]) => getLobby(...a),
  getLobbyPlayers: (...a: unknown[]) => getLobbyPlayers(...a),
}));

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
let presence: Record<string, Array<{ profile_id: string }>> = {};
const track = vi.fn(() => Promise.resolve());
const channel = {
  on(type: string, cfg: { table?: string }, cb: Handler) {
    handlers[type === "presence" ? "presence" : `pg:${cfg.table}`] = cb;
    return channel;
  },
  subscribe(cb?: (s: string) => void) { cb?.("SUBSCRIBED"); return channel; },
  track,
  presenceState: () => presence,
};
const removeChannel = vi.fn();
vi.mock("../lib/supabaseClient", () => ({
  supabase: { channel: () => channel, removeChannel: (...a: unknown[]) => removeChannel(...a) },
}));

import { useLobby } from "./useLobby";

beforeEach(() => {
  vi.clearAllMocks();
  presence = {};
  getLobby.mockResolvedValue({ id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "waiting", game_ends_at: null });
  getLobbyPlayers.mockResolvedValue([{ lobby_id: "L1", profile_id: "u1", joined_at: "t1", score: 0, display_name: "Q", avatar: "😀" }]);
});

describe("useLobby", () => {
  it("loads the initial lobby + roster and tracks presence", async () => {
    const { result } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lobby?.status).toBe("waiting");
    expect(result.current.players).toHaveLength(1);
    expect(track).toHaveBeenCalledWith({ profile_id: "u1" });
  });

  it("refetches the roster on a lobby_players change", async () => {
    const { result } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    getLobbyPlayers.mockResolvedValue([
      { lobby_id: "L1", profile_id: "u1", joined_at: "t1", score: 0, display_name: "Q", avatar: "😀" },
      { lobby_id: "L1", profile_id: "u2", joined_at: "t2", score: 0, display_name: "R", avatar: "🦄" },
    ]);
    act(() => { handlers["pg:lobby_players"](); });
    await waitFor(() => expect(result.current.players).toHaveLength(2));
  });

  it("reflects presence sync into onlineIds", async () => {
    const { result } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    presence = { u1: [{ profile_id: "u1" }], u2: [{ profile_id: "u2" }] };
    act(() => { handlers["presence"](); });
    await waitFor(() => expect(result.current.onlineIds.has("u2")).toBe(true));
  });

  it("refetches the lobby on a lobbies change (status -> playing)", async () => {
    const { result } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    getLobby.mockResolvedValue({ id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "playing", game_ends_at: null });
    act(() => { handlers["pg:lobbies"](); });
    await waitFor(() => expect(result.current.lobby?.status).toBe("playing"));
  });

  it("removes the channel on unmount", async () => {
    const { result, unmount } = renderHook(() => useLobby("L1", "u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});
