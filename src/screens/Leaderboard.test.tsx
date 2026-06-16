import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getScores = vi.fn();
vi.mock("../lib/game", async (orig) => ({ ...(await orig<typeof import("../lib/game")>()), getScores: (...a: unknown[]) => getScores(...a) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useParams: () => ({ id: "L1" }) }));

import { Leaderboard } from "./Leaderboard";

beforeEach(() => { vi.clearAllMocks(); });

describe("Leaderboard", () => {
  it("shows players ranked by score with the winner first", async () => {
    getScores.mockResolvedValue([
      { profile_id: "u2", display_name: "R", avatar: "🦄", score: 5, is_current_turn: false },
      { profile_id: "u1", display_name: "Q", avatar: "😀", score: 3, is_current_turn: false },
    ]);
    render(<MemoryRouter><Leaderboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/winner/i)).toBeInTheDocument());
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("R");
    expect(items[0]).toHaveTextContent("5");
  });
});
