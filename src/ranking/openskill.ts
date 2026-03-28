import { Data, Effect } from "effect";
import { type Rating as OSRating, ordinal, rate, rating } from "openskill";
import type { Rating } from "@/types/rating";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RankingError extends Data.TaggedError("RankingError")<{
  message: string;
  cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default OpenSkill parameters for the bradleyTerryFull model.
 * mu=25, sigma=25/3 are the standard Weng-Lin defaults.
 */
export const INITIAL_MU = 25;
export const INITIAL_SIGMA = 25 / 3;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh OpenSkill rating for a newly seeded Pokémon.
 */
export const createInitialRating = (pokemonId: number): Rating => {
  const r = rating({ mu: INITIAL_MU, sigma: INITIAL_SIGMA });
  return {
    pokemonId,
    mu: r.mu,
    sigma: r.sigma,
    ordinal: ordinal(r),
    matchCount: 0,
  };
};

/**
 * Converts a stored `Rating` row back into an OpenSkill `Rating` object.
 */
const toOSRating = (r: Rating): OSRating =>
  rating({ mu: r.mu, sigma: r.sigma });

/**
 * Converts an OpenSkill rating back to a storable `Rating` row,
 * preserving the pokemonId and incrementing matchCount.
 */
const fromOSRating = (r: OSRating, existing: Rating): Rating => ({
  pokemonId: existing.pokemonId,
  mu: r.mu,
  sigma: r.sigma,
  ordinal: ordinal(r),
  matchCount: existing.matchCount + 1,
});

// ---------------------------------------------------------------------------
// Effect-based rating update
// ---------------------------------------------------------------------------

export interface MatchResult {
  updatedWinner: Rating;
  updatedLoser: Rating;
}

/**
 * Applies a single pairwise match result using the bradleyTerryFull model.
 * Winner is treated as rank 1, loser as rank 2.
 *
 * Returns an Effect that yields the updated Rating rows for both participants,
 * or fails with a RankingError if the computation throws.
 */
export const applyMatchResult = (
  winner: Rating,
  loser: Rating,
): Effect.Effect<MatchResult, RankingError> =>
  Effect.try({
    try: () => {
      // openskill `rate` takes an array of teams, each team is an array of ratings.
      // For 1v1: [[winner], [loser]] where rank 1 = first team wins.
      const [[updatedWinnerOS], [updatedLoserOS]] = rate(
        [[toOSRating(winner)], [toOSRating(loser)]],
        { rank: [1, 2] },
      );

      return {
        updatedWinner: fromOSRating(updatedWinnerOS, winner),
        updatedLoser: fromOSRating(updatedLoserOS, loser),
      };
    },
    catch: (cause) =>
      new RankingError({
        message: "OpenSkill rate() threw an unexpected error",
        cause,
      }),
  });

// ---------------------------------------------------------------------------
// Confidence / uncertainty helpers
// ---------------------------------------------------------------------------

/**
 * Per-Pokémon confidence: how much of the initial uncertainty has been resolved.
 * Returns a value in [0, 1] where 1 = fully confident (sigma → 0).
 */
export const perPokemonConfidence = (r: Rating): number =>
  Math.max(0, Math.min(1, 1 - r.sigma / INITIAL_SIGMA));

/**
 * Given all ratings, returns a global confidence score in [0, 1].
 *
 * Pokémon near tier boundaries are weighted more heavily because their
 * relative ordering matters most for the final tierlist quality.
 *
 * Strategy:
 * 1. Sort by ordinal
 * 2. Identify boundary positions based on fixed percentile cutoffs
 * 3. Weight Pokémon within ±5% of a boundary at 2×, all others at 1×
 */
export const globalConfidence = (ratings: Rating[]): number => {
  if (ratings.length === 0) return 0;

  const sorted = [...ratings].sort((a, b) => b.ordinal - a.ordinal);
  const n = sorted.length;

  // Fixed percentile cumulative boundaries (S|A|B|C|D)
  const boundaries = [0.05, 0.2, 0.5, 0.8];
  const boundaryIndices = new Set(boundaries.map((p) => Math.round(p * n)));

  let totalWeight = 0;
  let weightedConfidence = 0;

  sorted.forEach((r, i) => {
    const isNearBoundary = [...boundaryIndices].some(
      (bi) => Math.abs(i - bi) <= Math.max(1, Math.round(0.05 * n)),
    );
    const weight = isNearBoundary ? 2 : 1;
    const conf = perPokemonConfidence(r);

    totalWeight += weight;
    weightedConfidence += weight * conf;
  });

  return totalWeight > 0 ? weightedConfidence / totalWeight : 0;
};

/**
 * Estimates how many more votes are needed to reach `targetConfidence`.
 *
 * Derivation: each vote reduces sigma by roughly a fixed fraction.
 * We estimate that fraction from the average sigma reduction per matchCount,
 * then project forward.
 *
 * Falls back to a rough heuristic if there isn't enough data yet.
 */
export const estimateVotesNeeded = (
  ratings: Rating[],
  targetConfidence = 0.9,
): number => {
  const current = globalConfidence(ratings);
  if (current >= targetConfidence) return 0;

  // Average sigma across all pokemon
  const avgSigma =
    ratings.reduce((acc, r) => acc + r.sigma, 0) / ratings.length;

  // Sigma at target confidence: sigma_target = INITIAL_SIGMA * (1 - target)
  const targetSigma = INITIAL_SIGMA * (1 - targetConfidence);

  if (avgSigma <= targetSigma) return 0;

  // Estimate sigma reduction per match.
  // If we have actual data, derive from average matchCount vs sigma drop.
  const rated = ratings.filter((r) => r.matchCount > 0);

  let sigmaReductionPerMatch: number;

  if (rated.length > 0) {
    // Empirical estimate: average (sigmaDropped / matchCount)
    const avgDrop =
      rated.reduce((acc, r) => {
        const dropped = INITIAL_SIGMA - r.sigma;
        return acc + dropped / r.matchCount;
      }, 0) / rated.length;

    sigmaReductionPerMatch = Math.max(avgDrop, 0.001);
  } else {
    // Cold-start heuristic: assume ~0.3 sigma reduction per match (empirical default)
    sigmaReductionPerMatch = 0.3;
  }

  // How many matches per pokemon to close the gap?
  const matchesPerPokemon = (avgSigma - targetSigma) / sigmaReductionPerMatch;

  // Each "vote" produces 2 rating updates (one per participant),
  // but each pokemon participates in roughly half the votes shown.
  // Total votes ≈ matchesPerPokemon * n / 2
  return Math.ceil((matchesPerPokemon * ratings.length) / 2);
};
