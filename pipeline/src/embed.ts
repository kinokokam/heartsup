import { pipeline } from "@xenova/transformers";

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _embedder: any = null;

export async function embed(words: string[]): Promise<number[][]> {
  if (!_embedder) {
    _embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  const out: number[][] = [];
  for (const w of words) {
    const t = await _embedder(w, { pooling: "mean", normalize: true });
    out.push(Array.from(t.data as Float32Array));
  }
  return out;
}
