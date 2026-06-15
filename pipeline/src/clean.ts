export type Pos = "noun" | "verb" | "adjective" | "adverb" | "other";

export function normalizeWord(raw: string): string {
  const w = raw.trim().toLowerCase();
  return /^[a-z][a-z'-]*$/.test(w) ? w : "";
}

export function dedupe(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const n = w.toLowerCase();
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function classifyPos(raw: string): Pos {
  const s = raw.toLowerCase();
  if (s.includes("pronoun")) return "other";
  if (s.includes("noun")) return "noun";
  if (s.includes("verb")) return "verb";
  if (s.startsWith("adj")) return "adjective";
  if (s.startsWith("adv")) return "adverb";
  return "other";
}
