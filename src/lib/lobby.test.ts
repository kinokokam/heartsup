import { describe, it, expect, vi, beforeEach } from "vitest";

const order = vi.fn();
const eq2 = vi.fn(() => ({ order }));
const maybeSingle = vi.fn();
const eq1 = vi.fn(() => ({ maybeSingle }));
const select = vi.fn((cols: string) => (cols.includes("game_ends_at") ? { eq: eq1 } : { eq: eq2 }));
const from = vi.fn((..._a: unknown[]) => ({ select }));
const rpc = vi.fn();

vi.mock("./supabaseClient", () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}));

import {
  createLobby, joinLobby, leaveLobby, startGame, getLobby, getLobbyPlayers,
  lobbyErrorMessage, LobbyError,
} from "./lobby";

beforeEach(() => { vi.clearAllMocks(); });

describe("lobby data access", () => {
  it("createLobby calls the RPC with the mode and returns the id", async () => {
    rpc.mockResolvedValue({ data: "L1", error: null });
    const id = await createLobby("medium");
    expect(rpc).toHaveBeenCalledWith("create_lobby", { p_mode: "medium" });
    expect(id).toBe("L1");
  });
  it("joinLobby calls the RPC with the code and returns the id", async () => {
    rpc.mockResolvedValue({ data: "L2", error: null });
    const id = await joinLobby("ABC234");
    expect(rpc).toHaveBeenCalledWith("join_lobby", { p_code: "ABC234" });
    expect(id).toBe("L2");
  });
  it("joinLobby maps a known RPC error to a typed LobbyError", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'P0001: lobby_full' } });
    await expect(joinLobby("ABC234")).rejects.toMatchObject({ code: "lobby_full" });
  });
  it("leaveLobby and startGame call their RPCs", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await leaveLobby("L1");
    expect(rpc).toHaveBeenCalledWith("leave_lobby", { p_lobby_id: "L1" });
    await startGame("L1");
    expect(rpc).toHaveBeenCalledWith("start_game", { p_lobby_id: "L1" });
  });
  it("getLobby reads the row by id", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "waiting", game_ends_at: null }, error: null });
    const l = await getLobby("L1");
    expect(from).toHaveBeenCalledWith("lobbies");
    expect(l?.status).toBe("waiting");
  });
  it("getLobbyPlayers returns rows ordered by joined_at", async () => {
    order.mockResolvedValue({ data: [
      { lobby_id: "L1", profile_id: "u1", joined_at: "t1", score: 0, display_name: "Q", avatar: "😀" },
    ], error: null });
    const rows = await getLobbyPlayers("L1");
    expect(from).toHaveBeenCalledWith("lobby_players");
    expect(order).toHaveBeenCalledWith("joined_at", { ascending: true });
    expect(rows[0].display_name).toBe("Q");
  });
  it("lobbyErrorMessage maps codes to friendly text and falls back", () => {
    expect(lobbyErrorMessage(new LobbyError("lobby_not_found", "x"))).toMatch(/no game/i);
    expect(lobbyErrorMessage(new Error("boom"))).toMatch(/something went wrong/i);
  });
});
