-- Run this whole script in Supabase → SQL Editor if you get:
--   ERROR: relation "public.profiles" does not exist
-- It creates `profiles` (if missing) + default_strategy_name + RLS policies.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists default_strategy_name text;

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

-- Tell PostgREST to reload so the API sees the new table (fixes "Could not find the table in the schema cache")
notify pgrst, 'reload schema';
