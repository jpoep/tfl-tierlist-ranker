import type { TierlistConfidence } from "@/hooks/useTierlist";

interface ConfidenceBarProps {
  confidence: TierlistConfidence;
  totalVotes: number;
}

const formatVotesNeeded = (n: number): string => {
  if (n === 0) return "Ziel erreicht";
  if (n === 1) return "Noch eine Stimme nötig";
  return `~${n.toLocaleString()} weitere Stimmen nötig`;
};

const confidenceLabel = (score: number): { label: string; colour: string } => {
  if (score >= 0.9)
    return { label: "Tierlist ist würdig", colour: "text-emerald-400" };
  if (score >= 0.7)
    return { label: "Hohe Confidence", colour: "text-lime-400" };
  if (score >= 0.5)
    return { label: "Mittlere Confidence", colour: "text-yellow-400" };
  if (score >= 0.25)
    return { label: "Wenig Confidence", colour: "text-orange-400" };
  return { label: "Sehr frühe Daten", colour: "text-red-400" };
};

const barColour = (score: number): string => {
  if (score >= 0.9) return "bg-emerald-400";
  if (score >= 0.7) return "bg-lime-400";
  if (score >= 0.5) return "bg-yellow-400";
  if (score >= 0.25) return "bg-orange-400";
  return "bg-red-400";
};

export const ConfidenceBar = ({
  confidence,
  totalVotes,
}: ConfidenceBarProps) => {
  const pct = Math.round(confidence.score * 100);
  const { label, colour } = confidenceLabel(confidence.score);
  const targetPct = Math.round(confidence.targetConfidence * 100);

  return (
    <div className="w-full rounded-xl border border-white/10 bg-white/5 p-4">
      {/* Header row */}
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-semibold ${colour}`}>{label}</span>
          <span className="text-xs text-white/30">
            {totalVotes.toLocaleString()} Stimme{totalVotes !== 1 ? "n" : ""}{" "}
            abgegeben
          </span>
        </div>
        <span className={`text-sm font-bold tabular-nums ${colour}`}>
          {pct}%
        </span>
      </div>

      {/* Bar track */}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        {/* Filled portion */}
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${barColour(confidence.score)}`}
          style={{ width: `${pct}%` }}
        />
        {/* Target marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white/30"
          style={{ left: `${targetPct}%` }}
          title={`Ziel: ${targetPct}%`}
        />
      </div>

      {/* Footer row */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-white/30">
          {formatVotesNeeded(confidence.votesNeeded)}
        </span>
        <span className="text-xs text-white/20">Ziel {targetPct}%</span>
      </div>
    </div>
  );
};
