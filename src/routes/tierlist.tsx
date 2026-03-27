import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { TierlistPreview } from "@/components/TierlistPreview";
import { usePokemon } from "@/hooks/usePokemon";
import { useTierlist } from "@/hooks/useTierlist";
import type { StrategyName } from "@/ranking/tiers";

export const Route = createFileRoute("/tierlist")({
  component: TierlistPage,
});

function TierlistPage() {
  const [strategy, setStrategy] = useState<StrategyName>("fixedPercentile");

  const { data: pokemon, isLoading: pokemonLoading } = usePokemon();
  const result = useTierlist(pokemon ?? [], strategy);

  if (pokemonLoading || !result) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          <p className="text-sm text-white/30">Loading tierlist…</p>
        </div>
      </div>
    );
  }

  const totalPokemon = Object.values(result.tiers).reduce(
    (acc, tier) => acc + tier.length,
    0,
  );

  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-black tracking-tight text-white">
          TFL Tierlist
        </h1>
        <p className="text-sm text-white/40">
          {totalPokemon} Pokémon ranked &middot;{" "}
          {result.totalVotes.toLocaleString()} votes cast
        </p>
      </div>

      {/* Confidence bar — full width on this page */}
      <ConfidenceBar
        confidence={result.confidence}
        totalVotes={result.totalVotes}
      />

      {!result.hasSufficientData && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
          <p className="text-sm text-yellow-400/80">
            <span className="font-semibold">Early data</span> — cast more votes
            for the tierlist to stabilise. Rankings will shift significantly
            until each Pokémon has been compared several times.
          </p>
        </div>
      )}

      {/* Full tierlist — not compact */}
      <TierlistPreview
        tiers={result.tiers}
        confidence={result.confidence}
        totalVotes={result.totalVotes}
        strategy={strategy}
        onStrategyChange={setStrategy}
        compact={false}
      />
    </div>
  );
}
