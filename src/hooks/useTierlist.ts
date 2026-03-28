import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RatingRow, MatchupRow } from "@/lib/db-types";
import {
  estimateVotesNeeded,
  globalConfidence,
  perPokemonConfidence,
} from "@/ranking/openskill";
import {
  computeTierlist,
  type StrategyName,
  type TieredList,
} from "@/ranking/tiers";
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

const MIN_VOTES_FOR_DISPLAY = 20;
const TARGET_CONFIDENCE = 0.9;

// ---------------------------------------------------------------------------
// Internal state shape
// ---------------------------------------------------------------------------

interface TierlistState {
  pokemon: Pokemon[];
  ratings: RatingRow[];
  totalVotes: number;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Reactively computes the full tierlist and confidence metrics.
 *
 * Subscribes to Supabase Realtime on the `ratings` and `matchups` tables.
 * Any row change on either table triggers a re-fetch of only the changed
 * data, keeping bandwidth minimal.
 *
 * @param pokemon - The full Pokémon list from usePokemon (static, never changes)
 * @param strategy - Which tier assignment strategy to use (default: fixedPercentile)
 */
export const useTierlist = (
  pokemon: Pokemon[],
  strategy: StrategyName = "fixedPercentile",
): TierlistResult | undefined => {
  const [state, setState] = useState<TierlistState>({
    pokemon,
    ratings: [],
    totalVotes: 0,
    isLoading: true,
  });

  // Keep a ref to the latest ratings so Realtime callbacks can do
  // surgical updates without needing to close over stale state.
  // Keyed by pokemon_name (the unique text slug).
  const ratingsRef = useRef<Map<string, RatingRow>>(new Map());

  // -------------------------------------------------------------------------
  // Initial data fetch + Realtime subscriptions
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    // Fetch all ratings and the non-skipped vote count in parallel
    const fetchInitialData = async () => {
      const [ratingsResult, countResult] = await Promise.all([
        supabase.from("ratings").select("*"),
        supabase
          .from("matchups")
          .select("*", { count: "exact", head: true })
          .eq("skipped", false),
      ]);

      if (cancelled) return;

      if (ratingsResult.error) {
        console.error(
          "[useTierlist] failed to fetch ratings:",
          ratingsResult.error,
        );
        return;
      }

      const ratingsMap = new Map<string, RatingRow>(
        (ratingsResult.data ?? []).map((r) => [r.pokemon_name, r]),
      );
      ratingsRef.current = ratingsMap;

      setState({
        pokemon,
        ratings: ratingsResult.data ?? [],
        totalVotes: countResult.count ?? 0,
        isLoading: false,
      });
    };

    void fetchInitialData();

    // -----------------------------------------------------------------------
    // Realtime: ratings channel
    //
    // On any UPDATE to the ratings table, patch just the two changed rows
    // into local state without re-fetching everything.
    // -----------------------------------------------------------------------

    const ratingsChannel = supabase
      .channel("tierlist:ratings")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ratings" },
        (payload) => {
          const updated = payload.new as RatingRow;
          ratingsRef.current.set(updated.pokemon_name, updated);

          setState((prev) => {
            const next = prev.ratings.map((r) =>
              r.pokemon_name === updated.pokemon_name ? updated : r,
            );
            return { ...prev, ratings: next };
          });
        },
      )
      .subscribe();

    // -----------------------------------------------------------------------
    // Realtime: matchups channel
    //
    // On any INSERT to matchups, increment the vote counter if it's not a skip.
    // We don't need the full matchup row — just the count.
    // -----------------------------------------------------------------------

    const matchupsChannel = supabase
      .channel("tierlist:matchups")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matchups" },
        (payload) => {
          const row = payload.new as MatchupRow;
          if (!row.skipped) {
            setState((prev) => ({ ...prev, totalVotes: prev.totalVotes + 1 }));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(ratingsChannel);
      void supabase.removeChannel(matchupsChannel);
    };
    // Re-run only when the pokemon list identity changes (practically never).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokemon]);

  // -------------------------------------------------------------------------
  // Compute tierlist from current state (memoised)
  // -------------------------------------------------------------------------

  const result = useMemo<TierlistResult | undefined>(() => {
    if (state.isLoading) return undefined;
    if (state.pokemon.length === 0 || state.ratings.length === 0)
      return undefined;

    const ratingMap = new Map<string, RatingRow>(
      state.ratings.map((r) => [r.pokemon_name, r]),
    );

    const ratedPokemon = state.pokemon.flatMap((p) => {
      const row = ratingMap.get(p.name);
      if (!row) return [];
      return [
        {
          pokemon: p,
          rating: {
            pokemonName: row.pokemon_name,
            mu: row.mu,
            sigma: row.sigma,
            ordinal: row.ordinal,
            matchCount: row.match_count,
          },
        },
      ];
    });

    if (ratedPokemon.length === 0) return undefined;

    const tiers = computeTierlist(ratedPokemon, strategy);

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
      totalVotes: state.totalVotes,
      hasSufficientData: state.totalVotes >= MIN_VOTES_FOR_DISPLAY,
    };
  }, [state, strategy]);

  return result;
};

// ---------------------------------------------------------------------------
// Per-pokemon confidence helper (re-exported for use in tier UI)
// ---------------------------------------------------------------------------

export { perPokemonConfidence };
