import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const joinLobby = vi.fn();
const navigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});
vi.mock("../lib/lobby", async (orig) => ({ ...(await orig<typeof import("../lib/lobby")>()), joinLobby: (...a: unknown[]) => joinLobby(...a) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));

import { JoinLobby } from "./JoinLobby";

describe("JoinLobby", () => {
  it("normalizes the code, joins, and navigates to the room", async () => {
    joinLobby.mockResolvedValue("L5");
    render(<MemoryRouter><JoinLobby /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/code/i), "abc234");
    await userEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(joinLobby).toHaveBeenCalledWith("ABC234");
    expect(navigate).toHaveBeenCalledWith("/lobby/L5");
  });
  it("rejects an invalid code format without calling the RPC", async () => {
    render(<MemoryRouter><JoinLobby /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/code/i), "abc");
    await userEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(joinLobby).not.toHaveBeenCalled();
    expect(await screen.findByText(/6 characters/i)).toBeInTheDocument();
  });
  it("shows a friendly error when the lobby is not found", async () => {
    const { LobbyError } = await import("../lib/lobby");
    joinLobby.mockRejectedValue(new LobbyError("lobby_not_found", "x"));
    render(<MemoryRouter><JoinLobby /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/code/i), "ABC234");
    await userEvent.click(screen.getByRole("button", { name: /join/i }));
    expect(await screen.findByText(/no game found/i)).toBeInTheDocument();
  });
});
