import { describe, it, expect } from "vitest";
import { topKPairs } from "./seed";

const verbs = [
  { id: 1, text: "wear", vec: [1, 0, 0] },
  { id: 2, text: "eat", vec: [0, 1, 0] },
];
const nouns = [
  { id: 10, text: "slipper", vec: [0.9, 0.1, 0] }, // close to "wear"
  { id: 11, text: "coffee", vec: [0, 0.95, 0] },    // close to "eat"
];

describe("topKPairs", () => {
  it("pairs each verb with its top-K closest nouns by cosine", () => {
    const pairs = topKPairs(verbs, nouns, 1);
    const wearPair = pairs.find((p) => p.aId === 1)!;
    const eatPair = pairs.find((p) => p.aId === 2)!;
    expect(wearPair.bId).toBe(10);  // wear+slipper
    expect(eatPair.bId).toBe(11);   // eat+coffee
  });
  it("assigns coherence = cosine similarity", () => {
    const pairs = topKPairs(verbs, nouns, 1);
    const wearPair = pairs.find((p) => p.aId === 1)!;
    expect(wearPair.coherence).toBeGreaterThan(0.9);
  });
  it("ranks wear+slipper above eat+slipper (spec spot-check)", () => {
    const pairs = topKPairs(verbs, nouns, 2);
    const wearSlipper = pairs.find((p) => p.aId === 1 && p.bId === 10)!;
    const eatSlipper = pairs.find((p) => p.aId === 2 && p.bId === 10)!;
    expect(wearSlipper.coherence).toBeGreaterThan(eatSlipper.coherence);
  });
});
