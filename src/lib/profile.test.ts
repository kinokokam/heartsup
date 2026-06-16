import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const select = vi.fn(() => ({ maybeSingle }));
const eq = vi.fn(() => ({ error: null }));
const update = vi.fn(() => ({ eq }));
const from = vi.fn((..._a: unknown[]) => ({ select, update }));
const rpc = vi.fn();
const getSession = vi.fn();

vi.mock("./supabaseClient", () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { getSession: () => getSession() },
  },
}));

import { getProfile, updateProfile, assignGameCode, clearGameCode } from "./profile";

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
});

describe("profile", () => {
  it("getProfile returns the row for the current user", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: null }, error: null });
    const p = await getProfile();
    expect(from).toHaveBeenCalledWith("profiles");
    expect(p?.display_name).toBe("Q");
  });
  it("getProfile returns null when the query yields no row", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getProfile()).toBeNull();
  });
  it("assignGameCode calls the RPC and returns the code", async () => {
    rpc.mockResolvedValue({ data: "ABC234", error: null });
    const code = await assignGameCode();
    expect(rpc).toHaveBeenCalledWith("assign_game_code");
    expect(code).toBe("ABC234");
  });
  it("clearGameCode calls the RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await clearGameCode();
    expect(rpc).toHaveBeenCalledWith("clear_game_code");
  });
  it("updateProfile patches the current user's row, filtered by id", async () => {
    await updateProfile({ display_name: "Newt", avatar: "🦄" });
    expect(update).toHaveBeenCalledWith({ display_name: "Newt", avatar: "🦄" });
    expect(eq).toHaveBeenCalledWith("id", "u1");
  });
});
