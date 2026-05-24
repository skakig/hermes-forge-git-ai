import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getInstallationToken } from "@/lib/github-app.server";

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
    if (!Number.isFinite(ts) || Date.now() - ts > 30 * 60 * 1000) return null;
    return userId;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/github/install/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const installationIdStr = url.searchParams.get("installation_id");
        const setupAction = url.searchParams.get("setup_action");
        const state = url.searchParams.get("state");
        const origin =
          process.env.PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;

        if (!installationIdStr) {
          console.error("[github-install-cb] missing installation_id", { url: request.url });
          return Response.redirect(`${origin}/dashboard/repos?error=missing_installation`, 302);
        }
        const installationId = Number(installationIdStr);
        if (!Number.isFinite(installationId)) {
          return Response.redirect(`${origin}/dashboard/repos?error=bad_installation`, 302);
        }

        if (!state) {
          console.error("[github-install-cb] missing state — user must start install from the dashboard");
          return Response.redirect(`${origin}/dashboard/repos?error=missing_state`, 302);
        }
        const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const userId = verifyState(state, secret);
        if (!userId) {
          console.error("[github-install-cb] bad state");
          return Response.redirect(`${origin}/dashboard/repos?error=bad_state`, 302);
        }

        // Look up the installation's account to store a friendly label.
        let accountLogin = "unknown";
        let accountType = "User";
        try {
          // Use the installation token endpoint indirectly: fetch /app/installations/{id}
          // via the App JWT. Easiest path: mint a token and call /installation/repositories
          // — but for the account label we want /app/installations/{id} which needs the JWT.
          // To keep this file small we just hit /installation/repositories with the token
          // and derive owner from the first repo, falling back to "installation".
          await getInstallationToken(installationId);
          const probe = await fetch(
            `https://api.github.com/installation/repositories?per_page=1`,
            {
              headers: {
                Authorization: `Bearer ${await getInstallationToken(installationId)}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "hermes-forge",
              },
            },
          );
          if (probe.ok) {
            const j = (await probe.json()) as {
              repositories?: Array<{ owner?: { login?: string; type?: string } }>;
            };
            const o = j.repositories?.[0]?.owner;
            if (o?.login) accountLogin = o.login;
            if (o?.type) accountType = o.type;
          }
        } catch (e) {
          console.error("[github-install-cb] probe failed", e);
        }

        if (setupAction === "request") {
          // org admin requested approval — installation isn't live yet
          return Response.redirect(`${origin}/dashboard/repos?error=install_pending`, 302);
        }

        const { error } = await supabaseAdmin
          .from("github_installations")
          .upsert(
            {
              user_id: userId,
              installation_id: installationId,
              account_login: accountLogin,
              account_type: accountType,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,installation_id" },
          );
        if (error) {
          console.error("[github-install-cb] store failed", error);
          return Response.redirect(`${origin}/dashboard/repos?error=store`, 302);
        }

        return Response.redirect(`${origin}/dashboard/repos?installed=1`, 302);
      },
    },
  },
});