import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// The pipeline runs from `pipeline/`, but `.env` lives at the repo root.
// Resolve it relative to this file so dotenv finds it regardless of cwd.
const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, "../../.env") });

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client: SupabaseClient | null = null;

export function makeAdminClient(): SupabaseClient {
  if (!url || !key) {
    throw new Error(
      "Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — check the repo-root .env",
    );
  }
  if (!_client) _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

// pgvector accepts a text literal of the form "[0.1,0.2,...]".
export function toVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// pgvector columns come back as that same string literal; parse to number[].
export function parseVector(v: string | number[]): number[] {
  return Array.isArray(v) ? v : (JSON.parse(v) as number[]);
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

export interface PosRow { word: string; pos: string; embedding: number[]; }
export interface SlangRow { term: string; meaning: string; pos_guess: string; embedding: number[]; }
export interface PairRow { word_a_id: number; word_b_id: number; coherence: number; }
export interface TripleRow { word_a_id: number; word_b_id: number; word_c_id: number; coherence: number; }

export async function upsertPosWords(rows: PosRow[]): Promise<void> {
  const db = makeAdminClient();
  for (const chunk of chunks(rows, 500)) {
    const payload = chunk.map((r) => ({ word: r.word, pos: r.pos, embedding: toVector(r.embedding) }));
    const { error } = await db.from("pos_words").upsert(payload, { onConflict: "word,pos" });
    if (error) throw error;
  }
}

export async function upsertSlangWords(rows: SlangRow[]): Promise<void> {
  const db = makeAdminClient();
  for (const chunk of chunks(rows, 500)) {
    const payload = chunk.map((r) => ({
      term: r.term, meaning: r.meaning, pos_guess: r.pos_guess, embedding: toVector(r.embedding),
    }));
    const { error } = await db.from("slang_words").upsert(payload, { onConflict: "term" });
    if (error) throw error;
  }
}

export async function upsertPairs(rows: PairRow[]): Promise<void> {
  const db = makeAdminClient();
  for (const chunk of chunks(rows, 500)) {
    const { error } = await db.from("word_pairs").upsert(chunk, { onConflict: "word_a_id,word_b_id" });
    if (error) throw error;
  }
}

export async function upsertTriples(rows: TripleRow[]): Promise<void> {
  const db = makeAdminClient();
  for (const chunk of chunks(rows, 500)) {
    const { error } = await db.from("word_triples").upsert(chunk, { onConflict: "word_a_id,word_b_id,word_c_id" });
    if (error) throw error;
  }
}
