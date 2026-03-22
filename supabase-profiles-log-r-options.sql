-- Calendar log modal: configurable R values (JSON array of numbers), synced with profile when signed in.
-- Supabase Dashboard → SQL Editor → Run (safe to re-run).

alter table public.profiles add column if not exists log_r_options jsonb;

notify pgrst, 'reload schema';
