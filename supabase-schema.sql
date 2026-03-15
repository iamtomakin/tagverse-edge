-- Run this in Supabase Dashboard → SQL Editor to create tables and RLS for per-user calendar data.

-- Daily results: one row per (user, date, instrument)
create table if not exists public.daily_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key text not null,
  instrument text not null,
  total_r int not null,
  trade_count int not null,
  trade_1_r int,
  unique(user_id, date_key, instrument)
);

-- Declarations: one row per (user, date, instrument)
create table if not exists public.declarations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key text not null,
  instrument text not null,
  trade_count_planned int not null,
  created_at timestamptz not null,
  unique(user_id, date_key, instrument)
);

-- RLS: users can only read/write their own rows (drop first so script is safe to re-run)
alter table public.daily_results enable row level security;
alter table public.declarations enable row level security;

drop policy if exists "Users can read own daily_results" on public.daily_results;
create policy "Users can read own daily_results"
  on public.daily_results for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own daily_results" on public.daily_results;
create policy "Users can insert own daily_results"
  on public.daily_results for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own daily_results" on public.daily_results;
create policy "Users can update own daily_results"
  on public.daily_results for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own daily_results" on public.daily_results;
create policy "Users can delete own daily_results"
  on public.daily_results for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can read own declarations" on public.declarations;
create policy "Users can read own declarations"
  on public.declarations for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own declarations" on public.declarations;
create policy "Users can insert own declarations"
  on public.declarations for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own declarations" on public.declarations;
create policy "Users can update own declarations"
  on public.declarations for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own declarations" on public.declarations;
create policy "Users can delete own declarations"
  on public.declarations for delete
  using (auth.uid() = user_id);

-- Strategies: one row per user-created strategy (e.g. Default, 1:1 trades)
create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.strategies enable row level security;

drop policy if exists "Users can read own strategies" on public.strategies;
create policy "Users can read own strategies"
  on public.strategies for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own strategies" on public.strategies;
create policy "Users can insert own strategies"
  on public.strategies for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own strategies" on public.strategies;
create policy "Users can update own strategies"
  on public.strategies for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own strategies" on public.strategies;
create policy "Users can delete own strategies"
  on public.strategies for delete using (auth.uid() = user_id);

-- Add strategy_id to daily_results and declarations (nullable for existing rows; backfill existing rows per user with a Default strategy then set not null if desired)
alter table public.daily_results add column if not exists strategy_id uuid references public.strategies(id) on delete cascade;
alter table public.declarations add column if not exists strategy_id uuid references public.strategies(id) on delete cascade;

-- Optional: drop old unique and add new one once strategy_id is backfilled
-- alter table public.daily_results drop constraint if exists daily_results_user_id_date_key_instrument_key;
-- alter table public.daily_results add unique(user_id, strategy_id, date_key, instrument);
-- Same for declarations. Run after backfilling strategy_id for all rows.
