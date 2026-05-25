ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_error text NULL,
  ADD COLUMN IF NOT EXISTS checks_status text NULL,
  ADD COLUMN IF NOT EXISTS checks_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_loops_next_run_at
  ON public.loops (next_run_at)
  WHERE status = 'running' AND phase_running = false;