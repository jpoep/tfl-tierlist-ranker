# TFL Tierlist Ranker

A pairwise ranking system for the TFL (The Fantasy League) Pokémon draft league. Instead of a council voting on a static spreadsheet, every Pokémon is ranked through head-to-head comparisons using a statistical rating algorithm. The more votes are cast, the more the tierlist converges on a community consensus.

## Quick Start

```bash
bun install
bun run dev
```

The app seeds itself from a committed static asset on first load — no network calls needed at runtime.

To regenerate the Pokédex asset (only needed if PokéAPI data changes):

```bash
bun run fetch-pokemon
```

## Stack

| Concern | Choice | Why |
|---|---|---|
| UI | React 19 + Vite | Standard |
| Routing | TanStack Router | File-based, fully type-safe |
| Server state | TanStack Query | Caching for the seeded Pokémon list |
| Local DB | Dexie.js (IndexedDB) | Async, typed, `liveQuery` for reactivity, no glue code |
| Ranking | OpenSkill (`bradleyTerryFull`) | Patent-free TrueSkill equivalent, Bayesian uncertainty, online updates |
| Effects / async | Effect | Typed error channels, composable async pipelines |
| Styling | Tailwind CSS v4 | Utility-first, `@tailwindcss/vite` plugin (no config file needed) |
| Linting / formatting | Biome | Single tool replacing ESLint + Prettier |
| Runtime | Bun | Fast installs, runs the prefetch script directly |

## Why OpenSkill instead of Glicko-2 or Elo?

Three systems were seriously considered:

- **Elo** — simplest possible, 15 lines of code. No uncertainty tracking means a Pokémon with 1 win looks as confident as one with 500. Fine for large vote volumes, bad for early data.
- **Glicko-2** — adds a Rating Deviation (RD) that shrinks as matches are played and grows when idle. Good fit, but designed for batch rating periods rather than live per-vote updates, and volatility is somewhat meaningless for static items like Pokémon.
- **OpenSkill (`bradleyTerryFull`)** — Bayesian uncertainty (σ) like Glicko-2's RD, fully online updates, MIT licensed, no patent issues (unlike TrueSkill), actively maintained. The `ordinal()` display score (`μ - 3σ`) naturally suppresses Pokémon with few votes — they rank conservatively until enough data exists.

OpenSkill wins on all axes that matter here.

## Why Dexie.js instead of SQLite/PGlite?

Two serious contenders:

- **PGlite** — full PostgreSQL in WASM, auto-persists to IndexedDB, perfect schema migration story to a real Postgres backend. 3–7 MB WASM bundle.
- **Dexie.js** — thin IndexedDB wrapper, ~22 KB gzipped, excellent TypeScript, `liveQuery()` for reactive UI, zero config. Not SQL, but the three-table data model here doesn't need joins.

Dexie wins for this prototype. The TypeScript types on the Dexie tables serve as the schema contract, and migrating to a real backend later means those types become your API payload types with minimal rework. `localStorage` was ruled out early — the 5 MB cap would be hit once match history grows.

**One Dexie gotcha worth knowing:** `.where(column)` only works on columns that are explicitly listed in the `.stores()` schema string (those are the IndexedDB indexes). Unindexed columns must use `.filter()` instead. Boolean columns like `skipped` are a common trap — bad cardinality makes them useless as indexes anyway, so `.filter((m) => !m.skipped)` is always the right call.

## Project Structure

```
tfl-tierlist-ranker/
├── scripts/
│   └── fetch-pokemon.ts       # One-time PokéAPI prefetch, run with `bun run fetch-pokemon`
├── src/
│   ├── assets/
│   │   └── pokemon.json       # Committed static asset — 664 Gen 9 Pokémon, never fetched at runtime
│   ├── types/
│   │   └── pokemon.ts         # Pokemon + PokemonAsset interfaces — the "schema" for the JSON asset
│   ├── db/
│   │   ├── schema.ts          # Dexie DB class, table definitions, and row types (Rating, Matchup)
│   │   └── index.ts           # Singleton db export
│   ├── ranking/
│   │   ├── openskill.ts       # Pure OpenSkill wrappers (Effect), confidence math, estimateVotesNeeded
│   │   ├── pairSelection.ts   # Smart pair selection algorithm (Effect pipeline)
│   │   └── tiers.ts           # Tier assignment — strategy pattern, three implementations
│   ├── services/
│   │   └── rankingService.ts  # Effect-based service layer: seedDatabase, recordVote, recordSkip, reads
│   ├── hooks/
│   │   ├── usePokemon.ts      # TanStack Query hook for the Pokémon list (staleTime: Infinity)
│   │   ├── useNextPair.ts     # Dexie liveQuery → pair selection, re-runs after every vote
│   │   └── useTierlist.ts     # Dexie liveQuery → full tiered list + confidence metrics
│   ├── components/
│   │   ├── ComparisonView.tsx # Voting UI: two cards, vote handlers, keyboard navigation
│   │   ├── PokemonCard.tsx    # Single card: pixelated sprite, type badges, hover/selected states
│   │   ├── TierlistPreview.tsx # S/A/B/C/D tier rows with strategy switcher
│   │   └── ConfidenceBar.tsx  # Progress bar with target marker and "N votes needed" estimate
│   ├── routes/
│   │   ├── __root.tsx         # Root layout with nav
│   │   ├── index.tsx          # Vote page: DB seeding on mount, comparison + live sidebar
│   │   └── tierlist.tsx       # Full tierlist page with early-data warning
│   ├── router.ts              # TanStack Router instance + module augmentation
│   └── main.tsx               # App entry: QueryClient + RouterProvider
```

## Data Model

Three Dexie tables:

**`pokemon`** — seeded once from `pokemon.json`, never mutated.
```ts
{ id: number, name: string, displayName: string, spriteUrl: string, type1: string, type2: string | null, bst: number }
```

**`ratings`** — one row per Pokémon, updated after every non-skip vote.
```ts
{ pokemonId: number, mu: number, sigma: number, ordinal: number, matchCount: number }
```
`ordinal = mu - 3*sigma` — the display score. Higher is better, penalised by uncertainty.

**`matchups`** — append-only history of every comparison shown.
```ts
{ id: number, winnerId: number, loserId: number, skipped: boolean, timestamp: number }
```
Skipped pairs are recorded so the pair-selection cooldown applies to them too.

## Ranking Flow

1. App mounts → `seedDatabase()` runs (idempotent) → populates `pokemon` + `ratings` from the JSON asset with default OpenSkill values (`μ=25, σ=25/3`)
2. `useNextPair` queries all ratings and recent matchups via `liveQuery`, runs pair selection, returns a `SelectedPair`
3. User votes (or skips) → `recordVote` / `recordSkip` writes to Dexie inside a transaction
4. Dexie notifies all `liveQuery` subscribers → `useNextPair` and `useTierlist` both recompute automatically — no manual cache invalidation

## Pair Selection Strategy

Implemented in `src/ranking/pairSelection.ts`. The goal is to maximise information gained per vote.

1. Compute a per-Pokémon **uncertainty weight** proportional to σ (high σ = less data = higher priority)
2. Sample `CANDIDATE_SAMPLE_SIZE` (40) candidate pairs by drawing two Pokémon independently from the uncertainty-weighted distribution
3. Score each candidate pair on two axes:
   - **Uncertainty** (60% weight): average σ of both Pokémon
   - **Proximity** (40% weight): how close their ordinals are — close matchups are more informative because the outcome is less predictable
4. Apply a heavy penalty (`5% weight`) to pairs that appeared in the last 30 matchups
5. Return the highest-scoring candidate

O(40) per call — never O(n²).

## Tier Assignment — Strategy Pattern

Three strategies are implemented in `src/ranking/tiers.ts` and switchable live in the UI:

| Strategy | How it works | Notes |
|---|---|---|
| `fixedPercentile` | Top 5% = S, next 15% = A, next 30% = B, next 30% = C, bottom 20% = D | **Default.** Stable boundaries, predictable tier sizes. Good for a draft league where S tier should be rare (~33 Pokémon out of 664). |
| `stdDev` | Bands at mean ± 0.5σ / 1.5σ | Organic sizes, reflects true score distribution. Tier sizes will vary significantly. |
| `kmeans` | Lloyd's algorithm, k=5, 1D on ordinals | Finds natural groupings. Boundaries shift as votes come in. |

Adding a new strategy: implement `(sorted: RatedPokemon[]) => TierAssignment[]`, add it to `TIER_STRATEGIES`, done.

## Confidence Metrics

Implemented in `src/ranking/openskill.ts`.

**Per-Pokémon confidence:** `1 - (σ / σ_initial)` — how much of the initial uncertainty has been resolved. Approaches 1 as matches accumulate.

**Global confidence:** Weighted mean of per-Pokémon confidence, where Pokémon within ±5% of a tier boundary are weighted 2× (their relative ordering matters most for tierlist quality).

**Votes needed estimate:** Projects current average σ reduction per match forward to reach 90% global confidence. Cold-start uses a heuristic (0.3 σ/match); once real data exists it uses an empirical estimate. Displayed in `ConfidenceBar`.

The confidence bar will move slowly at first with 664 Pokémon — each vote only updates 2 ratings. It meaningfully accelerates after a few hundred votes.

## Effect Usage

[Effect](https://effect.website) is used for typed error handling and composable async code, not as a full runtime takeover. Specific uses:

- **`rankingService.ts`** — all DB operations return `Effect<T, DbError | SeedError | RankingError>`. Errors are tagged data classes (`Data.TaggedError`) so call sites get exhaustive type-checked error handling.
- **`pairSelection.ts`** — the selection pipeline is an `Effect.gen` that yields typed failures if the pool is too small or no candidates can be generated.
- **`openskill.ts`** — `applyMatchResult` wraps the OpenSkill `rate()` call in `Effect.try` so any unexpected throw surfaces as a typed `RankingError` rather than an untyped exception.
- **`scripts/fetch-pokemon.ts`** — the prefetch pipeline uses `Effect.all` with concurrency, `Effect.retry` with exponential backoff for network failures, and `Effect.gen` for the overall orchestration.

React components call `Effect.runPromise(...)` at the boundary and handle failures in `.catch()` — Effect doesn't leak into JSX.

## Keyboard Navigation

On the vote page:

| Key | Action |
|---|---|
| `←` | Left Pokémon wins |
| `→` | Right Pokémon wins |
| `Space` | Skip |

The handler guards against firing when a form element is focused. Hints are displayed below the skip button while idle.

## Pokédex Asset

`src/assets/pokemon.json` is committed to the repo. It was generated by `scripts/fetch-pokemon.ts` which:

1. Fetches the `paldea`, `kitakami`, and `blueberry` regional Pokédexes from PokéAPI
2. Takes the union of all species (664 unique Pokémon as of generation)
3. Fetches species + default form data for each (with 5-concurrent, retry-with-backoff)
4. Writes `{ generatedAt, count, pokemon[] }` to `src/assets/pokemon.json`

The asset includes: national dex ID, hyphenated API name, display name, sprite URL (front-default pixel sprite), primary/secondary type, and base stat total. Sprites use `image-rendering: pixelated` in CSS for the authentic look.

Re-run `bun run fetch-pokemon` any time the upstream data needs refreshing.

## Known Gaps / Future Work

- **No multi-user support** — single user per browser, no server. Architecture will need a rethink when adding accounts; the Dexie types map cleanly to a REST/Postgres schema when the time comes.
- **No manual tier overrides** — ability to pin Pokémon to a tier and lock them out of the algorithm would be useful for obvious cases.
- **Bundle size** — `pokemon.json` is bundled into the main chunk (~666 KB minified). A `React.lazy` + dynamic `import()` of the asset would improve cold-start. Non-issue for a LAN/local prototype.
- **No export** — a JSON dump of current ratings + tier assignments would be straightforward to add as a download button.
- **`routeTree.gen.ts`** — auto-generated by `@tanstack/router-cli`. Do not edit. Regenerate with `bunx @tanstack/router-cli generate --routesDirectory=src/routes --generatedRouteTree=src/routeTree.gen.ts`.