import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Console } from "effect";
import type { Database } from "../src/lib/database.types";
import { INITIAL_MU, INITIAL_SIGMA } from "../src/ranking/openskill";
import type { PokemonAsset } from "../src/types/pokemon";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing required environment variables.\n" +
      "Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun run scripts/seed-supabase.ts",
  );
  process.exit(1);
}

// Service role client — bypasses RLS, only used in this server-side script
const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(fileURLToPath(import.meta.url), "..");

const loadPokemonAsset = (): PokemonAsset => {
  const assetPath = join(__dirname, "../src/assets/pokemon.json");
  const raw = readFileSync(assetPath, "utf-8");
  return JSON.parse(raw) as PokemonAsset;
};

const BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Seed pipeline (Effect)
// ---------------------------------------------------------------------------

const checkExisting = Effect.tryPromise({
  try: () =>
    supabase.from("pokemon").select("id", { count: "exact", head: true }),
  catch: (cause) =>
    new Error(`Failed to check existing pokemon: ${String(cause)}`),
}).pipe(
  Effect.flatMap(({ count, error }) => {
    if (error)
      return Effect.fail(new Error(`Supabase error: ${error.message}`));
    return Effect.succeed(count ?? 0);
  }),
);

const pruneStale = (asset: PokemonAsset) =>
  Effect.gen(function* () {
    // Fetch every name currently in the DB
    const { data, error } = yield* Effect.tryPromise({
      try: () => supabase.from("pokemon").select("name"),
      catch: (cause) =>
        new Error(`Failed to fetch pokemon names from DB: ${String(cause)}`),
    });

    if (error) {
      return yield* Effect.fail(
        new Error(`Supabase error fetching names: ${error.message}`),
      );
    }

    const assetNames = new Set(asset.pokemon.map((p) => p.name));
    const staleNames = (data ?? [])
      .map((row) => row.name)
      .filter((name) => !assetNames.has(name));

    if (staleNames.length === 0) {
      yield* Console.log("  ✓ No stale Pokémon to prune.");
      return 0;
    }

    yield* Console.log(
      `  Pruning ${staleNames.length} stale Pokémon (cascade will remove their ratings + matchups):\n` +
        staleNames.map((n) => `    - ${n}`).join("\n"),
    );

    // ON DELETE CASCADE handles ratings + matchups automatically
    const { error: deleteError } = yield* Effect.tryPromise({
      try: () => supabase.from("pokemon").delete().in("name", staleNames),
      catch: (cause) =>
        new Error(`Failed to delete stale pokemon: ${String(cause)}`),
    });

    if (deleteError) {
      return yield* Effect.fail(
        new Error(`Supabase delete error: ${deleteError.message}`),
      );
    }

    yield* Console.log(`  ✓ Pruned ${staleNames.length} stale Pokémon.`);
    return staleNames.length;
  });

const seedPokemon = (asset: PokemonAsset) =>
  Effect.gen(function* () {
    yield* Console.log(
      `Seeding ${asset.pokemon.length} Pokémon in batches of ${BATCH_SIZE}…`,
    );

    let inserted = 0;

    for (let i = 0; i < asset.pokemon.length; i += BATCH_SIZE) {
      const batch = asset.pokemon.slice(i, i + BATCH_SIZE);

      const rows = batch.map((p) => ({
        id: p.id,
        name: p.name,
        display_name: p.displayName,
        form_name: p.formName,
        form_display_name: p.formDisplayName,
        sprite_url: p.spriteUrl,
        type1: p.type1,
        type2: p.type2 ?? null,
        bst: p.bst,
      }));

      const { error } = yield* Effect.tryPromise({
        try: () =>
          supabase.from("pokemon").upsert(rows, { onConflict: "name" }),
        catch: (cause) =>
          new Error(
            `Failed to upsert pokemon batch ${i}–${i + batch.length}: ${String(cause)}`,
          ),
      });

      if (error) {
        return yield* Effect.fail(
          new Error(`Supabase upsert error: ${error.message}`),
        );
      }

      inserted += batch.length;
      yield* Console.log(
        `  ✓ ${inserted}/${asset.pokemon.length} Pokémon upserted`,
      );
    }

    return inserted;
  });

const seedRatings = (asset: PokemonAsset) =>
  Effect.gen(function* () {
    yield* Console.log("Seeding initial ratings…");

    // ordinal = mu - 3*sigma (standard OpenSkill default)
    const initialOrdinal = INITIAL_MU - 3 * INITIAL_SIGMA;

    let inserted = 0;

    for (let i = 0; i < asset.pokemon.length; i += BATCH_SIZE) {
      const batch = asset.pokemon.slice(i, i + BATCH_SIZE);

      const rows = batch.map((p) => ({
        pokemon_name: p.name,
        mu: INITIAL_MU,
        sigma: INITIAL_SIGMA,
        ordinal: initialOrdinal,
        match_count: 0,
      }));

      const { error } = yield* Effect.tryPromise({
        try: () =>
          supabase.from("ratings").upsert(rows, {
            onConflict: "pokemon_name",
            // Don't overwrite existing ratings — idempotent for re-runs
            ignoreDuplicates: true,
          }),
        catch: (cause) =>
          new Error(
            `Failed to upsert ratings batch ${i}–${i + batch.length}: ${String(cause)}`,
          ),
      });

      if (error) {
        return yield* Effect.fail(
          new Error(`Supabase upsert error: ${error.message}`),
        );
      }

      inserted += batch.length;
    }

    yield* Console.log(
      `  ✓ ${inserted} initial ratings upserted (skipped any existing)`,
    );
    return inserted;
  });

const main = Effect.gen(function* () {
  yield* Console.log("TFL Tierlist Ranker — Supabase seed script\n");

  const asset = loadPokemonAsset();
  yield* Console.log(
    `Loaded pokemon.json: ${asset.pokemon.length} Pokémon (generated ${asset.generatedAt})\n`,
  );

  yield* Console.log("Pruning stale Pokémon…");
  yield* pruneStale(asset);

  yield* Console.log("");
  const existingCount = yield* checkExisting;

  if (existingCount === asset.pokemon.length) {
    yield* Console.log(
      `Database already has ${existingCount} Pokémon — skipping pokemon upsert.\n` +
        "Run with FORCE=1 to re-upsert anyway, or just let ratings seed be idempotent.",
    );
  } else {
    yield* seedPokemon(asset);
  }

  yield* Console.log("");
  yield* seedRatings(asset);

  yield* Console.log(
    "\n✅ Seed complete. Your Supabase database is ready.\n" +
      "   You can now start the app with: bun run dev",
  );
});

Effect.runPromise(main).catch((err: unknown) => {
  console.error("\n❌ Seed failed:", err);
  process.exit(1);
});
