import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { GameState } from "../realtime/useGame";

const useGame = vi.fn<() => GameState>();
const submitOutcome = vi.fn();
const advanceTurn = vi.fn();
const finishGame = vi.fn();
const navigate = vi.fn();
vi.mock("../realtime/useGame", () => ({ useGame: () => useGame() }));
vi.mock("../lib/game", async (orig) => ({ ...(await orig<typeof import("../lib/game")>()), submitOutcome: (...a: unknown[]) => submitOutcome(...a), advanceTurn: (...a: unknown[]) => advanceTurn(...a), finishGame: (...a: unknown[]) => finishGame(...a) }));
vi.mock("../hooks/useTilt", () => ({ useTilt: () => ({ permission: "granted", requestPermission: vi.fn(), supported: true }) }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ profile: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: "ABC234" } }) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate, useParams: () => ({ id: "L1" }) }));

import { GamePlay } from "./GamePlay";

const future = "2030-01-01T00:00:00Z";
function state(over: Partial<GameState>): GameState {
  return {
    loading: false, status: "playing", lobby: null,
    currentRound: { id: 5, lobby_id: "L1", player_id: "u1", rating: 7, keywords: ["cat"], combo_id: 3, combo_kind: "single", outcome: null },
    scores: [
      { profile_id: "u1", display_name: "Q", avatar: "😀", score: 2, is_current_turn: true },
      { profile_id: "u2", display_name: "R", avatar: "🦄", score: 1, is_current_turn: false },
    ],
    isMyTurn: true, currentGuesser: { profile_id: "u1", display_name: "Q", avatar: "😀", score: 2, is_current_turn: true },
    gameEndsAt: future, turnEndsAt: future, ...over,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("GamePlay", () => {
  it("guesser sees the rating + keyword and can mark correct", async () => {
    submitOutcome.mockResolvedValue({});
    useGame.mockReturnValue(state({ isMyTurn: true }));
    render(<MemoryRouter><GamePlay /></MemoryRouter>);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/cat/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /correct/i }));
    expect(submitOutcome).toHaveBeenCalledWith(5, "guessed");
  });
  it("guesser can pass", async () => {
    submitOutcome.mockResolvedValue({});
    useGame.mockReturnValue(state({ isMyTurn: true }));
    render(<MemoryRouter><GamePlay /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /pass/i }));
    expect(submitOutcome).toHaveBeenCalledWith(5, "passed");
  });
  it("spectator sees whose turn it is and the scores, not the card", () => {
    useGame.mockReturnValue(state({ isMyTurn: false, currentGuesser: { profile_id: "u2", display_name: "R", avatar: "🦄", score: 1, is_current_turn: true } }));
    render(<MemoryRouter><GamePlay /></MemoryRouter>);
    expect(screen.getByText(/R is guessing/i)).toBeInTheDocument();
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.getByText(/Q/)).toBeInTheDocument();
  });
  it("navigates to results when the game is finished", () => {
    useGame.mockReturnValue(state({ status: "finished" }));
    render(<MemoryRouter><GamePlay /></MemoryRouter>);
    expect(navigate).toHaveBeenCalledWith("/game/L1/results", { replace: true });
  });
});
