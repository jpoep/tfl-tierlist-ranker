import { Data, Effect } from "effect";
import { db } from "@/db";
import type { Matchup, Rating } from "@/db/schema";
import { applyMatchResult, createInitialRating, type RankingError } from "@/ranking/openskill";
import type { Pokemon } from "@/types/pokemon";

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
// Internal DB helpers wrapped in Effect
// ---------------------------------------------------------------------------

const dbGet = <T>(operation: () => Promise<T>, context: string): Effect.Effect<T, DbError> =>
	Effect.tryPromise({
		try: operation,
		catch: (cause) => new DbError({ message: `DB read failed: ${context}`, cause }),
	});

const dbWrite = (
	operation: () => Promise<unknown>,
	context: string,
): Effect.Effect<void, DbError> =>
	Effect.tryPromise({
		try: () => operation().then(() => undefined),
		catch: (cause) => new DbError({ message: `DB write failed: ${context}`, cause }),
	});

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Seeds the `pokemon` and `ratings` tables from the static asset.
 * Idempotent — safe to call on every app start.
 * Only writes rows that don't already exist.
 */
export const seedDatabase = (
	pokemonList: Pokemon[],
): Effect.Effect<{ seeded: number }, SeedError> =>
	Effect.tryPromise({
		try: async () => {
			const existingCount = await db.pokemon.count();

			if (existingCount === pokemonList.length) {
				return { seeded: 0 };
			}

			const existingIds = new Set((await db.pokemon.toArray()).map((p) => p.id));

			const newPokemon = pokemonList.filter((p) => !existingIds.has(p.id));

			if (newPokemon.length === 0) {
				return { seeded: 0 };
			}

			const newRatings: Rating[] = newPokemon.map((p) => createInitialRating(p.id));

			await db.transaction("rw", [db.pokemon, db.ratings], async () => {
				await db.pokemon.bulkAdd(newPokemon);
				await db.ratings.bulkAdd(newRatings);
			});

			return { seeded: newPokemon.length };
		},
		catch: (cause) => new SeedError({ message: "Failed to seed database", cause }),
	});

// ---------------------------------------------------------------------------
// Record a vote
// ---------------------------------------------------------------------------

/**
 * Records a user vote (winner beats loser), updates both ratings,
 * and appends to matchup history — all in a single Dexie transaction.
 */
export const recordVote = (
	winnerId: number,
	loserId: number,
): Effect.Effect<void, RankingServiceError> =>
	Effect.gen(function* () {
		const [winnerRating, loserRating] = yield* dbGet(
			() => Promise.all([db.ratings.get(winnerId), db.ratings.get(loserId)]),
			`fetch ratings for ${winnerId} vs ${loserId}`,
		);

		if (!winnerRating) {
			return yield* Effect.fail(
				new DbError({
					message: `Rating not found for pokemonId ${winnerId}`,
				}),
			);
		}

		if (!loserRating) {
			return yield* Effect.fail(
				new DbError({
					message: `Rating not found for pokemonId ${loserId}`,
				}),
			);
		}

		const { updatedWinner, updatedLoser } = yield* applyMatchResult(winnerRating, loserRating);

		const matchup: Matchup = {
			winnerId,
			loserId,
			skipped: false,
			timestamp: Date.now(),
		};

		yield* dbWrite(
			() =>
				db.transaction("rw", [db.ratings, db.matchups], async () => {
					await db.ratings.put(updatedWinner);
					await db.ratings.put(updatedLoser);
					await db.matchups.add(matchup);
				}),
			`record vote ${winnerId} > ${loserId}`,
		);
	});

// ---------------------------------------------------------------------------
// Record a skip
// ---------------------------------------------------------------------------

/**
 * Records a skipped comparison. The pair is logged in matchup history
 * (so the pair-selection cooldown applies) but ratings are not updated.
 */
export const recordSkip = (pokemonAId: number, pokemonBId: number): Effect.Effect<void, DbError> =>
	dbWrite(
		() =>
			db.matchups.add({
				winnerId: pokemonAId,
				loserId: pokemonBId,
				skipped: true,
				timestamp: Date.now(),
			}),
		`record skip ${pokemonAId} vs ${pokemonBId}`,
	);

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Fetches all Pokémon from the DB, sorted by id.
 */
export const getAllPokemon = (): Effect.Effect<Pokemon[], DbError> =>
	dbGet(() => db.pokemon.orderBy("id").toArray(), "getAllPokemon");

/**
 * Fetches all ratings from the DB.
 */
export const getAllRatings = (): Effect.Effect<Rating[], DbError> =>
	dbGet(() => db.ratings.toArray(), "getAllRatings");

/**
 * Fetches the N most recent matchups (for pair selection cooldown).
 */
export const getRecentMatchups = (limit: number): Effect.Effect<Matchup[], DbError> =>
	dbGet(
		() => db.matchups.orderBy("timestamp").reverse().limit(limit).toArray(),
		`getRecentMatchups(${limit})`,
	);

/**
 * Fetches total matchup count (excluding skips) for stats display.
 */
export const getVoteCount = (): Effect.Effect<number, DbError> =>
	dbGet(() => db.matchups.filter((m) => !m.skipped).count(), "getVoteCount");
