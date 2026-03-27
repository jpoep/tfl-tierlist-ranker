# AGENTS.md — TFL Tierlist Ranker

This file is the canonical onboarding document for AI coding agents (and humans) working in this repository. Read it before touching anything.

---

## What this project is

A pairwise ranking system for the TFL (The Fantasy League) Pokémon draft league. Users are shown two Pokémon side by side and pick which is stronger in a draft meta. Votes accumulate and drive a statistical rating algorithm that converges on a community tierlist. It replaces a manual council process with a data-driven one.

**Current status:** Multi-user web app. All persistent state lives in Supabase (Postgres). Supabase Realtime pushes rating and matchup changes to all connected clients via WebSocket. No per-user authentication — this is a shared community tool where everyone votes on the same pool.

---

## Commands you need to know

```bash
bun run dev              # Start the dev server (Vite, http://localhost:5173)
bun run build            # Type-check + production build
bun run lint             # Biome check (lint + format check)
bun run lint:fix         # Biome check with auto-fix
bun run format           # Biome format with auto-fix
bun run fetch-pokemon    # Re-fetch the Pokédex from PokéAPI and overwrite src/assets/pokemon.json
bun run seed-supabase    # One-time: seed pokemon + initial ratings into Supabase (needs service role key)
bun run gen-types        # Regenerate src/lib/database.types.ts from the live Supabase schema
```

`bun run fetch-pokemon` is a one-off script. The output is committed — never run it unless you specifically intend to refresh the upstream data, as it hits the PokéAPI network and takes ~30 seconds.

`bun run seed-supabase` requires env vars `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the service role key, **not** the anon key). Run it once after applying the migration. It is idempotent — safe to re-run.

`bun run gen-types` requires the Supabase CLI. Replace `YOUR_PROJECT_REF` in `package.json` with your actual project ref before running. Re-run whenever `supabase/migrations/` changes.

Regenerate the TanStack Router route tree after adding/renaming/removing route files:
```bash
bunx @tanstack/router-cli generate --routesDirectory=src/routes --generatedRouteTree=src/routeTree.gen.ts
```

---

## Stack

| Concern | Tool | Notes |
|---|---|---|
| Language | TypeScript (strict) | `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` |
| UI | React 19 + Vite 8 | |
| Routing | TanStack Router v1 | File-based, fully type-safe, route tree is auto-generated |
| Server state / caching | TanStack Query v5 | Used for the Pokémon list query (staleTime: Infinity) |
| Database / backend | Supabase (Postgres) | Hosted Postgres, RLS, Realtime, typed client via `@supabase/supabase-js` |
| Real-time reactivity | Supabase Realtime | WebSocket push on `ratings` and `matchups` tables — replaces Dexie `liveQuery` |
| Rating algorithm | OpenSkill v4 (`bradleyTerryFull`) | Bayesian pairwise ranking, see Ranking section below |
| Effects / async | Effect v3 | Typed error channels, composable pipelines — see Effect section below |
| Styling | Tailwind CSS v4 | `@tailwindcss/vite` plugin, no tailwind.config file needed |
| Linting / formatting | Biome v2 | Replaces ESLint + Prettier. Config in `biome.json`. |
| Runtime / package manager | Bun | Used for installs and running scripts |

---

## Repository layout

```
tfl-tierlist-ranker/
├── scripts/
│   ├── fetch-pokemon.ts       # One-time PokéAPI prefetch script (Bun, Effect pipeline)
│   └── seed-supabase.ts       # One-time Supabase seed script (service role key required)
├── supabase/
│   └── migrations/
│       └── 001_initial.sql    # Schema: pokemon, ratings, matchups tables + RPCs + RLS policies
├── src/
│   ├── assets/
│   │   └── pokemon.json       # COMMITTED static asset. 664 Gen 9 Pokémon. Never fetched at runtime.
│   ├── types/
│   │   ├── pokemon.ts         # Pokemon + PokemonAsset interfaces — the schema for pokemon.json
│   │   └── rating.ts          # Rating + Matchup interfaces — canonical in-app types for ranking/
│   ├── lib/
│   │   ├── supabase.ts        # Typed Supabase client singleton (import this everywhere)
│   │   └── database.types.ts  # Generated Supabase types (run `bun run gen-types` to refresh)
│   ├── ranking/
│   │   ├── openskill.ts       # OpenSkill wrappers (Effect), confidence math, estimateVotesNeeded
│   │   ├── pairSelection.ts   # Smart pair selection algorithm (Effect.gen pipeline)
│   │   └── tiers.ts           # Tier assignment — strategy pattern with 3 implementations
│   ├── services/
│   │   └── rankingService.ts  # Effect-based service: recordVote, recordSkip, read helpers
│   ├── hooks/
│   │   ├── usePokemon.ts      # TanStack Query hook for the Pokémon list (fetches from Supabase)
│   │   ├── useNextPair.ts     # Supabase Realtime → pair selection, reruns after every vote/skip
│   │   └── useTierlist.ts     # Supabase Realtime → tiered list + confidence metrics
│   ├── components/
│   │   ├── ComparisonView.tsx # Main voting UI: two cards, vote/skip handlers, keyboard nav
│   │   ├── PokemonCard.tsx    # Single Pokémon card: pixelated sprite, type badges, states
│   │   ├── TierlistPreview.tsx# S/A/B/C/D tier rows with live strategy switcher
│   │   └── ConfidenceBar.tsx  # Confidence progress bar with target marker + votes-needed
│   ├── routes/
│   │   ├── __root.tsx         # Root layout with nav bar
│   │   ├── index.tsx          # Vote page: fetches pokemon, passes to useNextPair + useTierlist
│   │   └── tierlist.tsx       # Full tierlist page with early-data warning banner
│   ├── routeTree.gen.ts       # AUTO-GENERATED by TanStack Router CLI — do not edit manually
│   ├── router.ts              # Router instance + Register module augmentation
│   └── main.tsx               # Entry point: QueryClient + RouterProvider
├── .env.local                 # GITIGNORED — VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
├── biome.json                 # Biome lint + format config
├── tsconfig.app.json          # App TypeScript config (src/)
├── tsconfig.scripts.json      # Scripts TypeScript config (scripts/)
├── vite.config.ts             # Vite config: React plugin, Tailwind plugin, @ path alias
└── AGENTS.md                  # This file
```

---

## Data model (Supabase / Postgres tables)

Schema lives in `supabase/migrations/001_initial.sql`. TypeScript types are in `src/lib/database.types.ts` (regenerate with `bun run gen-types`).

**`pokemon`** — seeded once via `scripts/seed-supabase.ts`, never mutated at runtime.
```sql
id           integer primary key
name         text not null            -- e.g. "iron-valiant"
display_name text not null            -- e.g. "Iron Valiant"
sprite_url   text not null
type1        text not null
type2        text                     -- nullable
bst          integer not null
```

**`ratings`** — one row per Pokémon, updated after every non-skip vote.
```sql
pokemon_id  integer primary key references pokemon(id)
mu          double precision not null
sigma       double precision not null
ordinal     double precision not null  -- mu - 3*sigma. Higher = better.
match_count integer not null default 0
```
Initial values: `mu=25, sigma=25/3` (standard Weng-Lin defaults).

**`matchups`** — append-only log of every comparison shown.
```sql
id         bigserial primary key
winner_id  integer not null references pokemon(id)
loser_id   integer not null references pokemon(id)
skipped    boolean not null default false
created_at timestamptz not null default now()
```

### In-app type names

The Supabase row types (`RatingRow`, `MatchupRow`, `PokemonRow`) use snake_case as returned by Postgres. The in-app ranking types (`Rating`, `Matchup`) use camelCase and live in `src/types/rating.ts`. Conversion happens only in `rankingService.ts` — nowhere else.

### Row Level Security

All three tables have RLS enabled. The `anon` role can `SELECT` from all tables. Direct `INSERT`/`UPDATE` on `ratings` and `matchups` is blocked for `anon` — mutations must go through the security-definer RPCs:

- **`record_vote(...)`** — atomically updates both rating rows and appends a non-skipped matchup in a single transaction. Takes the pre-computed updated rating values as arguments (OpenSkill math runs client-side).
- **`record_skip(...)`** — appends a skipped matchup entry. Ratings are not updated.

The `pokemon` table is read-only for all runtime clients. Seeding uses the service role key, which bypasses RLS.

---

## Ranking algorithm

**OpenSkill `bradleyTerryFull` model.** Each Pokémon has a Gaussian skill distribution (μ, σ). After each vote, both participants' distributions are updated via the Weng-Lin online approximation of Bradley-Terry.

Why OpenSkill over the alternatives:
- **vs Elo** — Elo has no uncertainty tracking. A Pokémon with 1 win looks as confident as one with 500. Bad for sparse early data.
- **vs Glicko-2** — Glicko-2 is excellent but designed for batch rating periods. Volatility parameter is meaningless for static items like Pokémon.
- **vs TrueSkill** — Microsoft patent. Avoid.
- **OpenSkill** — Bayesian uncertainty, fully online updates, MIT licensed, actively maintained. `ordinal = μ - 3σ` naturally suppresses under-voted Pokémon.

Core wrapper: `src/ranking/openskill.ts` — `applyMatchResult(winner, loser)` returns an `Effect<MatchResult, RankingError>`.

---

## Pair selection algorithm

`src/ranking/pairSelection.ts` — `selectNextPair(pool, recentMatchups)` returns `Effect<SelectedPair, PairSelectionError>`.

Pair selection runs **entirely client-side** on the in-memory ratings snapshot held by `useNextPair`. No round-trip to the server is needed to compute the next pair. The full `ratings` table (~664 rows × ~5 fields ≈ ~80–100 KB of JSON on initial sync) is kept in memory; delta updates from Supabase Realtime patch individual rows as votes land.

Goal: maximise information gained per vote.

1. Assign each Pokémon an **uncertainty weight** proportional to σ (high σ = less data = higher priority).
2. Sample 40 candidate pairs by drawing two Pokémon independently from that weighted distribution.
3. Score each candidate pair:
   - **60% — uncertainty**: average σ of both Pokémon (normalised)
   - **40% — proximity**: how close their ordinals are. Close ordinals = uncertain outcome = more informative.
4. Apply a 95% penalty to pairs seen in the last 30 matchups.
5. Return the highest-scoring candidate.

O(40) per call — never O(n²). Constants (`CANDIDATE_SAMPLE_SIZE`, `UNCERTAINTY_WEIGHT`, etc.) are named at the top of the file.

---

## Tier assignment — strategy pattern

`src/ranking/tiers.ts`. The active strategy is a config value, trivially swappable.

```ts
type TierStrategy = (sorted: RatedPokemon[]) => TierAssignment[]
```

Three implementations:

| Name | Key | How it works |
|---|---|---|
| Fixed percentile | `fixedPercentile` | Top 5% = S, +15% = A, +30% = B, +30% = C, +20% = D. **Default.** Stable, predictable. |
| Std dev bands | `stdDev` | Boundaries at mean ± 0.5σ and ± 1.5σ. Organic, distribution-aware. |
| K-means | `kmeans` | Lloyd's algorithm, k=5, on ordinal scores. Finds natural clusters. Boundaries shift over time. |

To add a new strategy: implement the `TierStrategy` signature, add it to `TIER_STRATEGIES` in `tiers.ts`, add its label to `STRATEGY_LABELS` in `TierlistPreview.tsx`.

Default cutoffs for `fixedPercentile` are in `DEFAULT_PERCENTILE_CUTOFFS`. With 664 Pokémon these produce roughly: S≈33, A≈100, B≈199, C≈199, D≈133.

---

## Confidence metrics

`src/ranking/openskill.ts`.

**Per-Pokémon confidence:** `1 - (σ / σ_initial)` → [0, 1]. Approaches 1 as matches accumulate and σ shrinks.

**Global confidence:** Weighted mean of per-Pokémon confidence. Pokémon within ±5% of a tier boundary are weighted 2× (they matter most for final tierlist quality). Displayed in `ConfidenceBar`.

**Votes needed estimate:** Projects current average σ reduction per match forward to reach `targetConfidence` (default 90%). Cold-starts with a 0.3 σ/match heuristic; switches to an empirical estimate once real data exists.

The bar will move slowly early on — each vote only updates 2 of 664 ratings. Expect meaningful convergence after several hundred votes.

---

## Effect usage conventions

Effect is used for typed error handling and composable async. It does **not** take over the React component tree.

**Error types** are `Data.TaggedError` subclasses defined at the top of each module:
- `DbError` — Supabase operation failed
- `SeedError` — database seeding failed (seed script only)
- `RankingError` — OpenSkill computation threw
- `PairSelectionError` — could not generate a valid pair

**In services and ranking code:** functions return `Effect<T, E>`, composed with `Effect.gen`.

**At the React boundary:** call `Effect.runPromise(...)` and handle failures in `.catch()`. Effect does not leak into JSX.

**In the prefetch script:** `Effect.all` with concurrency limiting, `Effect.retry` with `Schedule.exponential` for network failures.

Do not introduce `Effect.runSync` or `Effect.runSyncExit` in new service code — async operations must stay async.

---

## Reactivity model

The app uses **Supabase Realtime** (`postgres_changes`) for reactive state instead of Dexie's `liveQuery`. Both hooks follow the same pattern:

1. On mount: fetch initial data via a one-time Supabase query.
2. Subscribe to Realtime channels for surgical in-place updates.
3. On unmount: remove channels to avoid leaks.

- `useNextPair(pokemon)` — holds all ratings + last 30 matchups in local state. On a `ratings` UPDATE, patches the changed row. On a `matchups` INSERT, prepends the new row and trims to 30. Pair selection then re-runs via `useMemo`.
- `useTierlist(pokemon, strategy)` — holds all ratings + a running vote count. On a `ratings` UPDATE, patches the row. On a `matchups` INSERT, increments the counter if not skipped. Tier computation re-runs via `useMemo`.

Both hooks take `pokemon` as a parameter (from `usePokemon`) rather than fetching it themselves. This avoids three separate fetches of the same static data.

After a vote is recorded in `rankingService.ts`, **no manual cache invalidation is needed**. Supabase Realtime pushes the updated rows to all connected clients automatically.

TanStack Query (`usePokemon`) is used only for the static Pokémon list with `staleTime: Infinity` — it fetches from Supabase once and never refetches.

---

## Routing

TanStack Router with file-based routing. Routes live in `src/routes/`:

| File | Path | Purpose |
|---|---|---|
| `__root.tsx` | — | Root layout: nav bar, `<Outlet />` |
| `index.tsx` | `/` | Vote page: DB seed on mount, comparison UI, live tierlist sidebar |
| `tierlist.tsx` | `/tierlist` | Full tierlist page with confidence bar and strategy switcher |

**After adding, renaming, or removing a route file**, regenerate `src/routeTree.gen.ts`:
```bash
bunx @tanstack/router-cli generate --routesDirectory=src/routes --generatedRouteTree=src/routeTree.gen.ts
```

`routeTree.gen.ts` is auto-generated — never edit it by hand. The `noExplicitAny` Biome rule is suppressed for it via `biome.json` override.

---

## Static Pokédex asset

`src/assets/pokemon.json` is committed. Format:
```ts
interface PokemonAsset {
  generatedAt: string;  // ISO timestamp
  count: number;
  pokemon: Pokemon[];   // Sorted by national dex ID
}
```

The file covers 664 Pokémon available in Gen 9 games (Scarlet/Violet base + Teal Mask + Indigo Disk DLCs). It is the union of the `paldea`, `kitakami`, and `blueberry` regional Pokédexes from PokéAPI, deduplicated by national dex ID.

The `scripts/fetch-pokemon.ts` script that produces it uses:
- `Effect.all(..., { concurrency: 5 })` — polite rate limiting
- `Schedule.exponential` retry on network failures
- Writes via `writeFileSync` after full deduplication and sorting

Sprites are the front-default pixel sprites from the PokéAPI CDN. They render with `style={{ imageRendering: "pixelated" }}`.

---

## Keyboard navigation (vote page)

| Key | Action |
|---|---|
| `←` Arrow Left | Left Pokémon wins |
| `→` Arrow Right | Right Pokémon wins |
| `Space` | Skip |

Handler is a `window` `keydown` listener in `ComparisonView`. It guards against firing when a form element is focused. Key hints are rendered below the skip button while idle and hidden after a vote is cast.

---

## Code style

- **Formatter:** Biome, tabs for indentation, double quotes, trailing commas, line width 100.
- **Imports:** Sorted automatically by Biome's `organizeImports`. Use `import type` for type-only imports.
- **Node builtins:** Use `node:` protocol (`node:fs`, `node:path`, `node:url`).
- **No `any`:** `noExplicitAny` is enforced. Use `unknown` + type narrowing.
- **Path alias:** `@/` maps to `src/`. Use it for all intra-`src` imports.
- **Pure ranking functions:** `src/ranking/` contains no side effects, no DB calls, no React. Keep it that way.
- **Services own DB access:** All Dexie reads/writes go through `src/services/rankingService.ts`. Components and hooks call service functions or read from Dexie via `liveQuery`, never raw Dexie operations in component files.

Run `bun run lint:fix` before committing. CI equivalent is `bun run lint`.

---

## Environment variables

| Variable | Where used | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` | Your Supabase project URL (e.g. `https://abc.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` | Supabase anon/public key — safe to expose in the browser |
| `SUPABASE_URL` | Seed script only | Same URL, passed as an env var to `scripts/seed-supabase.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Seed script only | Service role key — **never expose in the browser or commit** |

The `VITE_` prefix makes variables available to Vite's client bundle. Variables without it are only accessible in Node/Bun scripts.

## Deployment checklist

1. Run `supabase/migrations/001_initial.sql` against your Supabase project (SQL editor or `supabase db push`).
2. Run `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun run seed-supabase` once.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your hosting environment (Vercel / Netlify env vars).
4. Deploy the Vite build output (`dist/`).

## Known limitations / planned work

- **No per-user vote tracking.** All votes are anonymous and shared. Adding accounts would require Supabase Auth and a `user_id` column on `matchups`.
- **No manual tier overrides.** Pinning a Pokémon to a tier and locking it out of the algorithm would be useful for obvious cases.
- **Bundle size.** `pokemon.json` is bundled into the main JS chunk (~666 KB minified). Dynamic `import()` with `React.lazy` would cut cold-start time.
- **No data export.** A button to download current ratings + tier assignments as JSON would be trivial to add.
- **No reset UI.** Clearing all votes requires truncating the `matchups` table and resetting `ratings` to initial values via Supabase SQL editor.
- **Race condition on concurrent votes.** `recordVote` reads both ratings then calls `record_vote` RPC. Two simultaneous votes on the same Pokémon could read the same pre-update sigma. This is unlikely to matter in practice (the algorithm is self-correcting) but could be tightened with a Postgres advisory lock in the RPC if needed.