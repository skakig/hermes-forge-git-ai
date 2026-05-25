
-- 1) Remove all RLS policies on user_github_credentials (deny-all from client; server uses service role)
DROP POLICY IF EXISTS "own github credentials select" ON public.user_github_credentials;
DROP POLICY IF EXISTS "own github credentials insert" ON public.user_github_credentials;
DROP POLICY IF EXISTS "own github credentials update" ON public.user_github_credentials;
DROP POLICY IF EXISTS "own github credentials delete" ON public.user_github_credentials;
ALTER TABLE public.user_github_credentials ENABLE ROW LEVEL SECURITY;

-- 2) Restrict Realtime channel subscriptions
-- Topic convention: "user:<auth.uid()>" for per-user activity event broadcasts
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can subscribe to own topic" ON realtime.messages;
CREATE POLICY "Authenticated users can subscribe to own topic"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() = 'user:' || auth.uid()::text
);

DROP POLICY IF EXISTS "Authenticated users can broadcast to own topic" ON realtime.messages;
CREATE POLICY "Authenticated users can broadcast to own topic"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() = 'user:' || auth.uid()::text
);
