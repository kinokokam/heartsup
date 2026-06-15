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

// Parse one RFC4180 CSV line into fields, respecting double-quoted fields that
// may contain commas (and "" escapes). The slang dataset's meaning column has
// embedded commas, so a naive split(",") truncates it.
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
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
