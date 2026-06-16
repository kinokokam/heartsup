import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthState } from "./auth/useAuth";

const auth = vi.fn<() => AuthState>();
vi.mock("./auth/useAuth", async (orig) => ({ ...(await orig<typeof import("./auth/useAuth")>()), useAuth: () => auth() }));

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
});
