import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { advanceLoopOnce } from "./hermes.server";

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
    // Verify ownership first.
    const { data: owned } = await supabase
      .from("loops")
      .select("id")
      .eq("id", data.loop_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!owned) throw new Error("Loop not found");

    // Auto-chain phases (each one acquires its own lock + advances once).
    const MAX_PHASES_PER_POLL = 4;
    const MAX_WALL_MS = 25_000;
    const startTs = Date.now();
    let loop = null;
    for (let i = 0; i < MAX_PHASES_PER_POLL; i++) {
      if (Date.now() - startTs > MAX_WALL_MS) break;
      const res = await advanceLoopOnce(data.loop_id);
      loop = res.loop;
      if (!res.advanced) break;
      if (loop?.status !== "running") break;
    }
    return { loop };
  });

export const resumeLoop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ loop_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // Owner check.
    const { data: row } = await supabase
      .from("loops")
      .select("id, status, phase, pr_number")
      .eq("id", data.loop_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) throw new Error("Loop not found");
    // Resume: rewind to checks_pending if we have a PR, else diagnose.
    const newPhase = row.pr_number ? "checks_pending" : "audit";
    const { error } = await supabaseAdmin
      .from("loops")
      .update({
        status: "running",
        phase: newPhase,
        phase_running: false,
        last_error: null,
        finished_at: null,
        next_run_at: new Date().toISOString(),
      })
      .eq("id", data.loop_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("activity_events").insert({
      user_id: userId,
      loop_id: data.loop_id,
      kind: "progress",
      message: `Loop resumed at phase "${newPhase}"`,
    });
    return { ok: true };
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
      .select("id, status, phase, branch, pr_url, pr_number, started_at, finished_at, repository_id, goals, bug_report, plan, suspect_files, pr_is_draft, attempt_count, max_attempts, last_error, checks_status, checks_payload")
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { loops: data ?? [] };
  });

// Reports which optional research capabilities are wired up so the UI can
// nudge the user to connect Firecrawl for web-verified rules briefs.
export const getHermesCapabilities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return {
      firecrawl: !!process.env.FIRECRAWL_API_KEY && !!process.env.LOVABLE_API_KEY,
    };
  });