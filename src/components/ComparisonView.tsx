import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";
import type { SelectedPair } from "@/ranking/pairSelection";
import { recordSkip, recordVote } from "@/services/rankingService";
import { PokemonCard } from "./PokemonCard";

interface ComparisonViewProps {
  pair: SelectedPair;
  onAdvance: () => void;
  ordinalBias: number;
  onOrdinalBiasChange: (bias: number) => void;
  finalEvosOnly: boolean;
  onFinalEvosOnlyChange: (value: boolean) => void;
}

type VoteState =
  | { status: "idle" }
  | { status: "voted"; winnerId: number }
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

export const ComparisonView = ({
  pair,
  onAdvance,
  ordinalBias,
  onOrdinalBiasChange,
  finalEvosOnly,
  onFinalEvosOnlyChange,
}: ComparisonViewProps) => {
  const [voteState, setVoteState] = useState<VoteState>({ status: "idle" });

  // When the pair prop changes (i.e. after advance() causes a re-render with a
  // new pair), reset the vote state so the new cards are interactive.
  useEffect(() => {
    setVoteState({ status: "idle" });
  }, [pair]);

  const handleVote = useCallback(
    (winnerId: number, loserId: number) => {
      if (voteState.status !== "idle") return;

      setVoteState({ status: "voted", winnerId });

      Effect.runPromise(recordVote(winnerId, loserId))
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

    Effect.runPromise(recordSkip(pair.left.pokemon.id, pair.right.pokemon.id))
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
    pair.left.pokemon.id,
    pair.right.pokemon.id,
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
        handleVote(pair.left.pokemon.id, pair.right.pokemon.id);
      } else if (e.key === "ArrowRight" || e.key === "l") {
        e.preventDefault();
        handleVote(pair.right.pokemon.id, pair.left.pokemon.id);
      } else if (e.key === " ") {
        e.preventDefault();
        handleSkip();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleVote, handleSkip, pair.left.pokemon.id, pair.right.pokemon.id]);

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
              ? () => handleVote(left.pokemon.id, right.pokemon.id)
              : undefined
          }
          selected={isVoted && voteState.winnerId === left.pokemon.id}
          dimmed={
            (isVoted && voteState.winnerId !== left.pokemon.id) || isSkipped
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
              ? () => handleVote(right.pokemon.id, left.pokemon.id)
              : undefined
          }
          selected={isVoted && voteState.winnerId === right.pokemon.id}
          dimmed={
            (isVoted && voteState.winnerId !== right.pokemon.id) || isSkipped
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

      {/* Final evos only toggle */}
      <label className="flex w-full max-w-xs cursor-pointer items-center justify-between gap-3">
        <span className="text-xs text-white/30">Nur finale Entwicklungen</span>
        <button
          type="button"
          role="switch"
          aria-checked={finalEvosOnly}
          onClick={() => onFinalEvosOnlyChange(!finalEvosOnly)}
          className={[
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
            finalEvosOnly ? "bg-white/40" : "bg-white/10",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200",
              finalEvosOnly ? "translate-x-4.5" : "translate-x-0.5",
            ].join(" ")}
          />
        </button>
      </label>

      {/* Ordinal bias slider */}
      <div className="flex w-full max-w-xs flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-white/30">
          <span>Bias</span>
          <span className="tabular-nums">{Math.round(ordinalBias * 100)}%</span>
        </div>
        <div className="relative flex items-center">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={ordinalBias}
            onChange={(e) => onOrdinalBiasChange(Number(e.target.value))}
            className="w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-white/60"
            style={{ height: "4px" }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-white/20">
          <span>Unsichere Platzierung</span>
          <span>Starke Pokémon</span>
        </div>
      </div>
    </div>
  );
};
