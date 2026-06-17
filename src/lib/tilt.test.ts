import { describe, it, expect } from "vitest";
import { tiltDirection } from "./tilt";

describe("tiltDirection", () => {
  it("returns 'up' when tilted well past the up threshold", () => {
    expect(tiltDirection(-60)).toBe("up");
  });
  it("returns 'down' when tilted well past the down threshold", () => {
    expect(tiltDirection(60)).toBe("down");
  });
  it("returns null inside the neutral dead-zone", () => {
    expect(tiltDirection(0)).toBeNull();
    expect(tiltDirection(20)).toBeNull();
    expect(tiltDirection(-20)).toBeNull();
  });
});
