CREATE TABLE public.github_installations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  installation_id bigint NOT NULL,
  account_login text NOT NULL,
  account_type text NOT NULL DEFAULT 'User',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, installation_id)
);

ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own installations select" ON public.github_installations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own installations insert" ON public.github_installations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own installations update" ON public.github_installations
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own installations delete" ON public.github_installations
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_github_installations_updated_at
  BEFORE UPDATE ON public.github_installations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_github_installations_user ON public.github_installations(user_id);