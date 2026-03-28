import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";
import type { SelectedPair } from "@/ranking/pairSelection";
import { recordSkip, recordVote } from "@/services/rankingService";
import { PokemonCard } from "./PokemonCard";

interface ComparisonViewProps {
  pair: SelectedPair;
  onAdvance: () => void;
}

type VoteState =
  | { status: "idle" }
  | { status: "voted"; winnerName: string }
  | { status: "skipped" }
  | { status: "error"; message: string };

const ADVANCE_DELAY_MS = 800;

const KeyHint = ({
  labels,
  description,
}: {
  labels: string[];
  description: string;
}) => (
  <span className="flex items-center gap-1.5">
    {labels.map((label, i) => (
      <>
        <kbd
          key={label}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/20 bg-white/10 px-1 font-mono text-[10px] text-white/50"
        >
          {label}
        </kbd>
        {i < labels.length - 1 && <span className="text-white/25">/</span>}
      </>
    ))}
    <span className="text-white/25">{description}</span>
  </span>
);

export const ComparisonView = ({ pair, onAdvance }: ComparisonViewProps) => {
  const [voteState, setVoteState] = useState<VoteState>({ status: "idle" });

  // When the pair prop changes (i.e. after advance() causes a re-render with a
  // new pair), reset the vote state so the new cards are interactive.
  useEffect(() => {
    setVoteState({ status: "idle" });
  }, [pair]);

  const handleVote = useCallback(
    (winnerName: string, loserName: string) => {
      if (voteState.status !== "idle") return;

      setVoteState({ status: "voted", winnerName });

      Effect.runPromise(recordVote(winnerName, loserName))
        .then(() => {
          setTimeout(onAdvance, ADVANCE_DELAY_MS);
        })
        .catch((err: unknown) => {
          console.error("[ComparisonView] recordVote failed:", err);
          setVoteState({
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        });
    },
    [voteState.status, onAdvance],
  );

  const handleSkip = useCallback(() => {
    if (voteState.status !== "idle") return;

    setVoteState({ status: "skipped" });

    Effect.runPromise(
      recordSkip(pair.left.pokemon.name, pair.right.pokemon.name),
    )
      .then(() => {
        setTimeout(onAdvance, ADVANCE_DELAY_MS);
      })
      .catch((err: unknown) => {
        console.error("[ComparisonView] recordSkip failed:", err);
        setVoteState({
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      });
  }, [
    voteState.status,
    pair.left.pokemon.name,
    pair.right.pokemon.name,
    onAdvance,
  ]);

  // Keyboard navigation — only active while idle so it can't double-fire
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't steal input events from focused form elements
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "j") {
        e.preventDefault();
        handleVote(pair.left.pokemon.name, pair.right.pokemon.name);
      } else if (e.key === "ArrowRight" || e.key === "l") {
        e.preventDefault();
        handleVote(pair.right.pokemon.name, pair.left.pokemon.name);
      } else if (e.key === " ") {
        e.preventDefault();
        handleSkip();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleVote, handleSkip, pair.left.pokemon.name, pair.right.pokemon.name]);

  const { left, right } = pair;

  const isVoted = voteState.status === "voted";
  const isSkipped = voteState.status === "skipped";
  const isDone = isVoted || isSkipped;

  return (
    <div className="flex w-full flex-col items-center gap-8">
      {/* Prompt */}
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white/90">
          Welches Pokémon ist in der TFL besser?
        </h2>
        <p className="mt-1 text-sm text-white/40">Sei objektiv</p>
      </div>

      {/* Cards row */}
      <div className="grid w-full max-w-xl grid-cols-[1fr_auto_1fr] items-center gap-2">
        <PokemonCard
          className="place-self-center"
          pokemon={left.pokemon}
          onClick={
            !isDone
              ? () => handleVote(left.pokemon.name, right.pokemon.name)
              : undefined
          }
          selected={isVoted && voteState.winnerName === left.pokemon.name}
          dimmed={
            (isVoted && voteState.winnerName !== left.pokemon.name) || isSkipped
          }
        />

        {/* VS divider */}
        <div className="flex flex-col items-center gap-2">
          <span
            className={[
              "text-lg font-black tracking-widest transition-colors duration-300",
              isDone ? "text-white/20" : "text-white/30",
            ].join(" ")}
          >
            VS
          </span>
        </div>

        <PokemonCard
          className="place-self-center"
          pokemon={right.pokemon}
          onClick={
            !isDone
              ? () => handleVote(right.pokemon.name, left.pokemon.name)
              : undefined
          }
          selected={isVoted && voteState.winnerName === right.pokemon.name}
          dimmed={
            (isVoted && voteState.winnerName !== right.pokemon.name) ||
            isSkipped
          }
        />
      </div>

      {/* Skip button / feedback */}
      <div className="flex h-10 items-center justify-center">
        {voteState.status === "idle" && (
          <button
            type="button"
            onClick={handleSkip}
            className="rounded-lg px-5 py-2 text-sm text-white/30 transition-colors hover:bg-white/5 hover:text-white/60 active:scale-95"
          >
            Keine Ahnung
          </button>
        )}

        {isVoted && (
          <p className="text-sm text-white/40">
            Nice pick. Nächster kommt&hellip;
          </p>
        )}

        {isSkipped && (
          <p className="text-sm text-white/40">
            Skipped. Weiter geht's&hellip;
          </p>
        )}

        {voteState.status === "error" && (
          <p className="text-sm text-red-400">
            Irgendwas ist kaputt: {voteState.message}
          </p>
        )}
      </div>

      {/* Keyboard hints — only shown while idle */}
      {!isDone && (
        <div className="flex items-center gap-4 text-xs">
          <KeyHint labels={["←", "J"]} description="links picken" />
          <KeyHint labels={["→", "L"]} description="rechts picken" />
          <KeyHint labels={["Space"]} description="skip" />
        </div>
      )}
    </div>
  );
};
