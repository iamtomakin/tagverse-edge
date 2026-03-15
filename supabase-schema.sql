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

-- RLS: users can only read/write their own rows
alter table public.daily_results enable row level security;
alter table public.declarations enable row level security;

create policy "Users can read own daily_results"
  on public.daily_results for select
  using (auth.uid() = user_id);

create policy "Users can insert own daily_results"
  on public.daily_results for insert
  with check (auth.uid() = user_id);

create policy "Users can update own daily_results"
  on public.daily_results for update
  using (auth.uid() = user_id);

create policy "Users can delete own daily_results"
  on public.daily_results for delete
  using (auth.uid() = user_id);

create policy "Users can read own declarations"
  on public.declarations for select
  using (auth.uid() = user_id);

create policy "Users can insert own declarations"
  on public.declarations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own declarations"
  on public.declarations for update
  using (auth.uid() = user_id);

create policy "Users can delete own declarations"
  on public.declarations for delete
  using (auth.uid() = user_id);
