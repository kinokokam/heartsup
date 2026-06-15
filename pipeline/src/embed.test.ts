import { describe, it, expect } from "vitest";
import { cosine } from "./embed";

describe("cosine", () => {
  it("is 1 for identical vectors", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
  it("ranks related closer than unrelated", () => {
    const a = [1, 1, 0];
    const related = [1, 0.9, 0];
    const unrelated = [-1, -1, 0];
    expect(cosine(a, related)).toBeGreaterThan(cosine(a, unrelated));
  });
});
