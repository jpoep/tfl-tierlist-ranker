/**
 * A single Pokémon entry as stored in the static asset and Supabase `pokemon` table.
 * This interface is the canonical "schema" for pokemon.json and the DB table.
 *
 * For Pokémon with multiple formes (e.g. Rotom, Urshifu, Ogerpon), each forme is its
 * own entry. The `id` field always holds the national Pokédex number of the base species,
 * so formes of the same Pokémon share an `id`. The `name` field holds the unique
 * PokéAPI pokemon-level slug (e.g. "rotom-heat"), which serves as the stable unique key.
 */
export interface Pokemon {
  /** National Pokédex number of the base species — NOT unique across formes */
  id: number;
  /**
   * Lowercase hyphenated PokéAPI pokemon-level slug (e.g. "rotom-heat", "urshifu-rapid-strike").
   * This IS unique across all entries, including formes, and is the primary key for ranking.
   */
  name: string;
  /** Human-readable display name of the base species (e.g. "Rotom", "Urshifu") */
  displayName: string;
  /**
   * The PokéAPI pokemon-level slug for this specific forme.
   * For the default/only form this equals `name`. For alternate formes
   * (e.g. "rotom-heat") it identifies the forme within the species.
   */
  formName: string;
  /**
   * Human-readable name for this specific forme (e.g. "Rotom Heat", "Urshifu Rapid Strike").
   * For Pokémon with only one form this equals `displayName`.
   */
  formDisplayName: string;
  /** URL to the front-default pixel sprite from PokéAPI */
  spriteUrl: string;
  /** Primary type (e.g. "fire") */
  type1: string;
  /** Secondary type, if any */
  type2: string | null;
  /** Base stat total */
  bst: number;
}

/**
 * The shape of the committed static asset at src/assets/pokemon.json.
 */
export interface PokemonAsset {
  /** ISO timestamp of when the asset was generated */
  generatedAt: string;
  /** Total number of Pokémon entries (including alternate formes) in the asset */
  count: number;
  pokemon: Pokemon[];
}
