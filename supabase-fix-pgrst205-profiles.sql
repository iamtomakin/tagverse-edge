-- =============================================================================
-- Fix [PGRST205] "Could not find the table 'public.profiles' in the schema cache"
-- Run this ENTIRE file in Supabase → SQL Editor (same project as your SUPABASE_URL).
-- =============================================================================
-- ALSO CHECK IN DASHBOARD (critical):
--   Project Settings → Data API → "Exposed schemas" must include "public".
--   If "public" is missing, add it and save, then run this script again.
-- If error persists after this: Project Settings → General → Pause project → Resume.
-- =============================================================================

-- Table + column (safe to re-run)
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

-- PostgREST must be able to resolve the table for the API roles
grant usage on schema public to anon, authenticated, service_role;
grant all on table public.profiles to anon, authenticated, service_role;

-- Force PostgREST to reload its schema cache
notify pgrst, 'reload schema';
