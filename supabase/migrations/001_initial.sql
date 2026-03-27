-- =============================================================================
-- TFL Tierlist Ranker — initial schema
-- Run this in the Supabase SQL editor (or via supabase db push).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists pokemon (
  id           integer primary key,
  name         text    not null,
  display_name text    not null,
  sprite_url   text    not null,
  type1        text    not null,
  type2        text,
  bst          integer not null
);

create table if not exists ratings (
  pokemon_id  integer primary key references pokemon(id) on delete cascade,
  mu          double precision not null,
  sigma       double precision not null,
  ordinal     double precision not null,
  match_count integer          not null default 0
);

create table if not exists matchups (
  id          bigserial primary key,
  winner_id   integer  not null references pokemon(id) on delete cascade,
  loser_id    integer  not null references pokemon(id) on delete cascade,
  skipped     boolean  not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Fast ordered tierlist reads
create index if not exists ratings_ordinal_idx on ratings (ordinal desc);

-- Fast match count reads
create index if not exists ratings_match_count_idx on ratings (match_count);

-- Fast recent matchup lookups (pair selection cooldown)
create index if not exists matchups_created_at_idx on matchups (created_at desc);

-- Fast per-pokemon history lookups
create index if not exists matchups_winner_id_idx on matchups (winner_id);
create index if not exists matchups_loser_id_idx  on matchups (loser_id);

-- ---------------------------------------------------------------------------
-- Realtime
-- Enable publication on the two tables whose changes need to push to all
-- connected clients. `pokemon` is seeded once and never mutated, so it's
-- intentionally excluded.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table ratings;
alter publication supabase_realtime add table matchups;

-- ---------------------------------------------------------------------------
-- RPC: record_vote
--
-- Atomically writes:
--   1. updated winner rating row
--   2. updated loser rating row
--   3. a new non-skipped matchup row
--
-- The OpenSkill computation (applyMatchResult) runs client-side and passes
-- the already-computed updated values in. This function's sole job is to
-- guarantee those three writes land as a single transaction.
-- ---------------------------------------------------------------------------

create or replace function record_vote(
  p_winner_id            integer,
  p_loser_id             integer,
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
  where pokemon_id = p_winner_id;

  if not found then
    raise exception 'Rating not found for pokemon_id %', p_winner_id;
  end if;

  -- Update loser rating
  update ratings set
    mu          = p_loser_mu,
    sigma       = p_loser_sigma,
    ordinal     = p_loser_ordinal,
    match_count = p_loser_match_count
  where pokemon_id = p_loser_id;

  if not found then
    raise exception 'Rating not found for pokemon_id %', p_loser_id;
  end if;

  -- Append matchup log entry
  insert into matchups (winner_id, loser_id, skipped)
  values (p_winner_id, p_loser_id, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: record_skip
--
-- Appends a skipped matchup entry. Ratings are NOT updated for skips.
-- The pair is logged so the pair-selection cooldown window applies.
-- ---------------------------------------------------------------------------

create or replace function record_skip(
  p_pokemon_a_id integer,
  p_pokemon_b_id integer
)
returns void
language plpgsql
security definer
as $$
begin
  insert into matchups (winner_id, loser_id, skipped)
  values (p_pokemon_a_id, p_pokemon_b_id, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- This app is currently a public community tool with no per-user access
-- control. All rows are readable and writable by the anon role.
-- Writes are gated through the security-definer RPCs above — direct table
-- INSERT/UPDATE via the anon key is intentionally disabled on ratings so
-- only the atomic RPC path can mutate rating data.
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
