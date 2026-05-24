import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  fetchInstallationRepos,
  getInstallationToken,
  listAllAppInstallations,
  type AppInstallationDTO,
  type InstallationRepoDTO,
} from "./github-app.server";

export const getGithubConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id, account_login, account_type, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[github-app] connection lookup failed", error);
      return { installation: null as null | {
        installation_id: number; account_login: string; account_type: string;
      } };
    }
    return {
      installation: data
        ? {
            installation_id: Number(data.installation_id),
            account_login: data.account_login,
            account_type: data.account_type,
          }
        : null,
    };
  });

export const listInstallationRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: install } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!install) {
      return { repos: [] as InstallationRepoDTO[], notInstalled: true, error: null as string | null };
    }

    try {
      const repos = await fetchInstallationRepos(Number(install.installation_id));
      return { repos, notInstalled: false, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[github-app] fetch repos failed", msg);
      return { repos: [] as InstallationRepoDTO[], notInstalled: false, error: msg };
    }
  });

export const addRepoToForge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        github_id: z.number(),
        full_name: z.string().min(1).max(255),
        name: z.string().min(1).max(255),
        owner: z.string().min(1).max(255),
        private: z.boolean(),
        default_branch: z.string().min(1).max(255),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: existing } = await supabase
      .from("repositories")
      .select("id")
      .eq("user_id", context.userId)
      .eq("github_id", data.github_id)
      .maybeSingle();
    if (existing) return { id: existing.id, added: false };

    const { data: row, error } = await supabase
      .from("repositories")
      .insert({
        user_id: context.userId,
        github_id: data.github_id,
        full_name: data.full_name,
        name: data.name,
        owner: data.owner,
        private: data.private,
        default_branch: data.default_branch,
        status: "idle",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, added: true };
  });

export const removeRepoFromForge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("repositories")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Called by /dashboard/repos after GitHub redirects back from the App
// install/setup flow with ?pending_install=<id>. We identify the user via
// their Supabase session instead of relying on a signed `state` (GitHub
// doesn't always forward it on installation redirects).
export const recordInstallation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ installation_id: z.number().int().positive() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    let accountLogin = "unknown";
    let accountType = "User";
    try {
      const token = await getInstallationToken(data.installation_id);
      const probe = await fetch(
        "https://api.github.com/installation/repositories?per_page=1",
        {
          headers: {
            Authorization: `Bearer ${token}`,
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
      } else {
        const text = await probe.text().catch(() => "");
        console.error("[record-installation] probe failed", probe.status, text);
      }
    } catch (e) {
      console.error("[record-installation] token/probe error", e);
    }

    const { error } = await supabaseAdmin
      .from("github_installations")
      .upsert(
        {
          user_id: context.userId,
          installation_id: data.installation_id,
          account_login: accountLogin,
          account_type: accountType,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,installation_id" },
      );
    if (error) {
      console.error("[record-installation] upsert failed", error);
      throw new Error(error.message);
    }
    return { ok: true as const, account_login: accountLogin };
  });

// Reconcile: list every installation the App itself can see (via App JWT),
// optionally filtered to the ones whose account.login matches the current
// user's github_username. This is the fallback when the install-redirect
// handoff lost the `installation_id` (user wasn't logged in, browser
// killed the tab, GitHub didn't forward it, etc).
export const listAppInstallations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("github_username")
      .eq("user_id", context.userId)
      .maybeSingle();
    const githubUsername = profile?.github_username ?? null;

    let all: AppInstallationDTO[] = [];
    try {
      all = await listAllAppInstallations();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[list-app-installations] failed", msg);
      return {
        installations: [] as AppInstallationDTO[],
        already_claimed_ids: [] as number[],
        github_username: githubUsername,
        error: msg,
      };
    }

    const { data: claimed } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id, user_id");
    const claimedSet = new Set(
      (claimed ?? []).map((c) => Number(c.installation_id)),
    );

    return {
      installations: all,
      already_claimed_ids: Array.from(claimedSet),
      github_username: githubUsername,
      error: null as string | null,
    };
  });

export const claimInstallation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ installation_id: z.number().int().positive() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    // Refuse to steal an installation already linked to a different user.
    const { data: existing } = await supabaseAdmin
      .from("github_installations")
      .select("user_id")
      .eq("installation_id", data.installation_id)
      .maybeSingle();
    if (existing && existing.user_id !== context.userId) {
      throw new Error("installation_already_claimed");
    }

    // Verify the App can still see this installation and grab its account.
    const all = await listAllAppInstallations();
    const match = all.find((i) => i.installation_id === data.installation_id);
    if (!match) throw new Error("installation_not_found");

    const { error } = await supabaseAdmin
      .from("github_installations")
      .upsert(
        {
          user_id: context.userId,
          installation_id: data.installation_id,
          account_login: match.account_login,
          account_type: match.account_type,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,installation_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const, account_login: match.account_login };
  });

// Health probe — verifies Hermes can (1) read the installation row,
// (2) mint an installation access token via the App's private key/JWT,
// and (3) call GitHub's /installation/repositories endpoint with that token.
// Returns a structured result so the UI can show clear, actionable errors.
export type InstallationHealth = {
  ok: boolean;
  checkedAt: string;
  steps: {
    record: { ok: boolean; message: string };
    token: { ok: boolean; message: string };
    repos: { ok: boolean; message: string; count?: number };
  };
  installation_id?: number;
  account_login?: string;
};

export const checkInstallationHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InstallationHealth> => {
    const checkedAt = new Date().toISOString();
    const steps: InstallationHealth["steps"] = {
      record: { ok: false, message: "Not checked" },
      token: { ok: false, message: "Not checked" },
      repos: { ok: false, message: "Not checked" },
    };

    const { data: install, error: dbErr } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id, account_login")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbErr) {
      steps.record.message = `Database error: ${dbErr.message}`;
      return { ok: false, checkedAt, steps };
    }
    if (!install) {
      steps.record.message = "No GitHub App installation found for this account.";
      return { ok: false, checkedAt, steps };
    }
    const installationId = Number(install.installation_id);
    steps.record.ok = true;
    steps.record.message = `Linked to installation #${installationId} (${install.account_login}).`;

    let token: string;
    try {
      token = await getInstallationToken(installationId);
      steps.token.ok = true;
      steps.token.message = "Minted a fresh installation access token.";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("missing_private_key")) {
        steps.token.message = "GITHUB_APP_PRIVATE_KEY secret is not configured.";
      } else if (msg.includes("missing_app_id")) {
        steps.token.message = "GITHUB_APP_ID secret is not configured.";
      } else if (msg.includes("installation_token_failed")) {
        steps.token.message = `GitHub rejected the App JWT: ${msg.replace("installation_token_failed: ", "")}. The App may have been uninstalled or its private key rotated.`;
      } else {
        steps.token.message = `Token mint failed: ${msg}`;
      }
      return {
        ok: false,
        checkedAt,
        steps,
        installation_id: installationId,
        account_login: install.account_login,
      };
    }

    try {
      const res = await fetch(
        "https://api.github.com/installation/repositories?per_page=1",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "hermes-forge",
          },
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        steps.repos.message = `GitHub returned ${res.status}: ${text.slice(0, 200) || res.statusText}`;
        return {
          ok: false,
          checkedAt,
          steps,
          installation_id: installationId,
          account_login: install.account_login,
        };
      }
      const json = (await res.json()) as { total_count?: number; repositories?: unknown[] };
      const count = json.total_count ?? json.repositories?.length ?? 0;
      steps.repos.ok = true;
      steps.repos.count = count;
      steps.repos.message =
        count > 0
          ? `GitHub returned ${count} accessible repository${count === 1 ? "" : "ies"}.`
          : "Connected, but the App has no repositories granted yet. Open GitHub → Settings → Applications and grant access.";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      steps.repos.message = `Network error calling GitHub: ${msg}`;
      return {
        ok: false,
        checkedAt,
        steps,
        installation_id: installationId,
        account_login: install.account_login,
      };
    }

    return {
      ok: steps.record.ok && steps.token.ok && steps.repos.ok,
      checkedAt,
      steps,
      installation_id: installationId,
      account_login: install.account_login,
    };
  });
