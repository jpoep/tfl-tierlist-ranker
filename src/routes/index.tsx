import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ComparisonView } from "@/components/ComparisonView";
import { Faq } from "@/components/Faq";
import { TierlistPreview } from "@/components/TierlistPreview";
import { useNextPair } from "@/hooks/useNextPair";
import { usePokemon } from "@/hooks/usePokemon";
import { useTierlist } from "@/hooks/useTierlist";
import type { StrategyName } from "@/ranking/tiers";

export const Route = createFileRoute("/")({
  component: VotePage,
});

function VotePage() {
  const [strategy, setStrategy] = useState<StrategyName>("fixedPercentile");

  const {
    data: pokemon,
    isLoading: pokemonLoading,
    isError: pokemonError,
  } = usePokemon();

  const pair = useNextPair(pokemon ?? []);
  const tierlistResult = useTierlist(pokemon ?? [], strategy);

  if (pokemonLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-white/40">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          <span className="text-sm">Pokédex wird geladen…</span>
        </div>
      </div>
    );
  }

  if (pokemonError || !pokemon) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm font-semibold text-red-400">
            Failed to load Pokédex
          </p>
          <p className="mt-1 text-xs text-red-400/60">
            Check your Supabase connection and make sure the database has been
            seeded.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
      {/* Left: voting panel */}
      <div className="flex flex-1 flex-col items-center gap-6">
        {pair === undefined && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          </div>
        )}

        {pair === null && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-sm text-white/30">
              Not enough Pokémon to compare.
            </p>
          </div>
        )}

        {pair && (
          <ComparisonView
            key={`${pair.left.pokemon.id}-${pair.right.pokemon.id}`}
            pair={pair}
          />
        )}

        <Faq />
      </div>

      {/* Right: live tierlist sidebar */}
      <aside className="w-full lg:w-80 xl:w-96">
        {tierlistResult ? (
          <TierlistPreview
            tiers={tierlistResult.tiers}
            confidence={tierlistResult.confidence}
            totalVotes={tierlistResult.totalVotes}
            strategy={strategy}
            onStrategyChange={setStrategy}
            compact
          />
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
            <p className="text-sm text-white/30">
              Gib ein paar Stimmen ab, um die Tierlist zu generieren!
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
