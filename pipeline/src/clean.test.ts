import { describe, it, expect } from "vitest";
import { normalizeWord, dedupe, classifyPos } from "./clean";

describe("clean", () => {
  it("normalizes casing and whitespace", () => {
    expect(normalizeWord("  Slipper ")).toBe("slipper");
    expect(normalizeWord("WEAR")).toBe("wear");
  });
  it("drops empty/non-alpha tokens to empty string", () => {
    expect(normalizeWord("123")).toBe("");
    expect(normalizeWord("!!!")).toBe("");
  });
  it("dedupes case-insensitively keeping first", () => {
    expect(dedupe(["Eat", "eat", "Coffee"])).toEqual(["eat", "coffee"]);
  });
  it("maps raw POS labels to canonical buckets", () => {
    expect(classifyPos("Noun")).toBe("noun");
    expect(classifyPos("transitive verb")).toBe("verb");
    expect(classifyPos("adj.")).toBe("adjective");
    expect(classifyPos("pronoun")).toBe("other");
  });
});
