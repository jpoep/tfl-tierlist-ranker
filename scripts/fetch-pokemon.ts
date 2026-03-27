/**
 * scripts/fetch-pokemon.ts
 *
 * One-time prefetch script that pulls all Gen 9 Pokémon data from PokéAPI
 * and writes a static asset to src/assets/pokemon.json.
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
 *   - Scarlet/Violet (paldea-area-1 + paldea-area-2)
 *   - The Teal Mask DLC (kitakami)
 *   - The Indigo Disk DLC (blueberry-academy / bbac)
 *
 * The simplest reliable approach: fetch all three regional Pokédexes and
 * take the union by national dex ID.
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
		versions: {
			"generation-viii": {
				icons: {
					front_default: string | null;
				};
			};
		};
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

const fetchJson = <T>(url: string): Effect.Effect<T, FetchError | NetworkError> =>
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

const fetchPokedex = (name: string): Effect.Effect<PokeAPIPokedex, FetchError | NetworkError> =>
	fetchJson<PokeAPIPokedex>(`${POKEAPI_BASE}/pokedex/${name}`);

const fetchSpecies = (name: string): Effect.Effect<PokeAPISpecies, FetchError | NetworkError> =>
	fetchJson<PokeAPISpecies>(`${POKEAPI_BASE}/pokemon-species/${name}`);

const fetchPokemon = (name: string): Effect.Effect<PokeAPIPokemon, FetchError | NetworkError> =>
	fetchJson<PokeAPIPokemon>(`${POKEAPI_BASE}/pokemon/${name}`);

// ---------------------------------------------------------------------------
// Transformation helpers
// ---------------------------------------------------------------------------

const toDisplayName = (species: PokeAPISpecies): string => {
	const englishName = species.names.find((n) => n.language.name === "en");
	if (englishName) return englishName.name;
	// Fallback: capitalise each hyphen-separated segment
	return species.name
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
};

const pickSprite = (pokemon: PokeAPIPokemon): string => {
	// Prefer the classic front_default sprite (Gen I–VIII pixel art)
	if (pokemon.sprites.front_default) return pokemon.sprites.front_default;
	// Last-resort fallback: PokeAPI CDN direct URL pattern
	return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png`;
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
const fetchGen9SpeciesNames = (): Effect.Effect<string[], FetchError | NetworkError> =>
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
 * Given a species name, fetches its species + default form data
 * and builds a Pokemon record.
 */
const fetchPokemonRecord = (
	speciesName: string,
): Effect.Effect<Pokemon, FetchError | NetworkError> =>
	Effect.gen(function* () {
		const species = yield* fetchSpecies(speciesName);

		// Find the default variety to get the pokemon form data
		const defaultVariety = species.varieties.find((v) => v.is_default);
		const formName = defaultVariety?.pokemon.name ?? speciesName;

		const pokemon = yield* fetchPokemon(formName);

		const record: Pokemon = {
			id: species.id,
			name: species.name,
			displayName: toDisplayName(species),
			spriteUrl: pickSprite(pokemon),
			type1: pokemon.types.find((t) => t.slot === 1)?.type.name ?? "normal",
			type2: pokemon.types.find((t) => t.slot === 2)?.type.name ?? null,
			bst: calcBST(pokemon),
		};

		return record;
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

	// Step 1: collect all Gen 9 species names
	const speciesNames = yield* fetchGen9SpeciesNames();

	// Step 2: fetch full data for each species
	console.log(`\nFetching data for ${speciesNames.length} Pokémon…`);

	const records = yield* withProgress(
		speciesNames.map((name) => fetchPokemonRecord(name)),
		"Pokémon fetched",
	);

	process.stdout.write("\n");

	// Step 3: sort by national dex number, deduplicate by id
	const seen = new Set<number>();
	const deduped = Arr.filter(
		[...records].sort((a, b) => a.id - b.id),
		(p) => {
			if (seen.has(p.id)) return false;
			seen.add(p.id);
			return true;
		},
	);

	console.log(`\nAfter deduplication: ${deduped.length} Pokémon.`);

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
	console.log(`  ${deduped.length} Pokémon · generated at ${asset.generatedAt}`);

	// Quick sanity check
	const missingSprites = deduped.filter((p) => !p.spriteUrl).length;
	if (missingSprites > 0) {
		console.warn(`⚠  ${missingSprites} Pokémon have no sprite URL.`);
	}
});

Effect.runPromise(main).catch((err: unknown) => {
	console.error("\n✗ Script failed:", err);
	process.exit(1);
});
