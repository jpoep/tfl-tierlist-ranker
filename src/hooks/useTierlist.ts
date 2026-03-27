import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "@/db";
import type { Rating } from "@/db/schema";
import { estimateVotesNeeded, globalConfidence, perPokemonConfidence } from "@/ranking/openskill";
import { computeTierlist, type StrategyName, type TieredList } from "@/ranking/tiers";
import type { Pokemon } from "@/types/pokemon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TierlistConfidence {
	/** Global confidence score in [0, 1] */
	score: number;
	/** Estimated number of additional votes to reach the target confidence */
	votesNeeded: number;
	/** The target confidence threshold used for estimation */
	targetConfidence: number;
}

export interface TierlistResult {
	tiers: TieredList;
	confidence: TierlistConfidence;
	/** Total number of non-skipped votes recorded */
	totalVotes: number;
	/** Whether the tierlist has enough data to be considered meaningful */
	hasSufficientData: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum number of votes before we consider the tierlist meaningful enough
 * to display with full confidence UI.
 */
const MIN_VOTES_FOR_DISPLAY = 20;

/**
 * The confidence threshold we aim for — used for "votes needed" estimation.
 */
const TARGET_CONFIDENCE = 0.9;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Reactively computes the full tierlist and confidence metrics.
 *
 * Re-runs automatically whenever ratings or matchups change in Dexie.
 *
 * @param strategy - Which tier assignment strategy to use (default: fixedPercentile)
 */
export const useTierlist = (
	strategy: StrategyName = "fixedPercentile",
): TierlistResult | undefined => {
	const data = useLiveQuery(async () => {
		const [allPokemon, allRatings, totalVotes] = await Promise.all([
			db.pokemon.toArray(),
			db.ratings.toArray(),
			db.matchups.filter((m) => !m.skipped).count(),
		]);

		return { allPokemon, allRatings, totalVotes };
	});

	const result = useMemo(() => {
		if (!data) return undefined;

		const { allPokemon, allRatings, totalVotes } = data;

		if (allPokemon.length === 0 || allRatings.length === 0) {
			return undefined;
		}

		// Build a map for O(1) rating lookups
		const ratingMap = new Map<number, Rating>(allRatings.map((r) => [r.pokemonId, r]));

		// Join pokemon with their ratings — skip any with missing ratings
		const ratedPokemon = allPokemon.flatMap((pokemon: Pokemon) => {
			const rating = ratingMap.get(pokemon.id);
			if (!rating) return [];
			return [{ pokemon, rating }];
		});

		if (ratedPokemon.length === 0) return undefined;

		// Compute the tiered list using the chosen strategy
		const tiers = computeTierlist(ratedPokemon, strategy);

		// Compute confidence metrics
		const ratingsOnly = ratedPokemon.map((rp) => rp.rating);
		const confidenceScore = globalConfidence(ratingsOnly);
		const votesNeeded = estimateVotesNeeded(ratingsOnly, TARGET_CONFIDENCE);

		const confidence: TierlistConfidence = {
			score: confidenceScore,
			votesNeeded,
			targetConfidence: TARGET_CONFIDENCE,
		};

		return {
			tiers,
			confidence,
			totalVotes,
			hasSufficientData: totalVotes >= MIN_VOTES_FOR_DISPLAY,
		};
	}, [data, strategy]);

	return result;
};

// ---------------------------------------------------------------------------
// Per-pokemon confidence helper (re-exported for use in tier UI)
// ---------------------------------------------------------------------------

export { perPokemonConfidence };
