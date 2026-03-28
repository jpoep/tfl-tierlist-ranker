/**
 * A Pokémon's current OpenSkill rating.
 *
 * This interface is the canonical in-app representation used throughout
 * src/ranking/ and src/hooks/. It is intentionally decoupled from both
 * the old Dexie schema (db/schema.ts, now deleted) and the Supabase row
 * format (RatingRow in src/lib/database.types.ts, which uses snake_case).
 *
 * Conversion between RatingRow ↔ Rating lives in rankingService.ts.
 */
export interface Rating {
  /** FK → pokemon.name (the PokéAPI slug, e.g. "rotom-heat") */
  pokemonName: string;
  /** OpenSkill mean skill estimate */
  mu: number;
  /** OpenSkill uncertainty (standard deviation) */
  sigma: number;
  /** Display score: mu - 3*sigma. Higher is better. */
  ordinal: number;
  /** Total number of non-skipped matchups this Pokémon has participated in */
  matchCount: number;
}

/**
 * A single recorded comparison between two Pokémon.
 * Mirrors the matchups table row but uses camelCase and a JS timestamp.
 */
export interface Matchup {
  /** Auto-incremented primary key (undefined before insert) */
  id?: number;
  winnerName: string;
  loserName: string;
  /** True when the user pressed "skip" — ratings are NOT updated for skips */
  skipped: boolean;
  /** Unix ms timestamp */
  timestamp: number;
}
