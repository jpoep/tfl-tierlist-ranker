import type { Rating } from "@/db/schema";
import type { Pokemon } from "@/types/pokemon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TierLabel = "S" | "A" | "B" | "C" | "D";

export interface TierAssignment {
	pokemon: Pokemon;
	rating: Rating;
	tier: TierLabel;
}

export interface TieredList {
	S: TierAssignment[];
	A: TierAssignment[];
	B: TierAssignment[];
	C: TierAssignment[];
	D: TierAssignment[];
}

export interface RatedPokemon {
	pokemon: Pokemon;
	rating: Rating;
}

/**
 * A tier strategy takes a list of rated Pokémon (sorted descending by ordinal)
 * and returns tier assignments for each one.
 */
export type TierStrategy = (sorted: RatedPokemon[]) => TierAssignment[];

// ---------------------------------------------------------------------------
// Strategy: Fixed percentile cutoffs
// ---------------------------------------------------------------------------

/**
 * Tier boundaries as cumulative top-percentages.
 * e.g. S = top 5%, A = next 15% (top 20%), etc.
 *
 * These are the defaults — designed for a draft league where S tier is rare.
 */
export const DEFAULT_PERCENTILE_CUTOFFS: Record<TierLabel, number> = {
	S: 0.05,
	A: 0.2,
	B: 0.5,
	C: 0.8,
	D: 1.0,
};

/**
 * Assigns tiers based on fixed cumulative percentile cutoffs.
 * The list is assumed to already be sorted descending by ordinal.
 */
export const fixedPercentileTiers =
	(cutoffs = DEFAULT_PERCENTILE_CUTOFFS): TierStrategy =>
	(sorted) => {
		const n = sorted.length;
		if (n === 0) return [];

		const tierOrder: TierLabel[] = ["S", "A", "B", "C", "D"];

		return sorted.map(({ pokemon, rating }, i) => {
			const percentile = (i + 1) / n;
			const tier = tierOrder.find((t) => percentile <= cutoffs[t]) ?? "D";
			return { pokemon, rating, tier };
		});
	};

// ---------------------------------------------------------------------------
// Strategy: Standard deviation bands
// ---------------------------------------------------------------------------

/**
 * Assigns tiers based on standard deviation bands around the mean ordinal.
 *
 * Bands (from top):
 *   S: ordinal > mean + 1.5σ
 *   A: ordinal > mean + 0.5σ
 *   B: ordinal > mean - 0.5σ
 *   C: ordinal > mean - 1.5σ
 *   D: everything else
 *
 * This produces organically-sized tiers that reflect the true score distribution.
 * Tier sizes will vary — that's intentional.
 */
export const stdDevBandTiers: TierStrategy = (sorted) => {
	if (sorted.length === 0) return [];

	const ordinals = sorted.map((rp) => rp.rating.ordinal);
	const mean = ordinals.reduce((a, b) => a + b, 0) / ordinals.length;
	const variance = ordinals.reduce((acc, o) => acc + (o - mean) ** 2, 0) / ordinals.length;
	const sigma = Math.sqrt(variance);

	return sorted.map(({ pokemon, rating }) => {
		const o = rating.ordinal;
		let tier: TierLabel;

		if (o > mean + 1.5 * sigma) tier = "S";
		else if (o > mean + 0.5 * sigma) tier = "A";
		else if (o > mean - 0.5 * sigma) tier = "B";
		else if (o > mean - 1.5 * sigma) tier = "C";
		else tier = "D";

		return { pokemon, rating, tier };
	});
};

// ---------------------------------------------------------------------------
// Strategy: K-means clustering (k=5)
// ---------------------------------------------------------------------------

/**
 * Assigns tiers by running 1D k-means clustering (k=5) on ordinal scores.
 * The cluster with the highest centroid = S, lowest = D.
 *
 * This finds natural groupings in the score data rather than imposing
 * fixed boundaries. Boundaries will shift as more votes come in.
 *
 * Uses Lloyd's algorithm with up to 100 iterations.
 */
export const kmeansTiers: TierStrategy = (sorted) => {
	if (sorted.length === 0) return [];

	const tierOrder: TierLabel[] = ["S", "A", "B", "C", "D"];
	const k = 5;
	const ordinals = sorted.map((rp) => rp.rating.ordinal);
	const min = Math.min(...ordinals);
	const max = Math.max(...ordinals);

	// Initialise centroids evenly spaced across the ordinal range
	let centroids: number[] = Array.from({ length: k }, (_, i) => min + (max - min) * (i / (k - 1)));

	let assignments: number[] = new Array(ordinals.length).fill(0);
	const MAX_ITER = 100;

	for (let iter = 0; iter < MAX_ITER; iter++) {
		// Assignment step
		const newAssignments = ordinals.map((o) => {
			let bestCluster = 0;
			let bestDist = Infinity;
			for (let c = 0; c < k; c++) {
				const dist = Math.abs(o - centroids[c]);
				if (dist < bestDist) {
					bestDist = dist;
					bestCluster = c;
				}
			}
			return bestCluster;
		});

		// Check for convergence
		const changed = newAssignments.some((a, i) => a !== assignments[i]);
		assignments = newAssignments;
		if (!changed) break;

		// Update step: recompute centroids
		centroids = centroids.map((_, c) => {
			const members = ordinals.filter((_, i) => assignments[i] === c);
			if (members.length === 0) return centroids[c];
			return members.reduce((a, b) => a + b, 0) / members.length;
		});
	}

	// Sort cluster indices by centroid value descending → S=0, A=1, ..., D=4
	const clusterRank = centroids
		.map((centroid, clusterIdx) => ({ centroid, clusterIdx }))
		.sort((a, b) => b.centroid - a.centroid)
		.map(({ clusterIdx }, rank) => ({ clusterIdx, rank }));

	const clusterToRank = new Map(clusterRank.map(({ clusterIdx, rank }) => [clusterIdx, rank]));

	return sorted.map(({ pokemon, rating }, i) => {
		const clusterIdx = assignments[i];
		const rank = clusterToRank.get(clusterIdx) ?? 4;
		const tier = tierOrder[Math.min(rank, tierOrder.length - 1)];
		return { pokemon, rating, tier };
	});
};

// ---------------------------------------------------------------------------
// Registry + active strategy
// ---------------------------------------------------------------------------

export type StrategyName = "fixedPercentile" | "stdDev" | "kmeans";

export const TIER_STRATEGIES: Record<StrategyName, TierStrategy> = {
	fixedPercentile: fixedPercentileTiers(),
	stdDev: stdDevBandTiers,
	kmeans: kmeansTiers,
};

export const DEFAULT_STRATEGY: StrategyName = "fixedPercentile";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Computes the full tiered list from a flat array of rated Pokémon.
 * Sorts by ordinal descending first, then applies the chosen strategy.
 */
export const computeTierlist = (
	ratedPokemon: RatedPokemon[],
	strategy: StrategyName = DEFAULT_STRATEGY,
): TieredList => {
	const sorted = [...ratedPokemon].sort((a, b) => b.rating.ordinal - a.rating.ordinal);

	const strategyFn = TIER_STRATEGIES[strategy];
	const assignments = strategyFn(sorted);

	const result: TieredList = { S: [], A: [], B: [], C: [], D: [] };
	for (const assignment of assignments) {
		result[assignment.tier].push(assignment);
	}

	return result;
};
