import { describe, it, expect } from "vitest";
import { AVATARS } from "./avatars";

describe("avatars", () => {
  it("offers a reasonable set of choices", () => {
    expect(AVATARS.length).toBeGreaterThanOrEqual(12);
  });
  it("has no duplicates", () => {
    expect(new Set(AVATARS).size).toBe(AVATARS.length);
  });
  it("has no empty entries", () => {
    expect(AVATARS.every((a) => a.trim().length > 0)).toBe(true);
  });
});
