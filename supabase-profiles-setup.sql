-- =============================================================================
-- Profile table setup for Tagverse Edge (run on your Supabase project:
-- e.g. iyrqvxizbdzjdkjykwdq — same project as index.html SUPABASE_URL)
-- =============================================================================
-- Run the ENTIRE script in: Supabase Dashboard → SQL Editor → Run
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- BEFORE YOU RUN (if Save profile still fails with PGRST205 after this):
--   • Project Settings → Data API → ensure "public" is in Exposed schemas → Save
--   • Then run this script again, or: Project Settings → General → Pause → Resume
-- =============================================================================

-- username: globally unique (see unique constraint); app normalizes to lowercase before save.
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

grant usage on schema public to anon, authenticated, service_role;
grant all on table public.profiles to anon, authenticated, service_role;

notify pgrst, 'reload schema';
