import { createFileRoute, redirect } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function verifyState(state: string, secret: string): string | null {
  try {
    const [b64, sig] = state.split(".");
    if (!b64 || !sig) return null;
    const payload = Buffer.from(b64, "base64url").toString();
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [userId, tsStr] = payload.split(".");
    if (!userId || !tsStr) return null;
    const ts = Number(tsStr);
    if (!Number.isFinite(ts) || Date.now() - ts > 10 * 60 * 1000) return null;
    return userId;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/auth/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const origin =
          process.env.PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;

        if (!code || !state) {
          return Response.redirect(`${origin}/dashboard/repos?error=missing_code`, 302);
        }

        const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const userId = verifyState(state, secret);
        if (!userId) {
          return Response.redirect(`${origin}/dashboard/repos?error=bad_state`, 302);
        }

        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
            client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
            code,
            redirect_uri: `${origin}/auth/github/callback`,
          }),
        });
        const tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          scope?: string;
          error?: string;
        };
        if (!tokenJson.access_token) {
          console.error("GitHub token exchange failed", tokenJson);
          return Response.redirect(`${origin}/dashboard/repos?error=token_exchange`, 302);
        }

        const userRes = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${tokenJson.access_token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "hermes-forge",
          },
        });
        const userJson = (await userRes.json()) as { login?: string };

        const { error } = await supabaseAdmin
          .from("user_github_credentials")
          .upsert(
            {
              user_id: userId,
              access_token: tokenJson.access_token,
              scope: tokenJson.scope ?? null,
              github_username: userJson.login ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (error) {
          console.error("Failed to store github credentials", error);
          return Response.redirect(`${origin}/dashboard/repos?error=store`, 302);
        }

        if (userJson.login) {
          await supabaseAdmin
            .from("profiles")
            .update({ github_username: userJson.login })
            .eq("user_id", userId);
        }

        return Response.redirect(`${origin}/dashboard/repos?connected=1`, 302);
      },
    },
  },
});