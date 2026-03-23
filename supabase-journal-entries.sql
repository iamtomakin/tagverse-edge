-- Daily Log (Notion-style journal): synced across devices
-- Run in Supabase Dashboard → SQL Editor → Run
-- Safe to re-run.

-- Store one row per journal entry id (text id from the client).
create table if not exists public.journal_entries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id text not null,
  date_key text not null,
  title text not null,
  categories jsonb,
  emotions jsonb,
  risk_type text,
  setup_before text,
  setup_after text,
  image_before text,
  image_after text,
  note text,
  tags jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.journal_entries enable row level security;

drop policy if exists "Users can read own journal entries" on public.journal_entries;
create policy "Users can read own journal entries"
  on public.journal_entries for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own journal entries" on public.journal_entries;
create policy "Users can insert own journal entries"
  on public.journal_entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own journal entries" on public.journal_entries;
create policy "Users can update own journal entries"
  on public.journal_entries for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own journal entries" on public.journal_entries;
create policy "Users can delete own journal entries"
  on public.journal_entries for delete
  using (auth.uid() = user_id);

-- Helpful for queries by strategy / date.
create index if not exists journal_entries_user_strategy_date_idx
  on public.journal_entries (user_id, strategy_id, date_key);

grant usage on schema public to anon, authenticated, service_role;
grant all on table public.journal_entries to anon, authenticated, service_role;

notify pgrst, 'reload schema';

