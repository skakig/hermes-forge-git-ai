
-- Move github_access_token out of the user-readable profiles table
ALTER TABLE public.profiles DROP COLUMN IF EXISTS github_access_token;

CREATE TABLE public.user_github_credentials (
  user_id UUID PRIMARY KEY,
  access_token TEXT NOT NULL,
  github_username TEXT,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_github_credentials ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies — table is only reachable via service_role
-- (server-side code using supabaseAdmin). Authenticated/anon clients
-- cannot SELECT, INSERT, UPDATE or DELETE.

REVOKE ALL ON public.user_github_credentials FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_user_github_credentials_updated
  BEFORE UPDATE ON public.user_github_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
