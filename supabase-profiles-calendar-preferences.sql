-- Which instrument + strategy the calendar shows (synced across devices when signed in).
-- Supabase Dashboard → SQL Editor → Run (safe to re-run).

alter table public.profiles add column if not exists calendar_preferences jsonb;

notify pgrst, 'reload schema';
