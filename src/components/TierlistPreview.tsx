import type { TierlistConfidence } from "@/hooks/useTierlist";
import type { StrategyName, TierAssignment, TieredList, TierLabel } from "@/ranking/tiers";
import { ConfidenceBar } from "./ConfidenceBar";

interface TierlistPreviewProps {
	tiers: TieredList;
	confidence: TierlistConfidence;
	totalVotes: number;
	strategy: StrategyName;
	onStrategyChange: (strategy: StrategyName) => void;
	/** When true, renders a compact scrollable version suitable for the sidebar */
	compact?: boolean;
}

const TIER_META: Record<TierLabel, { bg: string; border: string; text: string; label: string }> = {
	S: {
		bg: "bg-red-500/20",
		border: "border-red-500/40",
		text: "text-red-400",
		label: "S",
	},
	A: {
		bg: "bg-orange-500/20",
		border: "border-orange-500/40",
		text: "text-orange-400",
		label: "A",
	},
	B: {
		bg: "bg-yellow-500/20",
		border: "border-yellow-500/40",
		text: "text-yellow-400",
		label: "B",
	},
	C: {
		bg: "bg-green-500/20",
		border: "border-green-500/40",
		text: "text-green-400",
		label: "C",
	},
	D: {
		bg: "bg-blue-500/20",
		border: "border-blue-500/40",
		text: "text-blue-400",
		label: "D",
	},
};

const TIER_ORDER: TierLabel[] = ["S", "A", "B", "C", "D"];

const STRATEGY_LABELS: Record<StrategyName, string> = {
	fixedPercentile: "Fixed %",
	stdDev: "Std Dev",
	kmeans: "K-Means",
};

interface TierRowProps {
	tier: TierLabel;
	assignments: TierAssignment[];
	compact: boolean;
}

const TierRow = ({ tier, assignments, compact }: TierRowProps) => {
	const meta = TIER_META[tier];

	return (
		<div className={`flex min-h-12 gap-0 overflow-hidden rounded-lg border ${meta.border}`}>
			{/* Tier label column */}
			<div
				className={`flex shrink-0 items-center justify-center ${meta.bg} ${compact ? "w-8" : "w-12"}`}
			>
				<span className={`font-black ${meta.text} ${compact ? "text-sm" : "text-lg"}`}>
					{meta.label}
				</span>
			</div>

			{/* Pokemon chips */}
			<div className="flex flex-1 flex-wrap items-center gap-1.5 bg-white/2 p-2">
				{assignments.length === 0 ? (
					<span className="text-xs text-white/20 italic">No Pokémon yet</span>
				) : (
					assignments.map(({ pokemon, rating }) => (
						<div
							key={pokemon.id}
							title={`${pokemon.displayName} — ordinal: ${rating.ordinal.toFixed(2)}, σ: ${rating.sigma.toFixed(2)}, votes: ${rating.matchCount}`}
							className="flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 hover:bg-white/10 transition-colors"
						>
							<img
								src={pokemon.spriteUrl}
								alt={pokemon.displayName}
								width={compact ? 20 : 28}
								height={compact ? 20 : 28}
								style={{ imageRendering: "pixelated" }}
								className="shrink-0"
							/>
							{!compact && (
								<span className="text-xs text-white/70 leading-none">{pokemon.displayName}</span>
							)}
						</div>
					))
				)}
			</div>

			{/* Count badge */}
			<div className="flex shrink-0 items-center pr-2">
				<span className="text-xs text-white/20 tabular-nums">{assignments.length}</span>
			</div>
		</div>
	);
};

export const TierlistPreview = ({
	tiers,
	confidence,
	totalVotes,
	strategy,
	onStrategyChange,
	compact = false,
}: TierlistPreviewProps) => {
	return (
		<div className="flex w-full flex-col gap-3">
			{/* Header */}
			<div className="flex items-center justify-between gap-2">
				<h3 className={`font-semibold text-white/80 ${compact ? "text-sm" : "text-base"}`}>
					Current Tierlist
				</h3>

				{/* Strategy switcher */}
				<div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
					{(Object.keys(STRATEGY_LABELS) as StrategyName[]).map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => onStrategyChange(s)}
							className={[
								"rounded px-2 py-0.5 text-xs font-medium transition-colors",
								strategy === s ? "bg-white/15 text-white" : "text-white/30 hover:text-white/60",
							].join(" ")}
						>
							{STRATEGY_LABELS[s]}
						</button>
					))}
				</div>
			</div>

			{/* Tier rows */}
			<div className="flex flex-col gap-1.5">
				{TIER_ORDER.map((tier) => (
					<TierRow key={tier} tier={tier} assignments={tiers[tier]} compact={compact} />
				))}
			</div>

			{/* Confidence bar */}
			<ConfidenceBar confidence={confidence} totalVotes={totalVotes} />
		</div>
	);
};
