import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { embed } from "./embed";
import { topKPairs, topKTriples, type Word } from "./seed";
import {
  makeAdminClient,
  upsertPosWords,
  upsertSlangWords,
  upsertPairs,
  upsertTriples,
  parseVector,
} from "./load";

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, "../../data");

// Vocabulary caps keep local embedding + coherence seeding tractable while
// giving a curated, fun party-game vocabulary (the raw noun list is ~142k rows
// of mostly junk). Community feedback (Sub-project 4) refines from here.
const NOUN_CAP = 600;
const ADJ_CAP = 400;
const TOP_K_PAIR = 20;
// The triple seeder is a full adj×noun×verb cartesian, so feed it small subsets.
const T_ADJ = 100;
const T_NOUN = 150;
const T_VERB = 80;
const TOP_K_TRIPLE = 10;

// Read column 0 of a headerless POS file; keep clean, common, single words.
function cleanColumn0(file: string): string[] {
  const text = readFileSync(resolve(DATA, file), "utf8");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const w = (line.split(",")[0] ?? "").trim().toLowerCase();
    if (!/^[a-z]+$/.test(w)) continue;
    if (w.length < 3 || w.length > 12) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

// Two words are "degenerate" together if they're the same word or share a stem
// (e.g. grind/grinder, shake/shaker, sew/sewing) — MiniLM scores these near 1.0
// but they make dull scenarios ("you wear a wearer"). Drop them from the seed.
function degenerate(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

// Evenly sample across a sorted list so a cap still spans the alphabet.
function sampleEvenly<T>(arr: T[], cap: number): T[] {
  if (arr.length <= cap) return arr;
  const stride = arr.length / cap;
  const out: T[] = [];
  for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * stride)]);
  return out;
}

// Slang CSV: dedupe to unique slang_term (col 2) with its first meaning (col 4).
// Columns 0–3 are comma-free, so col index is reliable up to the meaning.
function readSlang(): { term: string; meaning: string }[] {
  const text = readFileSync(resolve(DATA, "genz_slang_usage_2020_2025.csv"), "utf8");
  const lines = text.split("\n");
  const seen = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const term = (cols[2] ?? "").trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.set(term, (cols[4] ?? "").trim());
  }
  return [...seen].map(([term, meaning]) => ({ term, meaning }));
}

async function readPosWords(pos: string): Promise<Word[]> {
  const db = makeAdminClient();
  const out: Word[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("pos_words")
      .select("id, word, embedding")
      .eq("pos", pos)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) out.push({ id: r.id, text: r.word, vec: parseVector(r.embedding) });
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  // 1. Clean + sample POS vocabulary.
  const verbs = cleanColumn0("verbs.csv");
  const nouns = sampleEvenly(cleanColumn0("nouns.csv"), NOUN_CAP);
  const adjs = sampleEvenly(cleanColumn0("adjectives.csv"), ADJ_CAP);
  console.log(`POS: ${verbs.length} verbs, ${nouns.length} nouns, ${adjs.length} adjectives`);

  // 2. Slang.
  const slang = readSlang();
  console.log(`Slang: ${slang.length} unique terms`);

  // 3. Embed (local MiniLM, 384-dim). This is the slow step.
  const posItems = [
    ...verbs.map((word) => ({ word, pos: "verb" })),
    ...nouns.map((word) => ({ word, pos: "noun" })),
    ...adjs.map((word) => ({ word, pos: "adjective" })),
  ];
  console.log(`Embedding ${posItems.length} POS words + ${slang.length} slang terms...`);
  const posVecs = await embed(posItems.map((p) => p.word));
  const slangVecs = await embed(slang.map((s) => s.term));

  // 4. Load lexicon.
  await upsertPosWords(posItems.map((p, i) => ({ ...p, embedding: posVecs[i] })));
  await upsertSlangWords(
    slang.map((s, i) => ({ term: s.term, meaning: s.meaning, pos_guess: "other", embedding: slangVecs[i] })),
  );
  console.log(`Loaded ${posItems.length} pos_words, ${slang.length} slang_words.`);

  // 5. Read back DB ids + embeddings, seed coherence.
  const verbW = await readPosWords("verb");
  const nounW = await readPosWords("noun");
  const adjW = await readPosWords("adjective");
  const text = new Map<number, string>();
  for (const w of [...verbW, ...nounW, ...adjW]) text.set(w.id, w.text);

  // Initial seed: clear any prior seed so re-runs are deterministic.
  const db = makeAdminClient();
  await db.from("word_pairs").delete().neq("id", -1);
  await db.from("word_triples").delete().neq("id", -1);

  const pairs = topKPairs(verbW, nounW, TOP_K_PAIR)
    .filter((p) => !degenerate(text.get(p.aId)!, text.get(p.bId)!))
    .map((p) => ({ word_a_id: p.aId, word_b_id: p.bId, coherence: p.coherence }));
  await upsertPairs(pairs);

  const triples = topKTriples(adjW.slice(0, T_ADJ), nounW.slice(0, T_NOUN), verbW.slice(0, T_VERB), TOP_K_TRIPLE)
    .filter((t) => {
      const [a, b, c] = [text.get(t.aId)!, text.get(t.bId)!, text.get(t.cId)!];
      return !degenerate(a, b) && !degenerate(b, c) && !degenerate(a, c);
    })
    .map((t) => ({ word_a_id: t.aId, word_b_id: t.bId, word_c_id: t.cId, coherence: t.coherence }));
  await upsertTriples(triples);

  console.log(`Seeded ${pairs.length} word_pairs, ${triples.length} word_triples.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
