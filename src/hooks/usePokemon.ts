import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { getAllPokemon } from "@/services/rankingService";
import type { Pokemon } from "@/types/pokemon";

export const pokemonQueryKey = ["pokemon"] as const;

/**
 * Fetches all Pokémon from Dexie (seeded from the static asset).
 * Cached indefinitely — the Pokémon list never changes at runtime.
 */
export const usePokemon = () =>
	useQuery<Pokemon[], Error>({
		queryKey: pokemonQueryKey,
		queryFn: () =>
			Effect.runPromise(getAllPokemon().pipe(Effect.mapError((e) => new Error(e.message)))),
		staleTime: Infinity,
		gcTime: Infinity,
	});
