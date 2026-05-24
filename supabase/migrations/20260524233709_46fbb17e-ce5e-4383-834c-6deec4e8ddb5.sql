ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS bug_report text,
  ADD COLUMN IF NOT EXISTS plan jsonb,
  ADD COLUMN IF NOT EXISTS suspect_files text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS pr_is_draft boolean NOT NULL DEFAULT false;