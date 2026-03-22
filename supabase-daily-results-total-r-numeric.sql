-- Allow fractional R in daily_results (matches in-app formatR + log modal custom values).
-- Supabase Dashboard → SQL Editor → Run (safe to re-run).

alter table public.daily_results
  alter column total_r type numeric using total_r::numeric;

alter table public.daily_results
  alter column trade_1_r type numeric using trade_1_r::numeric;

notify pgrst, 'reload schema';
