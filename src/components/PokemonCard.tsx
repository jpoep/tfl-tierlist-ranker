import type { Pokemon } from "@/types/pokemon";

interface PokemonCardProps {
	pokemon: Pokemon;
	onClick?: () => void;
	/** Whether this card is in "selected/winner" state */
	selected?: boolean;
	/** Whether the other card in the pair was selected (this one lost) */
	dimmed?: boolean;
}

const TYPE_COLOURS: Record<string, string> = {
	normal: "bg-stone-400",
	fire: "bg-orange-500",
	water: "bg-blue-500",
	electric: "bg-yellow-400",
	grass: "bg-green-500",
	ice: "bg-cyan-300",
	fighting: "bg-red-700",
	poison: "bg-purple-500",
	ground: "bg-yellow-600",
	flying: "bg-indigo-400",
	psychic: "bg-pink-500",
	bug: "bg-lime-500",
	rock: "bg-yellow-700",
	ghost: "bg-violet-700",
	dragon: "bg-indigo-700",
	dark: "bg-neutral-700",
	steel: "bg-slate-400",
	fairy: "bg-pink-300",
};

const typeColour = (type: string): string => TYPE_COLOURS[type] ?? "bg-gray-400";

export const PokemonCard = ({
	pokemon,
	onClick,
	selected = false,
	dimmed = false,
}: PokemonCardProps) => {
	const isClickable = !!onClick;

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={!isClickable}
			className={[
				"group flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition-all duration-150 select-none",
				isClickable ? "cursor-pointer hover:shadow-lg active:scale-95" : "cursor-default",
				selected
					? "border-white bg-white/10 shadow-lg shadow-white/10"
					: dimmed
						? "border-white/10 bg-white/3 opacity-40"
						: "border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10",
			]
				.filter(Boolean)
				.join(" ")}
			aria-label={isClickable ? `Choose ${pokemon.displayName}` : pokemon.displayName}
		>
			{/* Sprite */}
			<div className="relative flex h-28 w-28 items-center justify-center">
				<img
					src={pokemon.spriteUrl}
					alt={pokemon.displayName}
					width={112}
					height={112}
					className={[
						"h-full w-full object-contain transition-transform duration-150",
						"image-rendering-pixelated",
						isClickable && !selected && !dimmed ? "group-hover:scale-110" : "",
						selected ? "scale-110" : "",
					]
						.filter(Boolean)
						.join(" ")}
					style={{ imageRendering: "pixelated" }}
				/>
			</div>

			{/* Name */}
			<span
				className={[
					"text-center text-base font-semibold tracking-wide transition-colors",
					selected ? "text-white" : "text-white/80",
				].join(" ")}
			>
				{pokemon.displayName}
			</span>

			{/* Types */}
			<div className="flex gap-1.5">
				<span
					className={`rounded px-2 py-0.5 text-xs font-medium text-white ${typeColour(pokemon.type1)}`}
				>
					{pokemon.type1}
				</span>
				{pokemon.type2 && (
					<span
						className={`rounded px-2 py-0.5 text-xs font-medium text-white ${typeColour(pokemon.type2)}`}
					>
						{pokemon.type2}
					</span>
				)}
			</div>
		</button>
	);
};
