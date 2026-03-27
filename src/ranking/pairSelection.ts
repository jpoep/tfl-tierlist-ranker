import { Array as Arr, Data, Effect, Option } from "effect";
import type { Rating } from "@/db/schema";
import type { Pokemon } from "@/types/pokemon";
import { INITIAL_SIGMA } from "./openskill";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PairSelectionError extends Data.TaggedError("PairSelectionError")<{
	message: string;
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RatedPokemon {
	pokemon: Pokemon;
	rating: Rating;
}

export interface SelectedPair {
	left: RatedPokemon;
	right: RatedPokemon;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How many of the most recent matchups to consider when applying
 * the "recently seen" cooldown penalty.
 */
const RECENT_MATCHUP_WINDOW = 30;

/**
 * The weight multiplier applied to pairs that have been recently shown.
 * Setting this to 0 completely blocks recently-seen pairs;
 * a small epsilon keeps them as fallback if the pool is tiny.
 */
const RECENT_PAIR_WEIGHT_FACTOR = 0.05;

/**
 * How much the ordinal proximity bonus contributes relative to the
 * uncertainty bonus. Pairing Pokémon that are close in rank maximises
 * the *information gain* of the comparison (outcome is less predictable).
 */
const PROXIMITY_WEIGHT = 0.4;

/**
 * How much the combined sigma score contributes.
 */
const UNCERTAINTY_WEIGHT = 0.6;

/**
 * Number of candidate pairs to sample from the pool before
 * picking the highest-scoring one. Keeps O(n²) concerns away.
 */
const CANDIDATE_SAMPLE_SIZE = 40;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalises an array of non-negative numbers to sum to 1.
 * If all values are zero, returns a uniform distribution.
 */
const normalise = (weights: number[]): number[] => {
	const total = weights.reduce((a, b) => a + b, 0);
	if (total === 0) return weights.map(() => 1 / weights.length);
	return weights.map((w) => w / total);
};

/**
 * Weighted random selection — picks one index from `weights`
 * (which must already be normalised or at least sum > 0).
 */
const weightedRandom = (weights: number[]): number => {
	const r = Math.random();
	let cumulative = 0;
	for (let i = 0; i < weights.length; i++) {
		cumulative += weights[i];
		if (r <= cumulative) return i;
	}
	return weights.length - 1;
};

/**
 * Computes a per-Pokémon "uncertainty score" in [0, 1].
 * Higher sigma → higher score → more likely to be selected.
 */
const uncertaintyScore = (r: Rating): number => Math.max(0, Math.min(1, r.sigma / INITIAL_SIGMA));

/**
 * Builds a Set of recently-seen pair keys from a list of matchup records.
 * The key is canonical: `min(a,b)-max(a,b)` so order doesn't matter.
 */
const buildRecentPairSet = (
	recentMatchups: Array<{ winnerId: number; loserId: number }>,
): Set<string> => {
	const seen = new Set<string>();
	for (const m of recentMatchups) {
		const a = Math.min(m.winnerId, m.loserId);
		const b = Math.max(m.winnerId, m.loserId);
		seen.add(`${a}-${b}`);
	}
	return seen;
};

const pairKey = (a: number, b: number): string => {
	const lo = Math.min(a, b);
	const hi = Math.max(a, b);
	return `${lo}-${hi}`;
};

// ---------------------------------------------------------------------------
// Core selection algorithm
// ---------------------------------------------------------------------------

/**
 * Selects the next pair of Pokémon to show the user.
 *
 * Algorithm:
 * 1. Compute a per-Pokémon weight based on sigma (uncertainty).
 * 2. Sample `CANDIDATE_SAMPLE_SIZE` candidate pairs by drawing two
 *    Pokémon independently from the uncertainty-weighted distribution,
 *    making sure they're not the same Pokémon.
 * 3. Score each candidate pair:
 *    - Uncertainty component: average sigma of the two Pokémon (normalised)
 *    - Proximity component: how close their ordinals are (inverted distance,
 *      normalised). Close ordinals = more informative comparison.
 *    - Apply a heavy penalty if this pair appeared in recent matchups.
 * 4. Return the highest-scoring candidate pair.
 *
 * This is O(CANDIDATE_SAMPLE_SIZE) rather than O(n²), so it stays fast
 * even with 400+ Pokémon.
 */
export const selectNextPair = (
	pool: RatedPokemon[],
	recentMatchups: Array<{ winnerId: number; loserId: number }>,
): Effect.Effect<SelectedPair, PairSelectionError> =>
	Effect.gen(function* () {
		if (pool.length < 2) {
			return yield* Effect.fail(
				new PairSelectionError({
					message: `Need at least 2 Pokémon in the pool, got ${pool.length}`,
				}),
			);
		}

		const recent = recentMatchups.slice(-RECENT_MATCHUP_WINDOW);
		const recentPairs = buildRecentPairSet(recent);

		// Per-pokemon uncertainty weights for sampling
		const rawWeights = pool.map((rp) => uncertaintyScore(rp.rating));
		const weights = normalise(rawWeights);

		// Ordinal range for normalising proximity scores
		const ordinals = pool.map((rp) => rp.rating.ordinal);
		const ordinalRange = Math.max(...ordinals) - Math.min(...ordinals);
		const safeRange = ordinalRange === 0 ? 1 : ordinalRange;

		// Sample candidate pairs
		const candidates: Array<{
			left: RatedPokemon;
			right: RatedPokemon;
			score: number;
		}> = [];

		// Guard against tiny pools — limit attempts
		const maxAttempts = CANDIDATE_SAMPLE_SIZE * 4;
		let attempts = 0;

		while (candidates.length < CANDIDATE_SAMPLE_SIZE && attempts < maxAttempts) {
			attempts++;

			const idxA = weightedRandom(weights);
			const idxB = weightedRandom(weights);

			// Ensure distinct Pokémon
			if (idxA === idxB) continue;

			const left = pool[idxA];
			const right = pool[idxB];

			// Uncertainty component: average sigma of the pair, normalised to [0,1]
			const uncScore = (uncertaintyScore(left.rating) + uncertaintyScore(right.rating)) / 2;

			// Proximity component: how similar their ordinals are.
			// Distance of 0 → proximity of 1 (most informative).
			const ordinalDist = Math.abs(left.rating.ordinal - right.rating.ordinal) / safeRange;
			const proxScore = 1 - ordinalDist;

			// Combined score
			let score = UNCERTAINTY_WEIGHT * uncScore + PROXIMITY_WEIGHT * proxScore;

			// Apply recent-pair penalty
			const key = pairKey(left.pokemon.id, right.pokemon.id);
			if (recentPairs.has(key)) {
				score *= RECENT_PAIR_WEIGHT_FACTOR;
			}

			candidates.push({ left, right, score });
		}

		if (candidates.length === 0) {
			return yield* Effect.fail(
				new PairSelectionError({
					message: "Could not generate any candidate pairs from the pool",
				}),
			);
		}

		// Pick the highest-scoring candidate
		const best = Arr.reduce(candidates.slice(1), candidates[0], (best, candidate) =>
			candidate.score > best.score ? candidate : best,
		);

		return Option.some(best).pipe(
			Option.map(({ left, right }) => ({ left, right })),
			Option.getOrElse(() => {
				const [left, right] = candidates;
				return { left: left.left, right: right.left };
			}),
		);
	});
