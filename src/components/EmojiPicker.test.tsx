import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmojiPicker } from "./EmojiPicker";
import { AVATARS } from "../data/avatars";

describe("EmojiPicker", () => {
  it("renders every preset avatar as an option", () => {
    render(<EmojiPicker value={null} onChange={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(AVATARS.length);
  });
  it("calls onChange with the chosen emoji", async () => {
    const onChange = vi.fn();
    render(<EmojiPicker value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: AVATARS[0] }));
    expect(onChange).toHaveBeenCalledWith(AVATARS[0]);
  });
  it("marks the selected emoji as pressed", () => {
    render(<EmojiPicker value={AVATARS[1]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: AVATARS[1] })).toHaveAttribute("aria-pressed", "true");
  });
});
