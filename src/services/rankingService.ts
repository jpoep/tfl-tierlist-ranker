import { Data, Effect } from "effect";
import type { MatchupRow, RatingRow } from "@/lib/db-types";
import { supabase } from "@/lib/supabase";
import { applyMatchResult, type RankingError } from "@/ranking/openskill";
import pokemonAsset from "@/assets/pokemon.json";
import type { Pokemon } from "@/types/pokemon";

/** Lookup map from national dex ID → isFinalEvo, built once from the static asset. */
const finalEvoById = new Map<number, boolean>(
  (
    pokemonAsset as { pokemon: Array<{ id: number; isFinalEvo: boolean }> }
  ).pokemon.map((p) => [p.id, p.isFinalEvo]),
);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DbError extends Data.TaggedError("DbError")<{
  message: string;
  cause?: unknown;
}> {}

export class SeedError extends Data.TaggedError("SeedError")<{
  message: string;
  cause?: unknown;
}> {}

export type RankingServiceError = DbError | RankingError | SeedError;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Maps a Supabase `RatingRow` (snake_case, pokemon_id) to the app's `Rating`
 * interface (camelCase, pokemonId) used throughout ranking/ and hooks/.
 */
const toRating = (row: RatingRow) => ({
  pokemonId: row.pokemon_id,
  mu: row.mu,
  sigma: row.sigma,
  ordinal: row.ordinal,
  matchCount: row.match_count,
});

/**
 * Maps a Supabase `MatchupRow` to the shape expected by pairSelection.ts.
 */
const toMatchup = (row: MatchupRow) => ({
  id: row.id,
  winnerId: row.winner_id,
  loserId: row.loser_id,
  skipped: row.skipped,
  timestamp: new Date(row.created_at).getTime(),
});

const dbGet = <T>(
  operation: () => Promise<T>,
  context: string,
): Effect.Effect<T, DbError> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new DbError({ message: `DB read failed: ${context}`, cause }),
  });

const dbWrite = (
  operation: () => Promise<unknown>,
  context: string,
): Effect.Effect<void, DbError> =>
  Effect.tryPromise({
    try: () => operation().then(() => undefined),
    catch: (cause) =>
      new DbError({ message: `DB write failed: ${context}`, cause }),
  });

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * No-op in the Supabase version — seeding is done once via the
 * `scripts/seed-supabase.ts` script using the service role key.
 *
 * Kept so call sites in routes/index.tsx don't need to change.
 */
export const seedDatabase = (
  _pokemonList: Pokemon[],
): Effect.Effect<{ seeded: number }, SeedError> =>
  Effect.succeed({ seeded: 0 });

// ---------------------------------------------------------------------------
// Record a vote
// ---------------------------------------------------------------------------

/**
 * Computes the updated ratings client-side with OpenSkill, then calls the
 * `record_vote` Postgres function which writes both rating updates and the
 * matchup log entry as a single atomic transaction.
 */
export const recordVote = (
  winnerId: number,
  loserId: number,
): Effect.Effect<void, RankingServiceError> =>
  Effect.gen(function* () {
    // Fetch current ratings for both participants
    const { data: rows, error: fetchError } = yield* Effect.tryPromise({
      try: () =>
        supabase
          .from("ratings")
          .select("*")
          .in("pokemon_id", [winnerId, loserId]),
      catch: (cause) =>
        new DbError({
          message: `Failed to fetch ratings for ${winnerId} vs ${loserId}`,
          cause,
        }),
    });

    if (fetchError) {
      return yield* Effect.fail(
        new DbError({ message: `Supabase error: ${fetchError.message}` }),
      );
    }

    const winnerRow = rows?.find((r) => r.pokemon_id === winnerId);
    const loserRow = rows?.find((r) => r.pokemon_id === loserId);

    if (!winnerRow) {
      return yield* Effect.fail(
        new DbError({ message: `Rating not found for pokemonId ${winnerId}` }),
      );
    }
    if (!loserRow) {
      return yield* Effect.fail(
        new DbError({ message: `Rating not found for pokemonId ${loserId}` }),
      );
    }

    const winnerRating = toRating(winnerRow);
    const loserRating = toRating(loserRow);

    // Run OpenSkill computation (pure, client-side)
    const { updatedWinner, updatedLoser } = yield* applyMatchResult(
      winnerRating,
      loserRating,
    );

    // Atomically write both updated ratings + matchup row via Postgres function
    yield* dbWrite(async () => {
      const { error } = await supabase.rpc("record_vote", {
        p_winner_id: winnerId,
        p_loser_id: loserId,
        p_winner_mu: updatedWinner.mu,
        p_winner_sigma: updatedWinner.sigma,
        p_winner_ordinal: updatedWinner.ordinal,
        p_winner_match_count: updatedWinner.matchCount,
        p_loser_mu: updatedLoser.mu,
        p_loser_sigma: updatedLoser.sigma,
        p_loser_ordinal: updatedLoser.ordinal,
        p_loser_match_count: updatedLoser.matchCount,
      });
      if (error) throw new Error(error.message);
    }, `record_vote ${winnerId} > ${loserId}`);
  });

// ---------------------------------------------------------------------------
// Record a skip
// ---------------------------------------------------------------------------

/**
 * Appends a skipped matchup entry via the `record_skip` Postgres function.
 * Ratings are NOT updated for skips.
 */
export const recordSkip = (
  pokemonAId: number,
  pokemonBId: number,
): Effect.Effect<void, DbError> =>
  dbWrite(async () => {
    const { error } = await supabase.rpc("record_skip", {
      p_pokemon_a_id: pokemonAId,
      p_pokemon_b_id: pokemonBId,
    });
    if (error) throw new Error(error.message);
  }, `record_skip ${pokemonAId} vs ${pokemonBId}`);

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Fetches all Pokémon from Supabase, sorted by id.
 * Used by usePokemon (via TanStack Query) for the static Pokémon list.
 */
export const getAllPokemon = (): Effect.Effect<Pokemon[], DbError> =>
  dbGet(async () => {
    const { data, error } = await supabase
      .from("pokemon")
      .select("*")
      .order("id", { ascending: true });

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      spriteUrl: row.sprite_url,
      type1: row.type1,
      type2: row.type2 ?? null,
      bst: row.bst,
      // isFinalEvo is a client-side field derived from the static asset;
      // it is not stored in the Supabase pokemon table.
      isFinalEvo: finalEvoById.get(row.id) ?? true,
    }));
  }, "getAllPokemon");

/**
 * Fetches all ratings from Supabase, mapped to the app's Rating interface.
 */
export const getAllRatings = (): Effect.Effect<
  ReturnType<typeof toRating>[],
  DbError
> =>
  dbGet(async () => {
    const { data, error } = await supabase.from("ratings").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(toRating);
  }, "getAllRatings");

/**
 * Fetches the N most recent matchups (for pair selection cooldown).
 */
export const getRecentMatchups = (
  limit: number,
): Effect.Effect<ReturnType<typeof toMatchup>[], DbError> =>
  dbGet(async () => {
    const { data, error } = await supabase
      .from("matchups")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data ?? []).map(toMatchup);
  }, `getRecentMatchups(${limit})`);

/**
 * Fetches total non-skipped matchup count for stats display.
 */
export const getVoteCount = (): Effect.Effect<number, DbError> =>
  dbGet(async () => {
    const { count, error } = await supabase
      .from("matchups")
      .select("*", { count: "exact", head: true })
      .eq("skipped", false);

    if (error) throw new Error(error.message);
    return count ?? 0;
  }, "getVoteCount");
