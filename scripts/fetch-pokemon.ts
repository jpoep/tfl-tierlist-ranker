/**
 * scripts/fetch-pokemon.ts
 *
 * One-time prefetch script that pulls all Gen 9 Pokémon data from PokéAPI
 * and writes a static asset to src/assets/pokemon.json.
 *
 * Key behaviours vs. the previous version:
 *   1. FINAL EVOLUTIONS ONLY — species that have further evolutions are excluded.
 *      e.g. Bulbasaur and Ivysaur are skipped; Venusaur is included.
 *   2. ALL ALTERNATE FORMES — for species with multiple varieties, every variety
 *      that has a valid sprite is included as its own ranked entry.
 *      e.g. Rotom appears 6 times (base + 5 appliance forms).
 *      Mega and G-Max formes are explicitly excluded — they are not legal in
 *      standard draft formats and skew ratings against the base forme.
 *   3. Each entry carries formName (the PokéAPI pokemon slug) and formDisplayName
 *      (human-readable form label) in addition to the species-level name/displayName.
 *
 * Usage:
 *   bun run scripts/fetch-pokemon.ts
 *
 * The output file is committed to the repo so the app never hits PokéAPI at runtime.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Array as Arr, Duration, Effect, Schedule } from "effect";
import type { Pokemon, PokemonAsset } from "../src/types/pokemon.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POKEAPI_BASE = "https://pokeapi.co/api/v2";

/**
 * Gen 9 version group IDs on PokéAPI.
 * We fetch the full union of Pokémon available in:
 *   - Scarlet/Violet (paldea)
 *   - The Teal Mask DLC (kitakami)
 *   - The Indigo Disk DLC (blueberry)
 */
const GEN9_POKEDEX_NAMES = ["paldea", "kitakami", "blueberry"] as const;

/** Max concurrent requests to PokéAPI — be a good citizen */
const CONCURRENCY = 5;

/** Retry policy: up to 3 attempts, exponential backoff starting at 500ms */
const RETRY_POLICY = Schedule.exponential(Duration.millis(500)).pipe(
  Schedule.intersect(Schedule.recurs(3)),
);

// ---------------------------------------------------------------------------
// PokéAPI response types (minimal — only what we need)
// ---------------------------------------------------------------------------

interface PokeAPINamedResource {
  name: string;
  url: string;
}

interface PokeAPIPokedex {
  pokemon_entries: Array<{
    entry_number: number;
    pokemon_species: PokeAPINamedResource;
  }>;
}

interface PokeAPISpecies {
  id: number;
  name: string;
  names: Array<{
    name: string;
    language: PokeAPINamedResource;
  }>;
  /** URL to the evolution chain resource */
  evolution_chain: { url: string };
  varieties: Array<{
    is_default: boolean;
    pokemon: PokeAPINamedResource;
  }>;
}

interface PokeAPIPokemon {
  id: number;
  name: string;
  sprites: {
    front_default: string | null;
  };
  types: Array<{
    slot: number;
    type: PokeAPINamedResource;
  }>;
  stats: Array<{
    base_stat: number;
    stat: PokeAPINamedResource;
  }>;
}

/** Recursive evolution chain node as returned by PokéAPI */
interface PokeAPIChainLink {
  species: PokeAPINamedResource;
  evolves_to: PokeAPIChainLink[];
}

interface PokeAPIEvolutionChain {
  chain: PokeAPIChainLink;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

class FetchError extends Error {
  readonly _tag = "FetchError";
  constructor(
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status} fetching ${url}: ${body}`);
  }
}

class NetworkError extends Error {
  readonly _tag = "NetworkError";
  constructor(
    readonly url: string,
    override readonly cause: unknown,
  ) {
    super(`Network error fetching ${url}`);
  }
}

const fetchJson = <T>(
  url: string,
): Effect.Effect<T, FetchError | NetworkError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new FetchError(url, res.status, body);
      }
      return res.json() as Promise<T>;
    },
    catch: (cause) => {
      if (cause instanceof FetchError) return cause;
      return new NetworkError(url, cause);
    },
  }).pipe(Effect.retry(RETRY_POLICY));

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

const fetchPokedex = (
  name: string,
): Effect.Effect<PokeAPIPokedex, FetchError | NetworkError> =>
  fetchJson<PokeAPIPokedex>(`${POKEAPI_BASE}/pokedex/${name}`);

const fetchSpecies = (
  name: string,
): Effect.Effect<PokeAPISpecies, FetchError | NetworkError> =>
  fetchJson<PokeAPISpecies>(`${POKEAPI_BASE}/pokemon-species/${name}`);

const fetchPokemon = (
  name: string,
): Effect.Effect<PokeAPIPokemon, FetchError | NetworkError> =>
  fetchJson<PokeAPIPokemon>(`${POKEAPI_BASE}/pokemon/${name}`);

const fetchEvolutionChain = (
  url: string,
): Effect.Effect<PokeAPIEvolutionChain, FetchError | NetworkError> =>
  fetchJson<PokeAPIEvolutionChain>(url);

// ---------------------------------------------------------------------------
// Evolution chain helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walks an evolution chain tree and collects the names of all
 * leaf nodes — i.e. species that do not evolve further.
 */
const collectFinalEvolutions = (link: PokeAPIChainLink): string[] => {
  if (link.evolves_to.length === 0) {
    // This is a leaf node — it's a final evolution
    return [link.species.name];
  }
  // Recurse into every branch; this node itself is NOT a final evo
  return link.evolves_to.flatMap((child) => collectFinalEvolutions(child));
};

// ---------------------------------------------------------------------------
// Transformation helpers
// ---------------------------------------------------------------------------

const toSpeciesDisplayName = (species: PokeAPISpecies): string => {
  const englishName = species.names.find((n) => n.language.name === "en");
  if (englishName) return englishName.name;
  // Fallback: capitalise each hyphen-separated segment
  return species.name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

/**
 * Derives a human-readable form display name from the PokéAPI pokemon slug.
 *
 * Strategy:
 *   - Strip the species prefix from the slug (e.g. "rotom-heat" → "heat")
 *   - Capitalise each segment and join with spaces
 *   - Prepend the species display name
 *   e.g. speciesDisplayName="Rotom", formSlug="rotom-heat" → "Rotom Heat"
 *        speciesDisplayName="Urshifu", formSlug="urshifu-rapid-strike" → "Urshifu Rapid Strike"
 *
 * For the default form (formSlug === speciesName) just returns speciesDisplayName.
 */
const toFormDisplayName = (
  speciesName: string,
  speciesDisplayName: string,
  formSlug: string,
): string => {
  if (formSlug === speciesName) return speciesDisplayName;

  // Strip the species name prefix (e.g. "rotom-" from "rotom-heat")
  const prefix = `${speciesName}-`;
  const suffix = formSlug.startsWith(prefix)
    ? formSlug.slice(prefix.length)
    : formSlug;

  const formSuffix = suffix
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return `${speciesDisplayName} ${formSuffix}`;
};

/**
 * Returns true for Mega and G-Max formes, which are excluded from ranking.
 * PokéAPI slugs follow predictable patterns:
 *   - Mega:      <species>-mega, <species>-mega-x, <species>-mega-y
 *   - G-Max:     <species>-gmax
 */
const isMegaOrGmax = (formSlug: string): boolean =>
  /-mega(-[xy])?$/.test(formSlug) || formSlug.endsWith("-gmax");

const pickSprite = (pokemon: PokeAPIPokemon): string | null => {
  if (pokemon.sprites.front_default) return pokemon.sprites.front_default;
  return null;
};

const calcBST = (pokemon: PokeAPIPokemon): number =>
  pokemon.stats.reduce((acc, s) => acc + s.base_stat, 0);

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

/**
 * Fetches all Gen 9 Pokémon species names (as a deduplicated set)
 * by pulling each regional Pokédex and taking the union.
 */
const fetchGen9SpeciesNames = (): Effect.Effect<
  string[],
  FetchError | NetworkError
> =>
  Effect.gen(function* () {
    console.log(`Fetching ${GEN9_POKEDEX_NAMES.length} regional Pokédexes…`);

    const pokedexes = yield* Effect.all(
      GEN9_POKEDEX_NAMES.map((name) => fetchPokedex(name)),
      { concurrency: CONCURRENCY },
    );

    // Union of all species names across all regional dexes
    const nameSet = new Set<string>();
    for (const dex of pokedexes) {
      for (const entry of dex.pokemon_entries) {
        nameSet.add(entry.pokemon_species.name);
      }
    }

    const names = Array.from(nameSet).sort();
    console.log(`Found ${names.length} unique species across Gen 9 dexes.`);
    return names;
  });

/**
 * Given a species, returns whether it is a final evolution by fetching
 * its evolution chain and checking that its name appears as a leaf node.
 *
 * Species with no evolution chain entry (some edge cases) are treated as
 * final evolutions.
 */
const isFinalEvolution = (
  species: PokeAPISpecies,
): Effect.Effect<boolean, FetchError | NetworkError> =>
  Effect.gen(function* () {
    const chain = yield* fetchEvolutionChain(species.evolution_chain.url);
    const finalEvoNames = collectFinalEvolutions(chain.chain);
    return finalEvoNames.includes(species.name);
  });

/**
 * Given a final-evolution species, builds one Pokemon record per forme.
 * Formes that have no valid sprite are silently skipped (e.g. some
 * unreleased or battle-only forms that lack art).
 */
const fetchFormeRecords = (
  species: PokeAPISpecies,
): Effect.Effect<Pokemon[], FetchError | NetworkError> =>
  Effect.gen(function* () {
    const speciesDisplayName = toSpeciesDisplayName(species);

    // Fetch all varieties in parallel
    const varieties = yield* Effect.all(
      species.varieties.map(({ pokemon }) => fetchPokemon(pokemon.name)),
      { concurrency: CONCURRENCY },
    );

    const records: Pokemon[] = [];

    for (const pokemonData of varieties) {
      // Skip Mega and G-Max formes — not legal in standard draft formats
      if (isMegaOrGmax(pokemonData.name)) continue;

      const sprite = pickSprite(pokemonData);

      // Skip forms with no sprite — they're unreleased or broken stubs
      if (sprite === null) continue;

      const record: Pokemon = {
        id: species.id,
        name: pokemonData.name,
        displayName: speciesDisplayName,
        formName: pokemonData.name,
        formDisplayName: toFormDisplayName(
          species.name,
          speciesDisplayName,
          pokemonData.name,
        ),
        spriteUrl: sprite,
        type1:
          pokemonData.types.find((t) => t.slot === 1)?.type.name ?? "normal",
        type2: pokemonData.types.find((t) => t.slot === 2)?.type.name ?? null,
        bst: calcBST(pokemonData),
      };

      records.push(record);
    }

    return records;
  });

/**
 * Full pipeline for a single species name:
 *   1. Fetch species data
 *   2. Check if it's a final evolution — skip if not
 *   3. Fetch all forme records
 *
 * Returns an empty array for non-final-evolution species.
 */
const fetchSpeciesRecords = (
  speciesName: string,
): Effect.Effect<Pokemon[], FetchError | NetworkError> =>
  Effect.gen(function* () {
    const species = yield* fetchSpecies(speciesName);
    const isFinal = yield* isFinalEvolution(species);

    if (!isFinal) return [];

    return yield* fetchFormeRecords(species);
  });

// ---------------------------------------------------------------------------
// Progress logging helper
// ---------------------------------------------------------------------------

const withProgress = <A, E>(
  effects: Effect.Effect<A, E>[],
  label: string,
): Effect.Effect<A[], E> => {
  let completed = 0;
  const total = effects.length;

  return Effect.all(
    effects.map((effect) =>
      effect.pipe(
        Effect.tap(() => {
          completed++;
          if (completed % 10 === 0 || completed === total) {
            process.stdout.write(
              `\r  ${label}: ${completed}/${total} (${Math.round((completed / total) * 100)}%)`,
            );
          }
          return Effect.void;
        }),
      ),
    ),
    { concurrency: CONCURRENCY },
  );
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = Effect.gen(function* () {
  console.log("=== TFL Tierlist — PokéAPI Prefetch Script ===\n");
  console.log("Mode: final evolutions only, all alternate formes included.\n");

  // Step 1: collect all Gen 9 species names
  const speciesNames = yield* fetchGen9SpeciesNames();

  // Step 2: for each species, check if final evo + collect all forme records
  console.log(
    `\nProcessing ${speciesNames.length} species (checking evolution chains + fetching formes)…`,
  );

  const nestedRecords = yield* withProgress(
    speciesNames.map((name) => fetchSpeciesRecords(name)),
    "Species processed",
  );

  process.stdout.write("\n");

  // Step 3: flatten all forme arrays, sort by national dex id then forme name,
  // deduplicate by formName (the unique PokéAPI pokemon slug)
  const allRecords = nestedRecords.flat();

  const seen = new Set<string>();
  const deduped = Arr.filter(
    [...allRecords].sort((a, b) =>
      a.id !== b.id ? a.id - b.id : a.formName.localeCompare(b.formName),
    ),
    (p) => {
      if (seen.has(p.formName)) return false;
      seen.add(p.formName);
      return true;
    },
  );

  // Count base species (non-formes) vs alternate formes
  const finalEvoSpeciesCount = new Set(deduped.map((p) => p.id)).size;
  const formeCount = deduped.length - finalEvoSpeciesCount;

  console.log(`\nFinal evolution species: ${finalEvoSpeciesCount}`);
  console.log(`Alternate formes included: ${formeCount}`);
  console.log(`Total entries: ${deduped.length}`);

  // Step 4: build asset envelope
  const asset: PokemonAsset = {
    generatedAt: new Date().toISOString(),
    count: deduped.length,
    pokemon: deduped,
  };

  // Step 5: write to disk
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const outDir = join(__dirname, "../src/assets");
  const outPath = join(outDir, "pokemon.json");

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(asset, null, 2), "utf-8");

  console.log(`\n✓ Written to ${outPath}`);
  console.log(
    `  ${deduped.length} entries · generated at ${asset.generatedAt}`,
  );

  // Sanity checks
  const missingSprites = deduped.filter((p) => !p.spriteUrl).length;
  if (missingSprites > 0) {
    console.warn(`⚠  ${missingSprites} entries have no sprite URL.`);
  }

  const missingTypes = deduped.filter((p) => !p.type1).length;
  if (missingTypes > 0) {
    console.warn(`⚠  ${missingTypes} entries have no primary type.`);
  }
});

Effect.runPromise(main).catch((err: unknown) => {
  console.error("\n✗ Script failed:", err);
  process.exit(1);
});
