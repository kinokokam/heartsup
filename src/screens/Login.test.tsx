import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const signIn = vi.fn();
const navigate = vi.fn();
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ signIn }) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));

import { Login } from "./Login";

describe("Login", () => {
  it("sends a magic link and navigates to /check-email on success", async () => {
    signIn.mockResolvedValue({});
    render(<MemoryRouter><Login /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/email/i), "q@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(signIn).toHaveBeenCalledWith("q@example.com");
    expect(navigate).toHaveBeenCalledWith("/check-email", { state: { email: "q@example.com" } });
  });
  it("shows an inline error when send fails", async () => {
    signIn.mockResolvedValue({ error: "rate limited" });
    render(<MemoryRouter><Login /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/email/i), "q@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/rate limited/i)).toBeInTheDocument();
  });
});
