import { describe, it, expect } from "vitest";
import { tokens } from "./tokens";

describe("design tokens", () => {
  it("exposes core color roles", () => {
    expect(tokens.color.primary).toMatch(/^#/);
    expect(tokens.color.success).toMatch(/^#/);
    expect(tokens.color.danger).toMatch(/^#/);
    expect(tokens.color.background).toMatch(/^#/);
    expect(tokens.color.text).toMatch(/^#/);
  });
  it("exposes radius + spacing scales", () => {
    expect(tokens.radius.pill).toBeGreaterThan(tokens.radius.md);
    expect(tokens.space).toContain(8);
  });
});
