import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getInstallationToken } from "./github-app.server";
import { hermes } from "./hermes.server";

export const startHermesLoop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ repository_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: repo, error: repoErr } = await supabase
      .from("repositories")
      .select("id, full_name, default_branch")
      .eq("id", data.repository_id)
      .eq("user_id", userId)
      .single();
    if (repoErr || !repo) throw new Error("Repository not found");

    const { data: install } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!install) throw new Error("No GitHub App installation found. Install the app first.");

    const { data: goalsRows } = await supabase
      .from("goals")
      .select("label")
      .eq("user_id", userId)
      .eq("active", true);
    const goals = (goalsRows ?? []).map((g) => g.label);
    if (goals.length === 0) goals.push("Improve code quality and documentation");

    const { data: loop, error: loopErr } = await supabase
      .from("loops")
      .insert({
        user_id: userId,
        repository_id: repo.id,
        status: "running",
        phase: "starting",
        goals,
        branch: `forge/auto-${Date.now()}`,
      })
      .select("id")
      .single();
    if (loopErr) throw new Error(loopErr.message);

    await supabaseAdmin.from("activity_events").insert({
      user_id: userId,
      loop_id: loop.id,
      repository_id: repo.id,
      kind: "loop_started",
      message: `Ignited loop on ${repo.full_name}`,
      metadata: { goals },
    });

    try {
      const installationToken = await getInstallationToken(Number(install.installation_id));
      const result = (await hermes.startLoop({
        repoFullName: repo.full_name,
        githubToken: installationToken,
        goals,
        branch: repo.default_branch,
      })) as { run_id?: string; id?: string };
      const runId = result.run_id ?? result.id ?? null;
      if (runId) {
        await supabase
          .from("loops")
          .update({ hermes_run_id: runId, phase: "auditing" })
          .eq("id", loop.id);
      }
      return { loop_id: loop.id, hermes_run_id: runId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("loops")
        .update({ status: "failed", phase: "error", finished_at: new Date().toISOString() })
        .eq("id", loop.id);
      await supabaseAdmin.from("activity_events").insert({
        user_id: userId,
        loop_id: loop.id,
        repository_id: repo.id,
        kind: "error",
        message: `Failed to start Hermes loop: ${msg}`,
      });
      throw new Error(`hermes_start_failed: ${msg}`);
    }
  });

export const pollLoopStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ loop_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: loop } = await supabase
      .from("loops")
      .select("id, hermes_run_id, status, phase, repository_id")
      .eq("id", data.loop_id)
      .eq("user_id", userId)
      .single();
    if (!loop) throw new Error("Loop not found");
    if (!loop.hermes_run_id || loop.status === "completed" || loop.status === "failed") {
      return { loop };
    }
    try {
      const remote = (await hermes.getLoop(loop.hermes_run_id)) as {
        phase?: string;
        status?: string;
        pr_url?: string;
        pr_number?: number;
        message?: string;
      };
      const patch: {
        phase?: string;
        status?: string;
        pr_url?: string;
        pr_number?: number;
        finished_at?: string;
      } = {};
      if (remote.phase && remote.phase !== loop.phase) patch.phase = remote.phase;
      if (remote.status && remote.status !== loop.status) patch.status = remote.status;
      if (remote.pr_url) patch.pr_url = remote.pr_url;
      if (typeof remote.pr_number === "number") patch.pr_number = remote.pr_number;
      if (remote.status === "completed" || remote.status === "failed") {
        patch.finished_at = new Date().toISOString();
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from("loops").update(patch).eq("id", loop.id);
      }
      if (remote.message) {
        await supabaseAdmin.from("activity_events").insert({
          user_id: userId,
          loop_id: loop.id,
          repository_id: loop.repository_id,
          kind: remote.status === "failed" ? "error" : "progress",
          message: remote.message,
        });
      }
      return { loop: { ...loop, ...patch } };
    } catch (e) {
      console.error("[hermes-poll] failed", e);
      return { loop };
    }
  });

export const listLoops = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("loops")
      .select("id, status, phase, branch, pr_url, pr_number, started_at, finished_at, repository_id, goals")
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { loops: data ?? [] };
  });