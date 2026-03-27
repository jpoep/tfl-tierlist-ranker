import { useLiveQuery } from "dexie-react-hooks";
import { Effect } from "effect";
import { useMemo } from "react";
import { db } from "@/db";
import { type SelectedPair, selectNextPair } from "@/ranking/pairSelection";

const RECENT_MATCHUP_LIMIT = 30;

/**
 * Reactively computes the next pair of Pokémon to show the user.
 *
 * Re-runs automatically whenever the `ratings` or `matchups` tables change
 * (i.e. after every vote or skip), thanks to Dexie's liveQuery.
 *
 * Returns `undefined` while loading, `null` if the pool is too small,
 * or a `SelectedPair` when ready.
 */
export const useNextPair = (): SelectedPair | null | undefined => {
	const data = useLiveQuery(async () => {
		const [allPokemon, allRatings, recentMatchups] = await Promise.all([
			db.pokemon.toArray(),
			db.ratings.toArray(),
			db.matchups.orderBy("timestamp").reverse().limit(RECENT_MATCHUP_LIMIT).toArray(),
		]);

		return { allPokemon, allRatings, recentMatchups };
	});

	const pair = useMemo(() => {
		if (!data) return undefined;

		const { allPokemon, allRatings, recentMatchups } = data;

		if (allPokemon.length < 2) return null;

		const ratingMap = new Map(allRatings.map((r) => [r.pokemonId, r]));

		const pool = allPokemon.flatMap((pokemon) => {
			const rating = ratingMap.get(pokemon.id);
			if (!rating) return [];
			return [{ pokemon, rating }];
		});

		if (pool.length < 2) return null;

		const result = Effect.runSyncExit(selectNextPair(pool, recentMatchups));

		if (result._tag === "Failure") {
			console.error("[useNextPair] pair selection failed:", result.cause);
			return null;
		}

		return result.value;
	}, [data]);

	return pair;
};
