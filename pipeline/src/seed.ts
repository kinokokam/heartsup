import { cosine } from "./embed";

export interface Word { id: number; text: string; vec: number[]; }
export interface SeededPair { aId: number; bId: number; coherence: number; }
export interface SeededTriple { aId: number; bId: number; cId: number; coherence: number; }

export function topKPairs(as: Word[], bs: Word[], k: number): SeededPair[] {
  const out: SeededPair[] = [];
  for (const a of as) {
    const scored = bs
      .map((b) => ({ b, c: cosine(a.vec, b.vec) }))
      .sort((x, y) => y.c - x.c)
      .slice(0, k);
    for (const { b, c } of scored) {
      out.push({ aId: a.id, bId: b.id, coherence: c });
    }
  }
  return out;
}

// Triple coherence = mean of the three pairwise cosines (adj-noun, noun-verb, adj-verb).
export function topKTriples(adjs: Word[], nouns: Word[], verbs: Word[], k: number): SeededTriple[] {
  const out: SeededTriple[] = [];
  for (const a of adjs) {
    const scored: SeededTriple[] = [];
    for (const n of nouns) {
      for (const v of verbs) {
        const c = (cosine(a.vec, n.vec) + cosine(n.vec, v.vec) + cosine(a.vec, v.vec)) / 3;
        scored.push({ aId: a.id, bId: n.id, cId: v.id, coherence: c });
      }
    }
    scored.sort((x, y) => y.coherence - x.coherence);
    out.push(...scored.slice(0, k));
  }
  return out;
}
