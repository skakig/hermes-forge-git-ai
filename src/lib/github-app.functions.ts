import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchInstallationRepos, getInstallationToken, type InstallationRepoDTO } from "./github-app.server";

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