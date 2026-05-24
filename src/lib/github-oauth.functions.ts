import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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

export type GithubRepoDTO = {
  id: number;
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  default_branch: string;
  stargazers_count: number;
  open_issues_count: number;
  updated_at: string | null;
};

export const listGithubRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: cred, error: credErr } = await supabaseAdmin
      .from("user_github_credentials")
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (credErr) {
      console.error("[list-github-repos] credentials lookup failed", credErr);
      return { repos: [] as GithubRepoDTO[], notConnected: false, tokenInvalid: false, error: "lookup_failed" as const };
    }
    if (!cred?.access_token) {
      return { repos: [] as GithubRepoDTO[], notConnected: true, tokenInvalid: false, error: null };
    }

    const res = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
      {
        headers: {
          Authorization: `Bearer ${cred.access_token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "hermes-forge",
        },
      },
    );

    if (res.status === 401) {
      return { repos: [] as GithubRepoDTO[], notConnected: false, tokenInvalid: true, error: "unauthorized" as const };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[list-github-repos] github error", { status: res.status, body });
      return { repos: [] as GithubRepoDTO[], notConnected: false, tokenInvalid: false, error: `github_${res.status}` };
    }

    const json = (await res.json()) as Array<{
      id: number;
      name: string;
      full_name: string;
      owner: { login: string };
      private: boolean;
      default_branch: string;
      stargazers_count: number;
      open_issues_count: number;
      updated_at: string | null;
    }>;

    const repos: GithubRepoDTO[] = json.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      owner: r.owner.login,
      private: r.private,
      default_branch: r.default_branch,
      stargazers_count: r.stargazers_count,
      open_issues_count: r.open_issues_count,
      updated_at: r.updated_at,
    }));

    return { repos, notConnected: false, tokenInvalid: false, error: null };
  });