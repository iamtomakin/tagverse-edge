-- Run this in Supabase Dashboard → SQL Editor to create tables and RLS for per-user calendar data.

-- Daily results: one row per (user, date, instrument)
create table if not exists public.daily_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key text not null,
  instrument text not null,
  total_r numeric not null,
  trade_count int not null,
  trade_1_r numeric,
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

-- Profiles: per-user public profile (username, optional avatar/bio)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now()
);

-- Display name for the built-in "default" strategy (not stored in strategies table)
alter table public.profiles add column if not exists default_strategy_name text;
alter table public.profiles add column if not exists journal_options jsonb;
alter table public.profiles add column if not exists log_r_options jsonb;

alter table public.profiles enable row level security;

drop policy if exists "Profiles are readable by everyone" on public.profiles;
create policy "Profiles are readable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "Users can upsert own profile" on public.profiles;
create policy "Users can upsert own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

grant usage on schema public to anon, authenticated, service_role;
grant all on table public.profiles to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- Shared calendars/posts shown on Community page
create table if not exists public.shared_calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  snapshot_token text not null,
  topic text default 'general',
  created_at timestamptz not null default now(),
  is_public boolean not null default true
);

alter table public.shared_calendars enable row level security;

drop policy if exists "Shared calendars are public" on public.shared_calendars;
create policy "Shared calendars are public"
  on public.shared_calendars for select
  using (is_public = true);

drop policy if exists "Users can manage own shared calendars" on public.shared_calendars;
create policy "Users can manage own shared calendars"
  on public.shared_calendars for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Comments on shared calendars
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.shared_calendars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

alter table public.comments enable row level security;

drop policy if exists "Comments are readable on public posts" on public.comments;
create policy "Comments are readable on public posts"
  on public.comments for select
  using (
    exists (
      select 1 from public.shared_calendars sc
      where sc.id = post_id and sc.is_public = true
    )
  );

drop policy if exists "Users can insert own comments" on public.comments;
create policy "Users can insert own comments"
  on public.comments for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own comments" on public.comments;
create policy "Users can update own comments"
  on public.comments for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own comments" on public.comments;
create policy "Users can delete own comments"
  on public.comments for delete
  using (auth.uid() = user_id);
