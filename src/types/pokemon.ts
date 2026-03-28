/**
 * A single Pokémon entry as stored in the static asset and Dexie `pokemon` table.
 * This interface is the canonical "schema" for pokemon.json and the DB table.
 */
export interface Pokemon {
	/** National Pokédex number — primary key */
	id: number;
	/** Lowercase hyphenated name as returned by PokéAPI (e.g. "iron-valiant") */
	name: string;
	/** Human-readable display name (e.g. "Iron Valiant") */
	displayName: string;
	/** URL to the front-default pixel sprite from PokéAPI */
	spriteUrl: string;
	/** Primary type (e.g. "fire") */
	type1: string;
	/** Secondary type, if any */
	type2: string | null;
	/** Base stat total */
	bst: number;
	/** True if this Pokémon has no further evolutions (i.e. it is the final stage) */
	isFinalEvo: boolean;
}

/**
 * The shape of the committed static asset at src/assets/pokemon.json.
 */
export interface PokemonAsset {
	/** ISO timestamp of when the asset was generated */
	generatedAt: string;
	/** Total number of Pokémon in the asset */
	count: number;
	pokemon: Pokemon[];
}
