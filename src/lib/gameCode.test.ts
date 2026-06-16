import { describe, it, expect } from "vitest";
import { GAME_CODE_CHARS, GAME_CODE_LENGTH, isValidGameCode, normalizeGameCode } from "./gameCode";

describe("gameCode", () => {
  it("accepts a well-formed 6-char code", () => {
    expect(isValidGameCode("ABC234")).toBe(true);
  });
  it("rejects wrong length", () => {
    expect(isValidGameCode("ABC2")).toBe(false);
    expect(isValidGameCode("ABC2345")).toBe(false);
  });
  it("rejects ambiguous/forbidden chars", () => {
    expect(isValidGameCode("ABC2I0")).toBe(false); // I and 0 not in charset
    expect(isValidGameCode("abc234")).toBe(false); // lowercase not in charset
  });
  it("normalizes by trimming + uppercasing", () => {
    expect(normalizeGameCode("  abc234 ")).toBe("ABC234");
  });
  it("exposes the charset + length constants", () => {
    expect(GAME_CODE_LENGTH).toBe(6);
    expect(GAME_CODE_CHARS).not.toMatch(/[IOL01]/);
  });
});
