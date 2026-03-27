import type { Tables } from "./database.types";

/**
 * Convenience row types derived from the Supabase-generated schema.
 *
 * Import from here instead of from database.types.ts directly.
 * database.types.ts is fully generated and must never be edited by hand —
 * regenerate it at any time with `bun run gen-types` and nothing here breaks.
 */

export type PokemonRow = Tables<"pokemon">;
export type RatingRow = Tables<"ratings">;
export type MatchupRow = Tables<"matchups">;
