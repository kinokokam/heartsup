import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const createLobby = vi.fn();
const navigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});
vi.mock("../lib/lobby", async (orig) => ({ ...(await orig<typeof import("../lib/lobby")>()), createLobby: (...a: unknown[]) => createLobby(...a) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));

import { CreateLobby } from "./CreateLobby";

describe("CreateLobby", () => {
  it("creates a lobby with the chosen mode and navigates to the room", async () => {
    createLobby.mockResolvedValue("L9");
    render(<MemoryRouter><CreateLobby /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /medium/i }));
    await userEvent.click(screen.getByRole("button", { name: /create lobby/i }));
    expect(createLobby).toHaveBeenCalledWith("medium");
    expect(navigate).toHaveBeenCalledWith("/lobby/L9");
  });
  it("shows a friendly error when create fails", async () => {
    const { LobbyError } = await import("../lib/lobby");
    createLobby.mockRejectedValue(new LobbyError("already_hosting", "x"));
    render(<MemoryRouter><CreateLobby /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /create lobby/i }));
    expect(await screen.findByText(/already hosting/i)).toBeInTheDocument();
  });
});
