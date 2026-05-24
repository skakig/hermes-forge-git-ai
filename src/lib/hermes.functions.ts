import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runPhase, type LoopRow, type RepoRow } from "./hermes.server";

async function getInstallationIdForUser(userId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("github_installations")
    .select("installation_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("no_installation: Install the Hermes GitHub App first.");
  return Number(data.installation_id);
}

export const startHermesLoop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        repository_id: z.string().uuid(),
        bug_report: z.string().max(4000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: repo, error: repoErr } = await supabase
      .from("repositories")
      .select("id, full_name, owner, name, default_branch")
      .eq("id", data.repository_id)
      .eq("user_id", userId)
      .single();
    if (repoErr || !repo) throw new Error("Repository not found");

    // Ensure installation exists up-front so we fail fast with a clear error.
    await getInstallationIdForUser(userId);

    const { data: goalsRows } = await supabase
      .from("goals")
      .select("label")
      .eq("user_id", userId)
      .eq("active", true);
    const goals = (goalsRows ?? []).map((g) => g.label);

    const { data: loop, error: loopErr } = await supabase
      .from("loops")
      .insert({
        user_id: userId,
        repository_id: repo.id,
        status: "running",
        phase: "audit",
        goals,
        bug_report: data.bug_report?.trim() || null,
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
      metadata: { goals, has_bug_report: !!data.bug_report },
    });

    return { loop_id: loop.id };
  });

export const pollLoopStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ loop_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: loop } = await supabase
      .from("loops")
      .select("id, user_id, repository_id, status, phase, branch, goals, bug_report, plan, suspect_files, pr_number, pr_url")
      .eq("id", data.loop_id)
      .eq("user_id", userId)
      .single();
    if (!loop) throw new Error("Loop not found");
    if (loop.status !== "running") return { loop };

    const { data: repo } = await supabase
      .from("repositories")
      .select("id, full_name, owner, name, default_branch")
      .eq("id", loop.repository_id)
      .single();
    if (!repo) throw new Error("Repository not found for loop");

    const installationId = await getInstallationIdForUser(userId);

    try {
      const patch = await runPhase({
        loop: loop as LoopRow,
        repo: repo as RepoRow,
        installationId,
      });
      const { message, comment_kind, ...dbPatch } = patch;
      if (Object.keys(dbPatch).length > 0) {
        await supabase.from("loops").update(dbPatch).eq("id", loop.id);
      }
      await supabaseAdmin.from("activity_events").insert({
        user_id: userId,
        loop_id: loop.id,
        repository_id: loop.repository_id,
        kind: comment_kind ?? "progress",
        message,
        metadata: { phase_from: loop.phase, phase_to: dbPatch.phase ?? loop.phase },
      });
      return { loop: { ...loop, ...dbPatch } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("loops")
        .update({ status: "failed", phase: "error", finished_at: new Date().toISOString() })
        .eq("id", loop.id);
      await supabaseAdmin.from("activity_events").insert({
        user_id: userId,
        loop_id: loop.id,
        repository_id: loop.repository_id,
        kind: "error",
        message: `Phase "${loop.phase}" failed: ${msg.slice(0, 240)}`,
      });
      throw new Error(`phase_failed: ${msg}`);
    }
  });

export const cancelLoop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ loop_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("loops")
      .update({ status: "canceled", phase: "canceled", finished_at: new Date().toISOString() })
      .eq("id", data.loop_id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("activity_events").insert({
      user_id: userId,
      loop_id: data.loop_id,
      kind: "warning",
      message: "Loop canceled by user",
    });
    return { ok: true };
  });

export const listLoops = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("loops")
      .select("id, status, phase, branch, pr_url, pr_number, started_at, finished_at, repository_id, goals, bug_report, plan, suspect_files, pr_is_draft")
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { loops: data ?? [] };
  });