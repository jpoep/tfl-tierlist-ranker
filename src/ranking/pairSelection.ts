import { Array as Arr, Data, Effect, Option } from "effect";
import type { Pokemon } from "@/types/pokemon";
import type { Rating } from "@/types/rating";
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
 * Default ordinal bias used when no explicit value is passed to selectNextPair.
 *
 * Range: [0, 1]
 *   0.0 = pure uncertainty-driven sampling (original behaviour — no tier bias)
 *   1.0 = purely ordinal-proportional sampling (always picks top-ranked mons)
 *
 * At 0.35 the algorithm spends roughly 35% of its sampling budget on ordinal
 * rank and 65% on uncertainty. This keeps S/A mons in rotation even after their
 * sigma has shrunk, without completely starving C/D mons of votes.
 */
export const DEFAULT_ORDINAL_BIAS = 0.35;

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
 * Computes a per-Pokémon "ordinal score" in [0, 1] relative to the pool.
 * Higher ordinal (better rank) → score closer to 1.
 * Used to bias sampling towards higher-tier Pokémon when ORDINAL_BIAS > 0.
 */
const ordinalScore = (r: Rating, minOrdinal: number, range: number): number =>
	range === 0 ? 0.5 : Math.max(0, Math.min(1, (r.ordinal - minOrdinal) / range));

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
	ordinalBias: number = DEFAULT_ORDINAL_BIAS,
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

		// Ordinal range — used both for proximity scoring and ordinal-biased sampling
		const ordinals = pool.map((rp) => rp.rating.ordinal);
		const minOrdinal = Math.min(...ordinals);
		const ordinalRange = Math.max(...ordinals) - minOrdinal;
		const safeRange = ordinalRange === 0 ? 1 : ordinalRange;

		// Per-pokemon sampling weights: blend uncertainty and ordinal rank.
		// ordinalBias=0 → pure uncertainty (original behaviour).
		// ordinalBias=1 → purely prefer higher-ranked mons.
		const clampedBias = Math.max(0, Math.min(1, ordinalBias));
		const rawWeights = pool.map((rp) => {
			const uScore = uncertaintyScore(rp.rating);
			const oScore = ordinalScore(rp.rating, minOrdinal, ordinalRange);
			return (1 - clampedBias) * uScore + clampedBias * oScore;
		});
		const weights = normalise(rawWeights);

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
