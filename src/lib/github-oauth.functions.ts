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

    // GitHub App client IDs start with "Iv1." or "Iv23"/"Ov23".
    // Classic OAuth App client IDs are 20-char hex.
    const isGithubApp = /^(Iv1\.|Iv23|Ov23)/.test(clientId);

    if (isGithubApp) {
      const slug = process.env.GITHUB_APP_SLUG;
      if (!slug) {
        console.error("[github-oauth] GitHub App detected but GITHUB_APP_SLUG is not set", { clientIdPrefix: clientId.slice(0, 6) });
        throw new Error(
          "missing_app_slug: GitHub App credential detected but GITHUB_APP_SLUG secret is not configured.",
        );
      }
      // Install flow — user picks repos to grant the App access to,
      // then GitHub redirects back to the App's Setup URL (must be the callback).
      const url = new URL(`https://github.com/apps/${slug}/installations/new`);
      url.searchParams.set("state", state);
      console.log("[github-oauth] starting GitHub App install flow", { slug });
      return { url: url.toString() };
    }

    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "repo read:user");
    url.searchParams.set("state", state);
    url.searchParams.set("allow_signup", "false");
    console.log("[github-oauth] starting classic OAuth flow");
    return { url: url.toString() };
  });