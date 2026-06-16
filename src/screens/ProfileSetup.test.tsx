import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AVATARS } from "../data/avatars";

const updateProfile = vi.fn();
const assignGameCode = vi.fn();
const refreshProfile = vi.fn();
const navigate = vi.fn();
vi.mock("../lib/profile", () => ({ updateProfile: (...a: unknown[]) => updateProfile(...a), assignGameCode: () => assignGameCode() }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ refreshProfile }) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));

import { ProfileSetup } from "./ProfileSetup";

describe("ProfileSetup", () => {
  it("saves name + avatar, assigns a code, and goes home", async () => {
    updateProfile.mockResolvedValue(undefined);
    assignGameCode.mockResolvedValue("ABC234");
    refreshProfile.mockResolvedValue(undefined);
    render(<MemoryRouter><ProfileSetup /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/name/i), "Q");
    await userEvent.click(screen.getByRole("button", { name: AVATARS[0] }));
    await userEvent.click(screen.getByRole("button", { name: /let.s play/i }));
    expect(updateProfile).toHaveBeenCalledWith({ display_name: "Q", avatar: AVATARS[0] });
    expect(assignGameCode).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/home", { replace: true });
  });
});
