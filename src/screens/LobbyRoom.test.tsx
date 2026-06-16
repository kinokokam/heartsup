import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { LobbyState } from "../realtime/useLobby";

const useLobby = vi.fn<() => LobbyState>();
const startGame = vi.fn();
const leaveLobby = vi.fn();
const navigate = vi.fn();
vi.mock("../realtime/useLobby", () => ({ useLobby: () => useLobby() }));
vi.mock("../lib/lobby", async (orig) => ({ ...(await orig<typeof import("../lib/lobby")>()), startGame: (...a: unknown[]) => startGame(...a), leaveLobby: (...a: unknown[]) => leaveLobby(...a) }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ profile: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: "ABC234" } }) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate, useParams: () => ({ id: "L1" }) }));

import { LobbyRoom } from "./LobbyRoom";

function state(over: Partial<LobbyState>): LobbyState {
  return { loading: false, lobby: { id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "waiting", game_ends_at: null, turn_ends_at: null }, players: [], onlineIds: new Set(), ...over };
}
const p = (id: string, name: string) => ({ lobby_id: "L1", profile_id: id, joined_at: id, score: 0, display_name: name, avatar: "😀" });

beforeEach(() => { vi.clearAllMocks(); });

describe("LobbyRoom", () => {
  it("shows the code and roster", () => {
    useLobby.mockReturnValue(state({ players: [p("u1", "Q"), p("u2", "R")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    expect(screen.getByText("ABC234")).toBeInTheDocument();
    expect(screen.getByText("Q")).toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
  });
  it("host can start once there are 2+ players", async () => {
    startGame.mockResolvedValue(undefined);
    useLobby.mockReturnValue(state({ players: [p("u1", "Q"), p("u2", "R")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    const start = screen.getByRole("button", { name: /start game/i });
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(startGame).toHaveBeenCalledWith("L1");
  });
  it("host start button is disabled with fewer than 2 players", () => {
    useLobby.mockReturnValue(state({ players: [p("u1", "Q")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /start game/i })).toBeDisabled();
  });
  it("navigates to the game screen when status becomes playing", () => {
    useLobby.mockReturnValue(state({ lobby: { id: "L1", code: "ABC234", host_id: "u1", mode: "easy", status: "playing", game_ends_at: null, turn_ends_at: null }, players: [p("u1", "Q"), p("u2", "R")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    expect(navigate).toHaveBeenCalledWith("/game/L1");
  });
  it("leaving calls leaveLobby and goes home", async () => {
    leaveLobby.mockResolvedValue(undefined);
    useLobby.mockReturnValue(state({ players: [p("u1", "Q")] }));
    render(<MemoryRouter><LobbyRoom /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /leave/i }));
    expect(leaveLobby).toHaveBeenCalledWith("L1");
    expect(navigate).toHaveBeenCalledWith("/home", { replace: true });
  });
});
