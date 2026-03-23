-- Make calendar/declaration uniqueness strategy-scoped to prevent cross-strategy overwrites.
-- Run in Supabase Dashboard → SQL Editor → Run
-- Safe to re-run.

-- Remove legacy uniques that ignored strategy_id.
alter table public.daily_results drop constraint if exists daily_results_user_id_date_key_instrument_key;
alter table public.declarations drop constraint if exists declarations_user_id_date_key_instrument_key;

-- Default strategy rows (strategy_id is null) keep one row per user/date/instrument.
create unique index if not exists daily_results_default_unique_idx
  on public.daily_results (user_id, date_key, instrument)
  where strategy_id is null;

create unique index if not exists declarations_default_unique_idx
  on public.declarations (user_id, date_key, instrument)
  where strategy_id is null;

-- Non-default strategy rows are unique by strategy as well.
create unique index if not exists daily_results_strategy_unique_idx
  on public.daily_results (user_id, strategy_id, date_key, instrument)
  where strategy_id is not null;

create unique index if not exists declarations_strategy_unique_idx
  on public.declarations (user_id, strategy_id, date_key, instrument)
  where strategy_id is not null;

notify pgrst, 'reload schema';

