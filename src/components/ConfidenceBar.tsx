import type { TierlistConfidence } from "@/hooks/useTierlist";

interface ConfidenceBarProps {
	confidence: TierlistConfidence;
	totalVotes: number;
}

const formatVotesNeeded = (n: number): string => {
	if (n === 0) return "Target reached";
	if (n === 1) return "1 more vote needed";
	return `~${n.toLocaleString()} more votes needed`;
};

const confidenceLabel = (score: number): { label: string; colour: string } => {
	if (score >= 0.9) return { label: "High confidence", colour: "text-emerald-400" };
	if (score >= 0.7) return { label: "Good confidence", colour: "text-lime-400" };
	if (score >= 0.5) return { label: "Moderate confidence", colour: "text-yellow-400" };
	if (score >= 0.25) return { label: "Low confidence", colour: "text-orange-400" };
	return { label: "Very early data", colour: "text-red-400" };
};

const barColour = (score: number): string => {
	if (score >= 0.9) return "bg-emerald-400";
	if (score >= 0.7) return "bg-lime-400";
	if (score >= 0.5) return "bg-yellow-400";
	if (score >= 0.25) return "bg-orange-400";
	return "bg-red-400";
};

export const ConfidenceBar = ({ confidence, totalVotes }: ConfidenceBarProps) => {
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
						{totalVotes.toLocaleString()} vote{totalVotes !== 1 ? "s" : ""} cast
					</span>
				</div>
				<span className={`text-sm font-bold tabular-nums ${colour}`}>{pct}%</span>
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
					title={`Target: ${targetPct}%`}
				/>
			</div>

			{/* Footer row */}
			<div className="mt-2 flex items-center justify-between gap-2">
				<span className="text-xs text-white/30">{formatVotesNeeded(confidence.votesNeeded)}</span>
				<span className="text-xs text-white/20">target {targetPct}%</span>
			</div>
		</div>
	);
};
