import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const assignGameCode = vi.fn();
const refreshProfile = vi.fn();
const navigate = vi.fn();
let authState: {
  loading: boolean;
  session: unknown;
  profile: { display_name: string | null; current_game_code: string | null } | null;
};

vi.mock("../lib/profile", () => ({ assignGameCode: () => assignGameCode() }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ ...authState, refreshProfile }) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));

import { AuthCallback } from "./AuthCallback";

function renderCallback() {
  render(<MemoryRouter><AuthCallback /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshProfile.mockResolvedValue(undefined);
});

describe("AuthCallback", () => {
  it("assigns a code then goes home when profile has a name but no code", async () => {
    assignGameCode.mockResolvedValue("ABC234");
    authState = { loading: false, session: { user: { id: "u1" } }, profile: { display_name: "Q", current_game_code: null } };
    renderCallback();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/home", { replace: true }));
    expect(assignGameCode).toHaveBeenCalled();
    expect(refreshProfile).toHaveBeenCalled();
  });

  it("routes to /setup without assigning a code when there is no display name", async () => {
    authState = { loading: false, session: { user: { id: "u1" } }, profile: { display_name: null, current_game_code: null } };
    renderCallback();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/setup", { replace: true }));
    expect(assignGameCode).not.toHaveBeenCalled();
  });

  it("goes home without re-assigning when a code already exists", async () => {
    authState = { loading: false, session: { user: { id: "u1" } }, profile: { display_name: "Q", current_game_code: "XYZ789" } };
    renderCallback();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/home", { replace: true }));
    expect(assignGameCode).not.toHaveBeenCalled();
  });

  it("shows the error UI when assignGameCode rejects", async () => {
    assignGameCode.mockRejectedValue(new Error("rpc failed"));
    authState = { loading: false, session: { user: { id: "u1" } }, profile: { display_name: "Q", current_game_code: null } };
    renderCallback();
    await waitFor(() => expect(screen.getByText(/link expired/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /back to login/i })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith("/home", { replace: true });
  });
});
