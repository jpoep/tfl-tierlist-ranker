import { Effect } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MatchupRow, RatingRow } from "@/lib/db-types";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_ORDINAL_BIAS,
  type SelectedPair,
  selectNextPair,
} from "@/ranking/pairSelection";
import type { Pokemon } from "@/types/pokemon";

const RECENT_MATCHUP_LIMIT = 30;

interface LiveState {
  ratings: RatingRow[];
  recentMatchups: MatchupRow[];
  isLoading: boolean;
}

export interface NextPairHandle {
  /**
   * The pair currently being shown to the user.
   *
   * undefined — initial data still loading
   * null      — pool too small to form a pair
   * SelectedPair — ready to display
   */
  pair: SelectedPair | null | undefined;

  /**
   * Call this after the local user has voted or skipped.
   * Snapshots the current live state and recomputes the next pair from it,
   * then locks that new pair in place until `advance` is called again.
   */
  advance: () => void;
}

/**
 * Manages the pair of Pokémon shown to the user for voting.
 *
 * The *displayed* pair is intentionally stable — it does NOT change when
 * other users vote and Supabase Realtime pushes rating/matchup updates.
 * Realtime events only update the internal live-state snapshot so that
 * when the local user calls `advance()`, the next pair is computed from
 * the most up-to-date data.
 *
 * Flow:
 *   1. On mount: fetch initial ratings + recent matchups, compute first pair,
 *      lock it in as `currentPair`.
 *   2. Realtime events: patch `liveState` in place — `currentPair` unchanged.
 *   3. User votes/skips → calls `advance()` → snapshot live state → recompute
 *      → new pair locked in.
 *
 * @param pokemon - The full Pokémon list (static, from usePokemon)
 * @param ordinalBias - How strongly to bias pair selection towards higher-ranked Pokémon [0, 1]
 * @param finalEvosOnly - When true, only final-evolution Pokémon are included in the pool
 */
export const useNextPair = (
  pokemon: Pokemon[],
  ordinalBias: number = DEFAULT_ORDINAL_BIAS,
  finalEvosOnly = false,
): NextPairHandle => {
  // -------------------------------------------------------------------------
  // Live state — updated by Realtime, NOT directly rendered
  // -------------------------------------------------------------------------
  const [liveState, setLiveState] = useState<LiveState>({
    ratings: [],
    recentMatchups: [],
    isLoading: true,
  });

  // Stable ref so Realtime callbacks always see the latest ratings without
  // closing over a stale snapshot from the initial render.
  const ratingsRef = useRef<Map<number, RatingRow>>(new Map());

  // -------------------------------------------------------------------------
  // Locked pair — only changes when advance() is called
  // -------------------------------------------------------------------------

  // The pair we actually show. Derived once per advance() call (or on initial
  // load) and then frozen until the next advance.
  const [currentPair, setCurrentPair] = useState<
    SelectedPair | null | undefined
  >(undefined);

  // Keep a ref to liveState so `advance` can read it synchronously without
  // needing to be recreated every render.
  const liveStateRef = useRef<LiveState>(liveState);
  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  // -------------------------------------------------------------------------
  // Pair computation helper (pure)
  // -------------------------------------------------------------------------
  const computePair = useCallback(
    (
      state: LiveState,
      bias: number = ordinalBias,
    ): SelectedPair | null | undefined => {
      if (state.isLoading) return undefined;
      if (pokemon.length < 2) return null;

      const ratingMap = new Map<number, RatingRow>(
        state.ratings.map((r) => [r.pokemon_id, r]),
      );

      const filteredPokemon = finalEvosOnly
        ? pokemon.filter((p) => p.isFinalEvo)
        : pokemon;

      const pool = filteredPokemon.flatMap((p) => {
        const row = ratingMap.get(p.id);
        if (!row) return [];
        return [
          {
            pokemon: p,
            rating: {
              pokemonId: row.pokemon_id,
              mu: row.mu,
              sigma: row.sigma,
              ordinal: row.ordinal,
              matchCount: row.match_count,
            },
          },
        ];
      });

      if (pool.length < 2) return null;

      const recentMatchups = state.recentMatchups.map((m) => ({
        winnerId: m.winner_id,
        loserId: m.loser_id,
      }));

      const result = Effect.runSyncExit(
        selectNextPair(pool, recentMatchups, bias),
      );

      if (result._tag === "Failure") {
        console.error("[useNextPair] pair selection failed:", result.cause);
        return null;
      }

      return result.value;
    },
    [pokemon, ordinalBias, finalEvosOnly],
  );

  // -------------------------------------------------------------------------
  // Initial fetch + Realtime subscriptions
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const fetchInitialData = async () => {
      const [ratingsResult, matchupsResult] = await Promise.all([
        supabase.from("ratings").select("*"),
        supabase
          .from("matchups")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(RECENT_MATCHUP_LIMIT),
      ]);

      if (cancelled) return;

      if (ratingsResult.error) {
        console.error(
          "[useNextPair] failed to fetch ratings:",
          ratingsResult.error,
        );
        return;
      }
      if (matchupsResult.error) {
        console.error(
          "[useNextPair] failed to fetch matchups:",
          matchupsResult.error,
        );
        return;
      }

      const ratingsMap = new Map<number, RatingRow>(
        (ratingsResult.data ?? []).map((r) => [r.pokemon_id, r]),
      );
      ratingsRef.current = ratingsMap;

      const initialState: LiveState = {
        ratings: ratingsResult.data ?? [],
        recentMatchups: matchupsResult.data ?? [],
        isLoading: false,
      };

      setLiveState(initialState);

      // Lock in the very first pair immediately after the initial fetch.
      // We set it directly here rather than relying on advanceTick so there's
      // no extra render cycle between "data ready" and "pair shown".
      setCurrentPair(computePair(initialState));
    };

    void fetchInitialData();

    // -----------------------------------------------------------------------
    // Realtime: ratings channel
    //
    // Patches the live snapshot only — does NOT touch currentPair.
    // -----------------------------------------------------------------------
    const ratingsChannel = supabase
      .channel("nextpair:ratings")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ratings" },
        (payload) => {
          const updated = payload.new as RatingRow;
          ratingsRef.current.set(updated.pokemon_id, updated);

          setLiveState((prev) => ({
            ...prev,
            ratings: prev.ratings.map((r) =>
              r.pokemon_id === updated.pokemon_id ? updated : r,
            ),
          }));
        },
      )
      .subscribe();

    // -----------------------------------------------------------------------
    // Realtime: matchups channel
    //
    // Prepends the new row and trims the window — does NOT touch currentPair.
    // -----------------------------------------------------------------------
    const matchupsChannel = supabase
      .channel("nextpair:matchups")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matchups" },
        (payload) => {
          const inserted = payload.new as MatchupRow;

          setLiveState((prev) => ({
            ...prev,
            recentMatchups: [inserted, ...prev.recentMatchups].slice(
              0,
              RECENT_MATCHUP_LIMIT,
            ),
          }));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(ratingsChannel);
      void supabase.removeChannel(matchupsChannel);
    };
    // Re-subscribe only if the pokemon list identity changes (practically never).
    // ordinalBias and finalEvosOnly are intentionally excluded: they don't affect
    // the Realtime subscriptions or the initial fetch — only computePair consumes
    // them, and the separate "recompute on settings change" effect below handles that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokemon]);

  // -------------------------------------------------------------------------
  // Advance — called by the consumer after a local vote/skip
  // -------------------------------------------------------------------------
  const advance = useCallback(() => {
    // Snapshot the latest live state synchronously and derive the next pair.
    // This runs outside of React's render cycle so the new pair is ready
    // (or computed) before the component re-renders.
    setCurrentPair(computePair(liveStateRef.current, ordinalBias));
  }, [computePair, ordinalBias]);

  // -------------------------------------------------------------------------
  // If pokemon list changes identity (e.g. data refetch), recompute from
  // the current live snapshot so we don't show a stale pair with bad IDs.
  // -------------------------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — recompute when pokemon list or bias changes
  useEffect(() => {
    if (!liveStateRef.current.isLoading) {
      setCurrentPair(computePair(liveStateRef.current, ordinalBias));
    }
  }, [pokemon, computePair, ordinalBias, finalEvosOnly]);

  return useMemo(
    () => ({ pair: currentPair, advance }),
    [currentPair, advance],
  );
};
