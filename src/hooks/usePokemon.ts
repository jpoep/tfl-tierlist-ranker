import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { getAllPokemon } from "@/services/rankingService";
import type { Pokemon } from "@/types/pokemon";

export const pokemonQueryKey = ["pokemon"] as const;

/**
 * Fetches all Pokémon from Supabase, sorted by id.
 * Cached indefinitely — the Pokémon list never changes at runtime.
 *
 * This is the single source of truth for the pokemon list. Both useNextPair
 * and useTierlist receive the pokemon array as a prop from their call sites
 * rather than fetching it independently.
 */
export const usePokemon = () =>
	useQuery<Pokemon[], Error>({
		queryKey: pokemonQueryKey,
		queryFn: () =>
			Effect.runPromise(getAllPokemon().pipe(Effect.mapError((e) => new Error(e.message)))),
		staleTime: Infinity,
		gcTime: Infinity,
	});
