import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthState } from "./auth/useAuth";

const auth = vi.fn<() => AuthState>();
vi.mock("./auth/useAuth", async (orig) => ({ ...(await orig<typeof import("./auth/useAuth")>()), useAuth: () => auth() }));
vi.mock("./lib/game", () => ({ getScores: () => Promise.resolve([]) }));

import { AppRoutes } from "./App";

function base(over: Partial<AuthState>): AuthState {
  return { loading: false, session: null, profile: null, signIn: vi.fn(), signOut: vi.fn(), refreshProfile: vi.fn(), ...over };
}

describe("App routes", () => {
  it("shows the login screen at /login", () => {
    auth.mockReturnValue(base({}));
    render(<MemoryRouter initialEntries={["/login"]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /send me a link/i })).toBeInTheDocument();
  });
  it("redirects an unauthenticated visit to /home back to /login", () => {
    auth.mockReturnValue(base({ session: null }));
    render(<MemoryRouter initialEntries={["/home"]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /send me a link/i })).toBeInTheDocument();
  });
  it("shows the Play menu at /play for an authed, profiled user", () => {
    auth.mockReturnValue(base({ session: { user: { id: "u1" } } as never, profile: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: "ABC234" } }));
    render(<MemoryRouter initialEntries={["/play"]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /host a game/i })).toBeInTheDocument();
  });
  it("renders the results route for an authed, profiled user", () => {
    auth.mockReturnValue(base({ session: { user: { id: "u1" } } as never, profile: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: "ABC234" } }));
    render(<MemoryRouter initialEntries={["/game/L1/results"]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByText(/time's up/i)).toBeInTheDocument();
  });
});
