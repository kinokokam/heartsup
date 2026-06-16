import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameCodeBadge } from "./GameCodeBadge";

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("GameCodeBadge", () => {
  it("displays the code", () => {
    render(<GameCodeBadge code="ABC234" />);
    expect(screen.getByText("ABC234")).toBeInTheDocument();
  });
  it("copies the code to the clipboard", async () => {
    render(<GameCodeBadge code="ABC234" />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABC234");
  });
});
