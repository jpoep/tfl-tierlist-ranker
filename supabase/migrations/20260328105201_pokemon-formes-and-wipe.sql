-- =============================================================================
-- TFL Tierlist Ranker — migration 002: formes + clean slate
--
-- What this does and why:
--
--   The Pokémon pool has fundamentally changed:
--     • Only final evolutions are now included (pre-evos removed).
--     • Alternate formes (Rotom-Heat, Urshifu-Rapid-Strike, etc.) are each a
--       separate ranked entry. Mega and G-Max formes are excluded.
--     • Two new columns: form_name and form_display_name.
--
--   Because formes share a national dex id, the old `id integer primary key`
--   cannot remain the primary key. The new PK is `name text` — the unique
--   PokéAPI pokemon-level slug (e.g. "rotom-heat").
--
--   The old matchup history was gathered against a different pool and is no
--   longer meaningful. A clean slate is the correct call: all votes and ratings
--   are wiped so the new pool starts fresh.
--
-- Order of operations:
--   1. Drop dependent objects (RPCs, indexes, tables) in FK-safe order.
--   2. Recreate tables with the new schema.
--   3. Recreate indexes.
--   4. Re-enable Realtime publications.
--   5. Recreate RLS policies.
--   6. Recreate RPCs with text identifiers.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Drop old RPCs, tables (cascade handles FKs + indexes automatically)
-- ---------------------------------------------------------------------------

drop function if exists record_vote(integer, integer, double precision, double precision, double precision, integer, double precision, double precision, double precision, integer);
drop function if exists record_skip(integer, integer);

-- Drop in FK-dependency order (matchups + ratings reference pokemon)
drop table if exists matchups;
drop table if exists ratings;
drop table if exists pokemon;


-- ---------------------------------------------------------------------------
-- 2. Recreate tables
-- ---------------------------------------------------------------------------

create table pokemon (
  -- National Pokédex number of the base species.
  -- NOT unique — formes of the same species share this value.
  -- Kept for display grouping and sorting only.
  id             integer      not null,

  -- PokéAPI pokemon-level slug, e.g. "rotom-heat", "urshifu-rapid-strike".
  -- Unique across all entries including formes. This is the primary key.
  name           text         not null,

  -- Human-readable species name, e.g. "Rotom", "Urshifu".
  display_name   text         not null,

  -- PokéAPI pokemon-level slug for this specific forme — always equal to name.
  -- Stored explicitly for clarity and potential future query convenience.
  form_name      text         not null,

  -- Human-readable forme label, e.g. "Rotom Heat", "Urshifu Rapid Strike".
  -- Equal to display_name for single-form Pokémon.
  form_display_name text      not null,

  sprite_url     text         not null,
  type1          text         not null,
  type2          text,
  bst            integer      not null,

  constraint pokemon_pkey primary key (name),
  constraint pokemon_form_name_matches_name check (form_name = name)
);

create table ratings (
  pokemon_name  text             primary key references pokemon(name) on delete cascade,
  mu            double precision not null,
  sigma         double precision not null,
  ordinal       double precision not null,  -- mu - 3*sigma; higher = better
  match_count   integer          not null default 0
);

create table matchups (
  id          bigserial    primary key,
  winner_name text         not null references pokemon(name) on delete cascade,
  loser_name  text         not null references pokemon(name) on delete cascade,
  skipped     boolean      not null default false,
  created_at  timestamptz  not null default now()
);


-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

-- Fast ordered tierlist reads
create index ratings_ordinal_idx     on ratings (ordinal desc);

-- Fast match count reads
create index ratings_match_count_idx on ratings (match_count);

-- Fast recent matchup lookups (pair selection cooldown)
create index matchups_created_at_idx on matchups (created_at desc);

-- Fast per-pokemon history lookups
create index matchups_winner_name_idx on matchups (winner_name);
create index matchups_loser_name_idx  on matchups (loser_name);

-- Grouping / sorting by national dex number
create index pokemon_id_idx on pokemon (id);


-- ---------------------------------------------------------------------------
-- 4. Realtime publications
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table ratings;
alter publication supabase_realtime add table matchups;


-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------

alter table pokemon  enable row level security;
alter table ratings  enable row level security;
alter table matchups enable row level security;

-- Pokemon: public read, no writes (seeded via service role key only)
create policy "pokemon_read" on pokemon
  for select to anon using (true);

-- Ratings: public read, no direct writes (mutations via record_vote RPC only)
create policy "ratings_read" on ratings
  for select to anon using (true);

-- Matchups: public read, no direct writes (mutations via RPC only)
create policy "matchups_read" on matchups
  for select to anon using (true);


-- ---------------------------------------------------------------------------
-- 6. RPC: record_vote
--
-- Atomically writes:
--   1. updated winner rating row
--   2. updated loser rating row
--   3. a new non-skipped matchup row
--
-- Identifiers are now text slugs (pokemon.name) rather than integer ids.
-- The OpenSkill computation still runs client-side; this function only
-- guarantees the three writes land as a single transaction.
-- ---------------------------------------------------------------------------

create or replace function record_vote(
  p_winner_name          text,
  p_loser_name           text,
  p_winner_mu            double precision,
  p_winner_sigma         double precision,
  p_winner_ordinal       double precision,
  p_winner_match_count   integer,
  p_loser_mu             double precision,
  p_loser_sigma          double precision,
  p_loser_ordinal        double precision,
  p_loser_match_count    integer
)
returns void
language plpgsql
security definer
as $$
begin
  -- Update winner rating
  update ratings set
    mu          = p_winner_mu,
    sigma       = p_winner_sigma,
    ordinal     = p_winner_ordinal,
    match_count = p_winner_match_count
  where pokemon_name = p_winner_name;

  if not found then
    raise exception 'Rating not found for pokemon_name %', p_winner_name;
  end if;

  -- Update loser rating
  update ratings set
    mu          = p_loser_mu,
    sigma       = p_loser_sigma,
    ordinal     = p_loser_ordinal,
    match_count = p_loser_match_count
  where pokemon_name = p_loser_name;

  if not found then
    raise exception 'Rating not found for pokemon_name %', p_loser_name;
  end if;

  -- Append matchup log entry
  insert into matchups (winner_name, loser_name, skipped)
  values (p_winner_name, p_loser_name, false);
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. RPC: record_skip
--
-- Appends a skipped matchup entry. Ratings are NOT updated for skips.
-- The pair is logged so the pair-selection cooldown window applies.
-- ---------------------------------------------------------------------------

create or replace function record_skip(
  p_pokemon_a_name text,
  p_pokemon_b_name text
)
returns void
language plpgsql
security definer
as $$
begin
  insert into matchups (winner_name, loser_name, skipped)
  values (p_pokemon_a_name, p_pokemon_b_name, true);
end;
$$;
