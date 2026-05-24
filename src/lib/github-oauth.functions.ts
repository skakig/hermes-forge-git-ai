import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac } from "crypto";

function signState(userId: string, secret: string) {
  const nonce = Math.random().toString(36).slice(2, 10);
  const payload = `${userId}.${Date.now()}.${nonce}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export const startGithubOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID!;
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const origin =
      process.env.PUBLIC_APP_URL ?? "https://hermes-forge-git-ai.lovable.app";
    const redirectUri = `${origin}/auth/github/callback`;
    const state = signState(context.userId, secret);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "repo read:user");
    url.searchParams.set("state", state);
    url.searchParams.set("allow_signup", "false");
    return { url: url.toString() };
  });