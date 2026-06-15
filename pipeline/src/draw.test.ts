import { describe, it, expect } from "vitest";
import { pickCombo } from "./draw";

const pairs = [
  { id: 1, word_a_id: 1, word_b_id: 10, coherence: 0.9, last_used_round: null },
  { id: 2, word_a_id: 2, word_b_id: 11, coherence: 0.2, last_used_round: null },
];

describe("pickCombo", () => {
  it("prefers higher-coherence combos", () => {
    const chosen = pickCombo(pairs, { currentRound: 100, cooldown: 5 });
    expect(chosen?.id).toBe(1);
  });
  it("respects the 5-round cooldown (skips recently used)", () => {
    const recent = [{ ...pairs[0], last_used_round: 98 }, pairs[1]];
    const chosen = pickCombo(recent, { currentRound: 100, cooldown: 5 });
    expect(chosen?.id).toBe(2); // pair 1 used 2 rounds ago, still on cooldown
  });
  it("suppresses combos below the coherence floor", () => {
    const chosen = pickCombo([pairs[1]], { currentRound: 100, cooldown: 5, floor: 0.3 });
    expect(chosen).toBeNull(); // 0.2 < 0.3 floor
  });
});
