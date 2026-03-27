import Dexie, { type EntityTable } from "dexie";
import type { Pokemon } from "@/types/pokemon";

// ---------------------------------------------------------------------------
// Table row types
// ---------------------------------------------------------------------------

/**
 * A Pokémon's current OpenSkill rating.
 * `mu` and `sigma` are the raw Weng-Lin parameters.
 * `ordinal` is the display score (mu - 3*sigma) — higher is better.
 */
export interface Rating {
	/** FK → pokemon.id */
	pokemonId: number;
	mu: number;
	sigma: number;
	/** Derived display score: mu - 3*sigma */
	ordinal: number;
	/** Total number of non-skipped matchups this Pokémon has participated in */
	matchCount: number;
}

/**
 * A single recorded comparison between two Pokémon.
 * Skipped matchups are stored so we can track what's been seen.
 */
export interface Matchup {
	/** Auto-incremented primary key */
	id?: number;
	winnerId: number;
	loserId: number;
	/** True when the user pressed "skip" — winner/loserId still record the pair */
	skipped: boolean;
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Dexie DB class
// ---------------------------------------------------------------------------

export class RankerDB extends Dexie {
	pokemon!: EntityTable<Pokemon, "id">;
	ratings!: EntityTable<Rating, "pokemonId">;
	matchups!: EntityTable<Matchup, "id">;

	constructor() {
		super("tfl-ranker");

		this.version(1).stores({
			// Only indexed columns go here. Full objects are stored automatically.
			pokemon: "id, name",
			ratings: "pokemonId, ordinal, matchCount",
			matchups: "++id, winnerId, loserId, timestamp",
		});
	}
}
