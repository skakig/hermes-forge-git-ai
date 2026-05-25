CREATE SCHEMA IF NOT EXISTS extensions;
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

CREATE POLICY "own github credentials select"
  ON public.user_github_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own github credentials insert"
  ON public.user_github_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own github credentials update"
  ON public.user_github_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "own github credentials delete"
  ON public.user_github_credentials FOR DELETE
  USING (auth.uid() = user_id);