import { useEffect, useMemo, useRef, useState } from "react";
import { Effect } from "effect";
import { supabase } from "@/lib/supabase";
import type { RatingRow, MatchupRow } from "@/lib/db-types";
import { type SelectedPair, selectNextPair } from "@/ranking/pairSelection";
import type { Pokemon } from "@/types/pokemon";

const RECENT_MATCHUP_LIMIT = 30;

interface NextPairState {
  ratings: RatingRow[];
  recentMatchups: MatchupRow[];
  isLoading: boolean;
}

/**
 * Reactively computes the next pair of Pokémon to show the user.
 *
 * Subscribes to Supabase Realtime on `ratings` and `matchups`.
 * - On a ratings UPDATE: patches the changed row in local state.
 * - On a matchups INSERT: prepends the new row and trims to the recent window.
 *
 * Pair selection runs client-side on the in-memory ratings snapshot —
 * same algorithm as before, no round-trip needed.
 *
 * Returns:
 *   undefined — still loading initial data
 *   null      — pool too small to form a pair
 *   SelectedPair — ready to display
 *
 * @param pokemon - The full Pokémon list (static, from usePokemon)
 */
export const useNextPair = (
  pokemon: Pokemon[],
): SelectedPair | null | undefined => {
  const [state, setState] = useState<NextPairState>({
    ratings: [],
    recentMatchups: [],
    isLoading: true,
  });

  // Stable ref so Realtime callbacks can read the latest ratings map without
  // closing over stale state from the initial render.
  const ratingsRef = useRef<Map<number, RatingRow>>(new Map());

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

      setState({
        ratings: ratingsResult.data ?? [],
        recentMatchups: matchupsResult.data ?? [],
        isLoading: false,
      });
    };

    void fetchInitialData();

    // ---------------------------------------------------------------------
    // Realtime: ratings channel
    //
    // After a vote lands, the two updated rating rows are pushed here.
    // We do a surgical patch on the array — no full re-fetch needed.
    // ---------------------------------------------------------------------

    const ratingsChannel = supabase
      .channel("nextpair:ratings")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ratings" },
        (payload) => {
          const updated = payload.new as RatingRow;
          ratingsRef.current.set(updated.pokemon_id, updated);

          setState((prev) => ({
            ...prev,
            ratings: prev.ratings.map((r) =>
              r.pokemon_id === updated.pokemon_id ? updated : r,
            ),
          }));
        },
      )
      .subscribe();

    // ---------------------------------------------------------------------
    // Realtime: matchups channel
    //
    // On any INSERT (vote or skip), prepend the new row and trim the window
    // so we never hold more than RECENT_MATCHUP_LIMIT rows in memory.
    // ---------------------------------------------------------------------

    const matchupsChannel = supabase
      .channel("nextpair:matchups")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matchups" },
        (payload) => {
          const inserted = payload.new as MatchupRow;

          setState((prev) => ({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokemon]);

  // -------------------------------------------------------------------------
  // Pair selection (pure, memoised)
  // -------------------------------------------------------------------------

  const pair = useMemo<SelectedPair | null | undefined>(() => {
    if (state.isLoading) return undefined;
    if (pokemon.length < 2) return null;

    const ratingMap = new Map<number, RatingRow>(
      state.ratings.map((r) => [r.pokemon_id, r]),
    );

    const pool = pokemon.flatMap((p) => {
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

    // Map MatchupRow → the shape selectNextPair expects
    const recentMatchups = state.recentMatchups.map((m) => ({
      winnerId: m.winner_id,
      loserId: m.loser_id,
    }));

    const result = Effect.runSyncExit(selectNextPair(pool, recentMatchups));

    if (result._tag === "Failure") {
      console.error("[useNextPair] pair selection failed:", result.cause);
      return null;
    }

    return result.value;
  }, [state, pokemon]);

  return pair;
};
