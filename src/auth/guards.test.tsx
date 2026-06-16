import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { AuthState } from "./useAuth";

const auth = vi.fn<() => AuthState>();
vi.mock("./useAuth", async (orig) => ({ ...(await orig<typeof import("./useAuth")>()), useAuth: () => auth() }));

import { RequireAuth, RequireProfile } from "./guards";

function base(over: Partial<AuthState>): AuthState {
  return { loading: false, session: null, profile: null, signIn: vi.fn(), signOut: vi.fn(), refreshProfile: vi.fn(), ...over };
}
function renderAt(guard: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/x"]}>
      <Routes>
        <Route path="/x" element={guard} />
        <Route path="/login" element={<div>login-page</div>} />
        <Route path="/setup" element={<div>setup-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("guards", () => {
  it("RequireAuth redirects to /login without a session", () => {
    auth.mockReturnValue(base({ session: null }));
    renderAt(<RequireAuth><div>secret</div></RequireAuth>);
    expect(screen.getByText("login-page")).toBeInTheDocument();
  });
  it("RequireAuth renders children with a session", () => {
    auth.mockReturnValue(base({ session: { user: { id: "u1" } } as never }));
    renderAt(<RequireAuth><div>secret</div></RequireAuth>);
    expect(screen.getByText("secret")).toBeInTheDocument();
  });
  it("RequireProfile redirects to /setup when display_name is empty", () => {
    auth.mockReturnValue(base({ session: { user: { id: "u1" } } as never, profile: { id: "u1", display_name: null, avatar: null, current_game_code: null } }));
    renderAt(<RequireProfile><div>home</div></RequireProfile>);
    expect(screen.getByText("setup-page")).toBeInTheDocument();
  });
  it("RequireProfile renders children when display_name is set", () => {
    auth.mockReturnValue(base({ session: { user: { id: "u1" } } as never, profile: { id: "u1", display_name: "Q", avatar: "😀", current_game_code: null } }));
    renderAt(<RequireProfile><div>home</div></RequireProfile>);
    expect(screen.getByText("home")).toBeInTheDocument();
  });
});
