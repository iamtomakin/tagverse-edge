-- Add journal vocabulary to profiles (if you already ran supabase-profiles-setup.sql before this column existed).
-- Supabase Dashboard → SQL Editor → Run.

alter table public.profiles add column if not exists journal_options jsonb;

notify pgrst, 'reload schema';
