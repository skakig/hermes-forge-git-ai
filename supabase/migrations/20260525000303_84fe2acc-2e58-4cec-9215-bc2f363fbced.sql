ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS phase_running boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phase_started_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_loops_phase_running ON public.loops (phase_running) WHERE phase_running = true;