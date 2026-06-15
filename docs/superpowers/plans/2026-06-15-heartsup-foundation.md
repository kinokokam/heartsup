# heartsup Sub-project 0 — Foundation & Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the heartsup repo as an installable React PWA with a Supabase Postgres schema and a rerunnable data pipeline that ingests two Kaggle datasets, embeds them, and seeds the word-coherence tables.

**Architecture:** A Vite + React + TypeScript PWA front-end shares one repo with a Node/TypeScript `pipeline/` workspace. Supabase (local via CLI) provides Postgres + `pgvector`; schema lives in checked-in migrations. The pipeline downloads Kaggle CSVs (via the Kaggle MCP), cleans/tags words, computes local embeddings (`transformers.js`), seeds top-K coherent pairs/triples by cosine similarity, and upserts everything idempotently. Design tokens are extracted from the Figma file (via the Figma MCP) into a typed token module + base components.

**Tech Stack:** Vite, React 18, TypeScript, `vite-plugin-pwa`, Vitest, Supabase (Postgres + pgvector), `@supabase/supabase-js`, `@xenova/transformers` (local embeddings), Node 23 / npm 10.

> **MCP note for executors:** Figma, Kaggle, and Supabase MCP tools are deferred. Before any task that uses them, load schemas with `ToolSearch` (e.g. `query: "kaggle"`, `query: "figma"`, `query: "supabase"`). The MCP-dependent tasks (4, 9, 13) have manual fallbacks documented inline.

---

## File Structure

```
heartsup/
├─ package.json                 # app workspace (root)
├─ vite.config.ts               # Vite + PWA + Vitest config
├─ index.html
├─ public/                      # PWA icons, manifest assets
├─ src/
│  ├─ main.tsx                  # React entry, registers SW
│  ├─ App.tsx                   # shell screen (themed)
│  ├─ theme/tokens.ts           # Figma-derived design tokens
│  ├─ theme/tokens.test.ts
│  ├─ components/Button.tsx
│  ├─ components/Card.tsx
│  ├─ components/ScreenBackground.tsx
│  └─ components/components.test.tsx
│  └─ lib/supabaseClient.ts     # browser Supabase client
├─ supabase/
│  └─ migrations/
│     ├─ 0001_extensions.sql     # pgvector
│     ├─ 0002_lexicon.sql        # pos_words, slang_words
│     ├─ 0003_coherence.sql      # word_pairs, word_triples
│     └─ 0004_multiplayer.sql    # profiles, lobbies, lobby_players, rounds, feedback
├─ pipeline/
│  ├─ package.json              # pipeline workspace
│  ├─ tsconfig.json
│  ├─ src/
│  │  ├─ clean.ts               # normalize + tag rows
│  │  ├─ clean.test.ts
│  │  ├─ embed.ts               # local embeddings + cosine
│  │  ├─ embed.test.ts
│  │  ├─ seed.ts                # top-K pair/triple generation
│  │  ├─ seed.test.ts
│  │  ├─ load.ts                # idempotent upsert to Supabase
│  │  ├─ draw.ts                # drawKeywords stub
│  │  ├─ draw.test.ts
│  │  └─ run.ts                 # orchestrates ingest→clean→embed→seed→load
│  └─ data/raw/                 # downloaded Kaggle CSVs (gitignored)
├─ .env.example
└─ README.md
```

Each file has one responsibility: `clean` (data shaping), `embed` (vectors + similarity), `seed` (combinatorics), `load` (DB I/O), `draw` (query). Tests sit beside their unit.

---

## Task 1: Scaffold the React + TypeScript + Vite app

**Files:**
- Create: `package.json`, `vite.config.ts`, `index.html`, `tsconfig.json`, `src/main.tsx`, `src/App.tsx`, `.gitignore`

- [ ] **Step 1: Scaffold with the Vite React-TS template**

Run (the `.` targets the current, non-empty repo; keep existing files):
```bash
npm create vite@latest . -- --template react-ts
```
If prompted about a non-empty directory, choose **"Ignore files and continue"**.

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

- [ ] **Step 3: Add a .gitignore for node + data + env**

Create/append `.gitignore`:
```
node_modules/
dist/
.env
.env.local
pipeline/data/raw/
.DS_Store
```

- [ ] **Step 4: Verify the dev server boots**

Run:
```bash
npm run build
```
Expected: build succeeds, `dist/` produced, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite React-TS app"
```

---

## Task 2: Add Vitest with a passing smoke test

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json` (scripts)
- Create: `src/smoke.test.ts`

- [ ] **Step 1: Install Vitest + testing libs**

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Write a failing smoke test**

Create `src/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Configure Vitest in vite.config.ts**

Replace `vite.config.ts` with:
```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },
});
```

- [ ] **Step 4: Add the test script**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Run the test (expect PASS)**

Run: `npm test`
Expected: 1 passing test.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test: add Vitest with smoke test"
```

---

## Task 3: Make it an installable PWA

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/main.tsx`
- Create: `public/manifest.webmanifest` (generated by plugin config)

- [ ] **Step 1: Install the PWA plugin**

```bash
npm install -D vite-plugin-pwa
```

- [ ] **Step 2: Configure the PWA plugin in vite.config.ts**

Update `vite.config.ts` plugins array and import:
```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico"],
      manifest: {
        name: "heartsup",
        short_name: "heartsup",
        description: "A networked party game of 10/10-but scenarios.",
        theme_color: "#1d8cf8",
        background_color: "#0a0a0a",
        display: "standalone",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },
});
```

- [ ] **Step 3: Add placeholder PWA icons**

Create two square PNGs at `public/pwa-192.png` and `public/pwa-512.png` (solid heartsup-blue placeholders are fine for now; real icons come from Figma in Task 5). Generate quickly:
```bash
node -e "const fs=require('fs');const b=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');fs.writeFileSync('public/pwa-192.png',b);fs.writeFileSync('public/pwa-512.png',b);"
```

- [ ] **Step 4: Verify the manifest builds**

Run: `npm run build`
Expected: build succeeds and `dist/manifest.webmanifest` + `dist/sw.js` are emitted.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: configure installable PWA (manifest + service worker)"
```

---

## Task 4: Extract Figma design tokens (Figma MCP)

**Files:**
- Create: `src/theme/tokens.ts`
- Create: `src/theme/tokens.test.ts`

> **MCP step.** Load Figma MCP schemas first: `ToolSearch` with `query: "figma"`. The file is
> `https://www.figma.com/design/MLfKjQ1W1kscqxAX1UBja0/heartsup?node-id=0-1`. If the Figma MCP
> is unavailable, fall back to sampling colors from `images/heartsup.png` (the exported
> overview) — the bright blue/green/red/yellow + black backgrounds + bold rounded type.

- [ ] **Step 1: Write the failing token-contract test**

Create `src/theme/tokens.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tokens } from "./tokens";

describe("design tokens", () => {
  it("exposes core color roles", () => {
    expect(tokens.color.primary).toMatch(/^#/);
    expect(tokens.color.success).toMatch(/^#/);
    expect(tokens.color.danger).toMatch(/^#/);
    expect(tokens.color.background).toMatch(/^#/);
    expect(tokens.color.text).toMatch(/^#/);
  });
  it("exposes radius + spacing scales", () => {
    expect(tokens.radius.pill).toBeGreaterThan(tokens.radius.md);
    expect(tokens.space).toContain(8);
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- tokens`
Expected: FAIL — cannot find module `./tokens`.

- [ ] **Step 3: Read the Figma file and write tokens**

Use the Figma MCP to read the heartsup file's styles/variables. Map them into
`src/theme/tokens.ts`. If MCP values are unavailable, use these defaults sampled from the
export (replace with exact Figma values when available):
```ts
export const tokens = {
  color: {
    primary: "#1d8cf8",   // heartsup blue
    success: "#2bd66a",   // green
    danger: "#ff3b30",    // red
    accent: "#ffd233",    // yellow
    background: "#0a0a0a",// near-black confetti bg
    text: "#ffffff",
  },
  radius: { sm: 8, md: 16, lg: 24, pill: 999 },
  space: [0, 4, 8, 12, 16, 24, 32, 48] as const,
  font: {
    family: "'Baloo 2', system-ui, sans-serif",
    weightBold: 800,
  },
} as const;

export type Tokens = typeof tokens;
```

- [ ] **Step 4: Run the test (expect PASS)**

Run: `npm test -- tokens`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Figma-derived design tokens"
```

---

## Task 5: Base components (Button, Card, ScreenBackground)

**Files:**
- Create: `src/components/Button.tsx`, `src/components/Card.tsx`, `src/components/ScreenBackground.tsx`
- Create: `src/components/components.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/components/components.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";
import { Card } from "./Card";

describe("base components", () => {
  it("renders a button with its label", () => {
    render(<Button>START</Button>);
    expect(screen.getByRole("button", { name: "START" })).toBeTruthy();
  });
  it("renders card children", () => {
    render(<Card><span>hi</span></Card>);
    expect(screen.getByText("hi")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- components`
Expected: FAIL — cannot find `./Button`.

- [ ] **Step 3: Implement the components**

Create `src/components/Button.tsx`:
```tsx
import { tokens } from "../theme/tokens";
import type { ButtonHTMLAttributes } from "react";

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { style, ...rest } = props;
  return (
    <button
      {...rest}
      style={{
        background: tokens.color.primary,
        color: tokens.color.text,
        border: "none",
        borderRadius: tokens.radius.pill,
        padding: `${tokens.space[3]}px ${tokens.space[5]}px`,
        fontFamily: tokens.font.family,
        fontWeight: tokens.font.weightBold,
        fontSize: 18,
        cursor: "pointer",
        ...style,
      }}
    />
  );
}
```

Create `src/components/Card.tsx`:
```tsx
import { tokens } from "../theme/tokens";
import type { PropsWithChildren, CSSProperties } from "react";

export function Card({ children, style }: PropsWithChildren<{ style?: CSSProperties }>) {
  return (
    <div
      style={{
        background: tokens.color.primary,
        color: tokens.color.text,
        borderRadius: tokens.radius.lg,
        padding: tokens.space[5],
        ...style,
      }}
    >
      {children}
    </div>
  );
}
```

Create `src/components/ScreenBackground.tsx`:
```tsx
import { tokens } from "../theme/tokens";
import type { PropsWithChildren } from "react";

export function ScreenBackground({ children }: PropsWithChildren) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: tokens.color.background,
        color: tokens.color.text,
        fontFamily: tokens.font.family,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: tokens.space[4],
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Use them in App.tsx**

Replace `src/App.tsx`:
```tsx
import { ScreenBackground } from "./components/ScreenBackground";
import { Button } from "./components/Button";

export default function App() {
  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 48, margin: 0 }}>Hearts UP!</h1>
      <Button>START</Button>
    </ScreenBackground>
  );
}
```

- [ ] **Step 5: Run the test (expect PASS) and build**

Run: `npm test -- components && npm run build`
Expected: tests PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add themed base components + shell screen"
```

---

## Task 6: Initialize local Supabase + pgvector

**Files:**
- Create: `supabase/config.toml` (generated), `supabase/migrations/0001_extensions.sql`
- Create: `.env.example`
- Create: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Initialize Supabase locally**

```bash
npx supabase init
```
Expected: creates `supabase/` with `config.toml`. Accept defaults.

- [ ] **Step 2: Start the local stack**

```bash
npx supabase start
```
Expected: prints local API URL (`http://127.0.0.1:54321`), anon key, and DB URL. Note these.

- [ ] **Step 3: Create the pgvector migration**

Create `supabase/migrations/0001_extensions.sql`:
```sql
create extension if not exists vector;
```

- [ ] **Step 4: Add env template + browser client**

Create `.env.example`:
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=replace-with-local-anon-key
SUPABASE_SERVICE_ROLE_KEY=replace-with-local-service-role-key
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```
Copy to `.env` and fill from `npx supabase start` output. Install the client:
```bash
npm install @supabase/supabase-js
```
Create `src/lib/supabaseClient.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anon);
```

- [ ] **Step 5: Apply the migration**

```bash
npx supabase migration up
```
Expected: `0001_extensions` applied; verify with:
```bash
npx supabase db dump --data-only=false | grep -i "extension vector" || echo "check manually"
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: init local Supabase with pgvector"
```

---

## Task 7: Lexicon schema migration

**Files:**
- Create: `supabase/migrations/0002_lexicon.sql`

- [ ] **Step 1: Write the lexicon migration**

Create `supabase/migrations/0002_lexicon.sql`:
```sql
create table pos_words (
  id bigint generated always as identity primary key,
  word text not null,
  pos text not null check (pos in ('noun','verb','adjective','adverb','other')),
  embedding vector(384),
  unique (word, pos)
);

create table slang_words (
  id bigint generated always as identity primary key,
  term text not null unique,
  meaning text,
  pos_guess text check (pos_guess in ('noun','verb','adjective','adverb','other')),
  era text,
  embedding vector(384)
);

-- Unified read view used by the game to draw keywords.
create view keywords as
  select id, word as text, pos, 'pos'::text as source from pos_words
  union all
  select id, term as text, coalesce(pos_guess,'other') as pos, 'slang'::text as source from slang_words;
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase migration up
```
Verify tables exist:
```bash
npx supabase db dump --schema public | grep -E "create table (public.)?(pos_words|slang_words)"
```
Expected: both `create table` lines present.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add lexicon schema (pos_words, slang_words, keywords view)"
```

---

## Task 8: Coherence + multiplayer schema migrations

**Files:**
- Create: `supabase/migrations/0003_coherence.sql`
- Create: `supabase/migrations/0004_multiplayer.sql`

- [ ] **Step 1: Write the coherence migration**

Create `supabase/migrations/0003_coherence.sql`:
```sql
create table word_pairs (
  id bigint generated always as identity primary key,
  word_a_id bigint not null,
  word_b_id bigint not null,
  coherence real not null default 0,
  times_shown int not null default 0,
  times_guessed int not null default 0,
  times_passed int not null default 0,
  last_used_round bigint,
  unique (word_a_id, word_b_id)
);

create table word_triples (
  id bigint generated always as identity primary key,
  word_a_id bigint not null,
  word_b_id bigint not null,
  word_c_id bigint not null,
  coherence real not null default 0,
  times_shown int not null default 0,
  times_guessed int not null default 0,
  times_passed int not null default 0,
  last_used_round bigint,
  unique (word_a_id, word_b_id, word_c_id)
);

create index on word_pairs (coherence desc);
create index on word_triples (coherence desc);
```

- [ ] **Step 2: Write the multiplayer migration**

Create `supabase/migrations/0004_multiplayer.sql`:
```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar text,
  current_game_code text,
  created_at timestamptz not null default now()
);

create table lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid references profiles(id),
  mode text not null check (mode in ('easy','medium','hard')),
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  game_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table lobby_players (
  lobby_id uuid references lobbies(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  score int not null default 0,
  is_current_turn boolean not null default false,
  primary key (lobby_id, profile_id)
);

create table rounds (
  id bigint generated always as identity primary key,
  lobby_id uuid references lobbies(id) on delete cascade,
  player_id uuid references profiles(id),
  rating int not null check (rating between 1 and 10),
  keyword_ids bigint[] not null,
  outcome text check (outcome in ('guessed','passed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table feedback (
  id bigint generated always as identity primary key,
  round_id bigint references rounds(id) on delete cascade,
  combo_id bigint not null,
  combo_kind text not null check (combo_kind in ('pair','triple')),
  signal text not null check (signal in ('+','-')),
  created_at timestamptz not null default now()
);
```

- [ ] **Step 3: Apply and verify all migrations**

```bash
npx supabase migration up
```
Verify:
```bash
npx supabase db dump --schema public | grep -cE "create table (public.)?(word_pairs|word_triples|profiles|lobbies|lobby_players|rounds|feedback)"
```
Expected: `7`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add coherence + multiplayer schema"
```

---

## Task 9: Pipeline workspace + Kaggle ingestion (Kaggle MCP)

**Files:**
- Create: `pipeline/package.json`, `pipeline/tsconfig.json`
- Create: `pipeline/src/run.ts` (ingest stage only for now)

> **MCP step.** Load Kaggle MCP schemas first: `ToolSearch` with `query: "kaggle"`. Download
> `likithagedipudi/genz-slang-evolution-tracker-2020-2025` and
> `thedevastator/common-english-parts-of-speech` into `pipeline/data/raw/`. If the MCP is
> unavailable, fall back to the Kaggle CLI: `kaggle datasets download -d <slug> -p pipeline/data/raw --unzip`.

- [ ] **Step 1: Create the pipeline workspace**

Create `pipeline/package.json`:
```json
{
  "name": "heartsup-pipeline",
  "private": true,
  "type": "module",
  "scripts": {
    "pipeline": "tsx src/run.ts",
    "test": "vitest run"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```
Create `pipeline/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```
Install:
```bash
cd pipeline && npm install && cd ..
```

- [ ] **Step 2: Download the datasets via Kaggle MCP**

Use the Kaggle MCP tools to download both datasets into `pipeline/data/raw/`. Then verify CSVs landed:
```bash
ls pipeline/data/raw/*.csv
```
Expected: at least two CSV files (slang + parts-of-speech).

- [ ] **Step 3: Add an ingest sanity script**

Create `pipeline/src/run.ts` (ingest stage; later tasks extend it):
```ts
import { readdirSync } from "node:fs";

const RAW = new URL("../data/raw/", import.meta.url).pathname;

export function listRawCsvs(dir = RAW): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".csv"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = listRawCsvs();
  console.log(`Found ${files.length} raw CSV(s):`, files);
  if (files.length < 2) {
    console.error("Expected at least 2 CSVs (slang + pos). Download via Kaggle MCP first.");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run the ingest sanity check**

Run:
```bash
cd pipeline && npx tsx src/run.ts && cd ..
```
Expected: prints "Found 2 raw CSV(s)" (or more); exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add pipeline workspace + Kaggle ingest sanity check"
```

---

## Task 10: Clean & tag rows (TDD)

**Files:**
- Create: `pipeline/src/clean.ts`, `pipeline/src/clean.test.ts`

- [ ] **Step 1: Write failing tests**

Create `pipeline/src/clean.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `cd pipeline && npx vitest run clean && cd ..`
Expected: FAIL — module `./clean` not found.

- [ ] **Step 3: Implement clean.ts**

Create `pipeline/src/clean.ts`:
```ts
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
  if (s.includes("noun")) return "noun";
  if (s.includes("verb")) return "verb";
  if (s.startsWith("adj")) return "adjective";
  if (s.startsWith("adv")) return "adverb";
  return "other";
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `cd pipeline && npx vitest run clean && cd ..`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add clean/tag utilities for the pipeline"
```

---

## Task 11: Local embeddings + cosine similarity (TDD)

**Files:**
- Create: `pipeline/src/embed.ts`, `pipeline/src/embed.test.ts`
- Modify: `pipeline/package.json`

- [ ] **Step 1: Install the local embedding model**

```bash
cd pipeline && npm install @xenova/transformers && cd ..
```

- [ ] **Step 2: Write failing tests for cosine + the embed contract**

Create `pipeline/src/embed.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { cosine } from "./embed";

describe("cosine", () => {
  it("is 1 for identical vectors", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
  it("ranks related closer than unrelated", () => {
    const a = [1, 1, 0];
    const related = [1, 0.9, 0];
    const unrelated = [-1, -1, 0];
    expect(cosine(a, related)).toBeGreaterThan(cosine(a, unrelated));
  });
});
```

- [ ] **Step 3: Run tests (expect FAIL)**

Run: `cd pipeline && npx vitest run embed && cd ..`
Expected: FAIL — `./embed` not found.

- [ ] **Step 4: Implement embed.ts**

Create `pipeline/src/embed.ts`:
```ts
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

let _embedder: Awaited<ReturnType<typeof pipeline>> | null = null;

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
```

- [ ] **Step 5: Run tests (expect PASS)**

Run: `cd pipeline && npx vitest run embed && cd ..`
Expected: 3 cosine tests PASS (the model download happens only when `embed()` is called by `run.ts`, not in these unit tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add local embeddings + cosine similarity"
```

---

## Task 12: Seed top-K coherent pairs/triples (TDD)

**Files:**
- Create: `pipeline/src/seed.ts`, `pipeline/src/seed.test.ts`

- [ ] **Step 1: Write failing tests**

Create `pipeline/src/seed.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { topKPairs } from "./seed";

const verbs = [
  { id: 1, text: "wear", vec: [1, 0, 0] },
  { id: 2, text: "eat", vec: [0, 1, 0] },
];
const nouns = [
  { id: 10, text: "slipper", vec: [0.9, 0.1, 0] }, // close to "wear"
  { id: 11, text: "coffee", vec: [0, 0.95, 0] },    // close to "eat"
];

describe("topKPairs", () => {
  it("pairs each verb with its top-K closest nouns by cosine", () => {
    const pairs = topKPairs(verbs, nouns, 1);
    const wearPair = pairs.find((p) => p.aId === 1)!;
    const eatPair = pairs.find((p) => p.aId === 2)!;
    expect(wearPair.bId).toBe(10);  // wear+slipper
    expect(eatPair.bId).toBe(11);   // eat+coffee
  });
  it("assigns coherence = cosine similarity", () => {
    const pairs = topKPairs(verbs, nouns, 1);
    const wearPair = pairs.find((p) => p.aId === 1)!;
    expect(wearPair.coherence).toBeGreaterThan(0.9);
  });
  it("ranks wear+slipper above eat+slipper (spec spot-check)", () => {
    const pairs = topKPairs(verbs, nouns, 2);
    const wearSlipper = pairs.find((p) => p.aId === 1 && p.bId === 10)!;
    const eatSlipper = pairs.find((p) => p.aId === 2 && p.bId === 10)!;
    expect(wearSlipper.coherence).toBeGreaterThan(eatSlipper.coherence);
  });
});
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `cd pipeline && npx vitest run seed && cd ..`
Expected: FAIL — `./seed` not found.

- [ ] **Step 3: Implement seed.ts**

Create `pipeline/src/seed.ts`:
```ts
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
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `cd pipeline && npx vitest run seed && cd ..`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add top-K coherence seeding for pairs and triples"
```

---

## Task 13: Idempotent load into Supabase

**Files:**
- Create: `pipeline/src/load.ts`
- Modify: `pipeline/package.json` (add `@supabase/supabase-js`, `dotenv`)

> **MCP note.** Loading uses the service-role key against the local Supabase from Task 6. The
> Supabase MCP can also verify row counts after load.

- [ ] **Step 1: Install deps**

```bash
cd pipeline && npm install @supabase/supabase-js dotenv && cd ..
```

- [ ] **Step 2: Implement load.ts**

Create `pipeline/src/load.ts`:
```ts
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function makeAdminClient() {
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface PosRow { word: string; pos: string; embedding: number[]; }
export interface SlangRow { term: string; meaning?: string; pos_guess?: string; era?: string; embedding: number[]; }

export async function upsertPosWords(rows: PosRow[]) {
  const db = makeAdminClient();
  // Idempotent: unique (word,pos) lets onConflict skip dupes on re-run.
  const { error } = await db.from("pos_words").upsert(rows, { onConflict: "word,pos" });
  if (error) throw error;
}

export async function upsertSlangWords(rows: SlangRow[]) {
  const db = makeAdminClient();
  const { error } = await db.from("slang_words").upsert(rows, { onConflict: "term" });
  if (error) throw error;
}

export async function upsertPairs(rows: { word_a_id: number; word_b_id: number; coherence: number }[]) {
  const db = makeAdminClient();
  const { error } = await db.from("word_pairs").upsert(rows, { onConflict: "word_a_id,word_b_id" });
  if (error) throw error;
}

export async function upsertTriples(rows: { word_a_id: number; word_b_id: number; word_c_id: number; coherence: number }[]) {
  const db = makeAdminClient();
  const { error } = await db.from("word_triples").upsert(rows, { onConflict: "word_a_id,word_b_id,word_c_id" });
  if (error) throw error;
}
```

- [ ] **Step 3: Wire the full pipeline in run.ts**

Replace `pipeline/src/run.ts` with the orchestration (reads CSVs, cleans, embeds, seeds, loads):
```ts
import { readdirSync, readFileSync } from "node:fs";
import { normalizeWord, classifyPos, type Pos } from "./clean.js";
import { embed } from "./embed.js";
import { topKPairs, topKTriples, type Word } from "./seed.js";
import { upsertPosWords, upsertSlangWords, upsertPairs, upsertTriples } from "./load.js";

const RAW = new URL("../data/raw/", import.meta.url).pathname;
const TOP_K = 20;

export function listRawCsvs(dir = RAW): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".csv"));
}

// Minimal CSV split (datasets are simple; swap for a parser if quoting issues arise).
function parseCsv(path: string): string[][] {
  return readFileSync(path, "utf8").trim().split("\n").map((l) => l.split(","));
}

async function main() {
  const files = listRawCsvs();
  if (files.length < 2) throw new Error("Download datasets via Kaggle MCP into data/raw first.");

  const posFile = files.find((f) => /pos|speech|english/i.test(f))!;
  const slangFile = files.find((f) => /slang|genz|gen-z/i.test(f))!;

  // --- POS words: expect columns like [word, pos] ---
  // Build {word,pos} rows BEFORE dedup so the part-of-speech stays attached to its word
  // (dedup on the word list alone would desync the index from posRowsRaw).
  const posRowsRaw = parseCsv(`${RAW}${posFile}`).slice(1);
  const seenPos = new Set<string>();
  const posClean: { word: string; pos: Pos }[] = [];
  for (const r of posRowsRaw) {
    const word = normalizeWord(r[0]);
    if (!word || seenPos.has(word)) continue;
    seenPos.add(word);
    posClean.push({ word, pos: classifyPos(r[1] ?? "other") });
  }
  const posVecs = await embed(posClean.map((r) => r.word));
  await upsertPosWords(posClean.map((r, i) => ({ ...r, embedding: posVecs[i] })));

  // --- Slang: expect columns like [term, meaning, era] ---
  const slangRowsRaw = parseCsv(`${RAW}${slangFile}`).slice(1);
  const slangClean = slangRowsRaw
    .map((r) => ({ term: normalizeWord(r[0]), meaning: r[1] ?? "", era: r[2] ?? "" }))
    .filter((r) => r.term);
  const slangVecs = await embed(slangClean.map((r) => r.term));
  await upsertSlangWords(slangClean.map((r, i) => ({ ...r, pos_guess: "other", embedding: slangVecs[i] })));

  console.log(`Loaded ${posClean.length} pos_words, ${slangClean.length} slang_words.`);
  console.log("Seeding coherence requires DB ids; run seed:pairs after confirming load. (Task 14)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run the load and verify counts**

Run (ensure `.env` is filled from Task 6, and `npx supabase start` is up):
```bash
cd pipeline && npx tsx src/run.ts && cd ..
```
Expected: prints non-zero `Loaded N pos_words, M slang_words`. Verify in DB:
```bash
npx supabase db query "select (select count(*) from pos_words) as pos, (select count(*) from slang_words) as slang;"
```
Expected: both counts > 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: load lexicon into Supabase (idempotent upsert)"
```

---

## Task 14: Seed coherence from loaded words + drawKeywords stub (TDD)

**Files:**
- Create: `pipeline/src/draw.ts`, `pipeline/src/draw.test.ts`
- Modify: `pipeline/src/run.ts` (append coherence-seeding stage)

- [ ] **Step 1: Write failing tests for drawKeywords selection logic**

Create `pipeline/src/draw.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `cd pipeline && npx vitest run draw && cd ..`
Expected: FAIL — `./draw` not found.

- [ ] **Step 3: Implement draw.ts**

Create `pipeline/src/draw.ts`:
```ts
export interface Combo {
  id: number;
  word_a_id: number;
  word_b_id: number;
  word_c_id?: number;
  coherence: number;
  last_used_round: number | null;
}

export interface PickOpts { currentRound: number; cooldown: number; floor?: number; }

// Pure selection: highest coherence among combos above the floor and off cooldown.
export function pickCombo(combos: Combo[], opts: PickOpts): Combo | null {
  const floor = opts.floor ?? 0;
  const eligible = combos.filter((c) => {
    if (c.coherence < floor) return false;
    if (c.last_used_round != null && opts.currentRound - c.last_used_round < opts.cooldown) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  return eligible.reduce((best, c) => (c.coherence > best.coherence ? c : best));
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `cd pipeline && npx vitest run draw && cd ..`
Expected: all 3 tests PASS.

- [ ] **Step 5: Append coherence-seeding stage to run.ts**

Add to the end of `main()` in `pipeline/src/run.ts` (before the final console.log), reading loaded ids back from the DB and seeding pairs/triples:
```ts
  // --- Seed coherence from loaded words ---
  const { makeAdminClient } = await import("./load.js");
  const db = makeAdminClient();
  const { data: words } = await db
    .from("pos_words")
    .select("id, word, pos, embedding");
  if (words && words.length) {
    const toWord = (w: any): Word => ({ id: w.id, text: w.word, vec: w.embedding });
    const verbs = words.filter((w: any) => w.pos === "verb").map(toWord);
    const nouns = words.filter((w: any) => w.pos === "noun").map(toWord);
    const adjs  = words.filter((w: any) => w.pos === "adjective").map(toWord);

    const pairs = topKPairs(verbs, nouns, TOP_K)
      .map((p) => ({ word_a_id: p.aId, word_b_id: p.bId, coherence: p.coherence }));
    await upsertPairs(pairs);

    const triples = topKTriples(adjs, nouns, verbs, TOP_K)
      .map((t) => ({ word_a_id: t.aId, word_b_id: t.bId, word_c_id: t.cId, coherence: t.coherence }));
    await upsertTriples(triples);
    console.log(`Seeded ${pairs.length} word_pairs, ${triples.length} word_triples.`);
  }
```

- [ ] **Step 6: Run the full pipeline end-to-end**

Run:
```bash
cd pipeline && npx tsx src/run.ts && cd ..
```
Expected: prints loaded counts AND seeded pair/triple counts (all > 0).

- [ ] **Step 7: Verify the spec spot-check in the DB**

Run a query confirming a coherent verb+noun outranks an incoherent one (adjust words to ones present in your data; `wear`/`eat`/`slipper` if available):
```bash
npx supabase db query "
  select w.coherence, a.word as verb, b.word as noun
  from word_pairs w
  join pos_words a on a.id = w.word_a_id
  join pos_words b on b.id = w.word_b_id
  order by w.coherence desc
  limit 10;"
```
Expected: top rows are semantically sensible pairings (high coherence), confirming seeding worked.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: seed coherence from loaded words + drawKeywords selection"
```

---

## Task 15: README + acceptance verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the run instructions**

Replace `README.md`:
```markdown
# heartsup

A networked party game — "you're a 10/10 but…" with adaptive keyword coherence.

## Sub-project 0: Foundation & data pipeline

### Prerequisites
- Node 20+ / npm 10+
- Local Supabase via `npx supabase` (Docker required)

### Run the app
```bash
npm install
cp .env.example .env   # fill from `npx supabase start` output
npx supabase start
npx supabase migration up
npm run dev            # installable PWA at the printed localhost URL
```

### Run the data pipeline
1. Download datasets via the Kaggle MCP into `pipeline/data/raw/`:
   - `likithagedipudi/genz-slang-evolution-tracker-2020-2025`
   - `thedevastator/common-english-parts-of-speech`
2. Seed the DB:
```bash
cd pipeline && npm install && npx tsx src/run.ts
```

### Tests
```bash
npm test                 # app tests
cd pipeline && npm test  # pipeline tests
```
```

- [ ] **Step 2: Run the full acceptance check**

Verify each Sub-project 0 acceptance criterion:
```bash
npm run build && npm test          # PWA builds + app tests pass
cd pipeline && npm test && cd ..    # pipeline unit tests pass
npx supabase db query "select (select count(*) from pos_words), (select count(*) from slang_words), (select count(*) from word_pairs), (select count(*) from word_triples);"
```
Expected: build succeeds, all tests pass, all four counts > 0.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: add README with run + pipeline instructions"
```

---

## Acceptance Criteria (Sub-project 0)

- [ ] `npm run dev` serves an installable PWA shell themed with Figma tokens.
- [ ] Supabase migrations create all tables + `pgvector`.
- [ ] `npx tsx pipeline/src/run.ts` populates `pos_words`, `slang_words`, `word_pairs`, `word_triples` with non-zero, sensibly-seeded coherence (spot-check: a coherent verb+noun outranks an incoherent one).
- [ ] `pickCombo` selects a coherent combo per mode respecting the 5-round cooldown + coherence floor (no learning yet — that's Sub-project 4).
- [ ] All unit tests pass (app + pipeline).
