import { Effect } from "effect";
import { useCallback, useState } from "react";
import type { SelectedPair } from "@/ranking/pairSelection";
import { recordSkip, recordVote } from "@/services/rankingService";
import { PokemonCard } from "./PokemonCard";

interface ComparisonViewProps {
	pair: SelectedPair;
}

type VoteState =
	| { status: "idle" }
	| { status: "voted"; winnerId: number }
	| { status: "skipped" }
	| { status: "error"; message: string };

export const ComparisonView = ({ pair }: ComparisonViewProps) => {
	const [voteState, setVoteState] = useState<VoteState>({ status: "idle" });

	const handleVote = useCallback(
		(winnerId: number, loserId: number) => {
			if (voteState.status !== "idle") return;

			setVoteState({ status: "voted", winnerId });

			Effect.runPromise(recordVote(winnerId, loserId)).catch((err: unknown) => {
				console.error("[ComparisonView] recordVote failed:", err);
				setVoteState({
					status: "error",
					message: err instanceof Error ? err.message : "Unknown error",
				});
			});
		},
		[voteState.status],
	);

	const handleSkip = useCallback(() => {
		if (voteState.status !== "idle") return;

		setVoteState({ status: "skipped" });

		Effect.runPromise(recordSkip(pair.left.pokemon.id, pair.right.pokemon.id)).catch(
			(err: unknown) => {
				console.error("[ComparisonView] recordSkip failed:", err);
				setVoteState({
					status: "error",
					message: err instanceof Error ? err.message : "Unknown error",
				});
			},
		);
	}, [voteState.status, pair.left.pokemon.id, pair.right.pokemon.id]);

	const { left, right } = pair;

	const isVoted = voteState.status === "voted";
	const isSkipped = voteState.status === "skipped";
	const isDone = isVoted || isSkipped;

	return (
		<div className="flex w-full flex-col items-center gap-8">
			{/* Prompt */}
			<div className="text-center">
				<h2 className="text-xl font-semibold text-white/90">Which is better in a draft league?</h2>
				<p className="mt-1 text-sm text-white/40">Based on overall viability, not just raw stats</p>
			</div>

			{/* Cards row */}
			<div className="flex w-full max-w-xl items-center justify-center gap-4">
				<div className="flex-1">
					<PokemonCard
						pokemon={left.pokemon}
						onClick={!isDone ? () => handleVote(left.pokemon.id, right.pokemon.id) : undefined}
						selected={isVoted && voteState.winnerId === left.pokemon.id}
						dimmed={(isVoted && voteState.winnerId !== left.pokemon.id) || isSkipped}
					/>
				</div>

				{/* VS divider */}
				<div className="flex shrink-0 flex-col items-center gap-2">
					<span
						className={[
							"text-lg font-black tracking-widest transition-colors duration-300",
							isDone ? "text-white/20" : "text-white/30",
						].join(" ")}
					>
						VS
					</span>
				</div>

				<div className="flex-1">
					<PokemonCard
						pokemon={right.pokemon}
						onClick={!isDone ? () => handleVote(right.pokemon.id, left.pokemon.id) : undefined}
						selected={isVoted && voteState.winnerId === right.pokemon.id}
						dimmed={(isVoted && voteState.winnerId !== right.pokemon.id) || isSkipped}
					/>
				</div>
			</div>

			{/* Skip button / feedback */}
			<div className="flex h-10 items-center justify-center">
				{voteState.status === "idle" && (
					<button
						type="button"
						onClick={handleSkip}
						className="rounded-lg px-5 py-2 text-sm text-white/30 transition-colors hover:bg-white/5 hover:text-white/60 active:scale-95"
					>
						Skip — I&apos;m not sure
					</button>
				)}

				{isVoted && (
					<p className="animate-fade-in text-sm text-white/40">
						Nice pick. Next one is on the way&hellip;
					</p>
				)}

				{isSkipped && (
					<p className="animate-fade-in text-sm text-white/40">Skipped. Moving on&hellip;</p>
				)}

				{voteState.status === "error" && (
					<p className="text-sm text-red-400">Something went wrong: {voteState.message}</p>
				)}
			</div>
		</div>
	);
};
