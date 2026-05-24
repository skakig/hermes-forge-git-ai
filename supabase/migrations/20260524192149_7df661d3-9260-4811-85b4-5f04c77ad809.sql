
-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  github_username TEXT,
  github_access_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own profile delete" ON public.profiles FOR DELETE USING (auth.uid() = user_id);

-- Repositories
CREATE TABLE public.repositories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  github_id BIGINT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  private BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'idle',
  last_loop_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, full_name)
);
ALTER TABLE public.repositories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own repos select" ON public.repositories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own repos insert" ON public.repositories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own repos update" ON public.repositories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own repos delete" ON public.repositories FOR DELETE USING (auth.uid() = user_id);

-- Loops
CREATE TABLE public.loops (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  repository_id UUID NOT NULL REFERENCES public.repositories(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT NOT NULL DEFAULT 'queued',
  goals TEXT[] NOT NULL DEFAULT '{}',
  branch TEXT,
  pr_url TEXT,
  pr_number INT,
  hermes_run_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.loops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own loops select" ON public.loops FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own loops insert" ON public.loops FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own loops update" ON public.loops FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own loops delete" ON public.loops FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_loops_user_started ON public.loops (user_id, started_at DESC);

-- Activity events
CREATE TABLE public.activity_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  repository_id UUID REFERENCES public.repositories(id) ON DELETE CASCADE,
  loop_id UUID REFERENCES public.loops(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events select" ON public.activity_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own events insert" ON public.activity_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own events delete" ON public.activity_events FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_events_user_created ON public.activity_events (user_id, created_at DESC);

-- Goals
CREATE TABLE public.goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own goals select" ON public.goals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own goals insert" ON public.goals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own goals update" ON public.goals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own goals delete" ON public.goals FOR DELETE USING (auth.uid() = user_id);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_repos_updated BEFORE UPDATE ON public.repositories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_loops_updated BEFORE UPDATE ON public.loops
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
