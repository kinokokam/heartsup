import { describe, it, expect } from "vitest";
import { normalizeWord, dedupe, classifyPos, parseCsvLine } from "./clean";

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
  it("splits a plain CSV line into fields", () => {
    expect(parseCsvLine("0,2020-01-01,simp,insult,a person")).toEqual([
      "0", "2020-01-01", "simp", "insult", "a person",
    ]);
  });
  it("keeps embedded commas inside quoted fields", () => {
    // term_meaning (col 4) often contains a comma, e.g. "no lie, for real".
    const cols = parseCsvLine('7,2021,no cap,affirmation,"no lie, for real",Twitter');
    expect(cols[2]).toBe("no cap");
    expect(cols[4]).toBe("no lie, for real");
    expect(cols[5]).toBe("Twitter");
  });
  it("unescapes doubled quotes inside a quoted field", () => {
    expect(parseCsvLine('a,"she said ""hi""",b')).toEqual(['a', 'she said "hi"', 'b']);
  });
});
