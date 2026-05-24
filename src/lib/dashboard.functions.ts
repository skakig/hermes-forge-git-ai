import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [active, openPRs, repos, weekly] = await Promise.all([
      supabase.from("loops").select("id", { count: "exact", head: true }).eq("status", "running"),
      supabase.from("loops").select("id", { count: "exact", head: true }).not("pr_url", "is", null).neq("status", "merged"),
      supabase.from("repositories").select("id", { count: "exact", head: true }),
      supabase.from("activity_events").select("id", { count: "exact", head: true }).gte("created_at", since),
    ]);
    return {
      activeLoops: active.count ?? 0,
      openPRs: openPRs.count ?? 0,
      reposConnected: repos.count ?? 0,
      improvementsThisWeek: weekly.count ?? 0,
    };
  });

export const listActivityEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("activity_events")
      .select("id, kind, message, created_at, metadata")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { events: data ?? [] };
  });

export const listPullRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("loops")
      .select("id, pr_url, pr_number, branch, status, started_at, repository_id")
      .not("pr_url", "is", null)
      .order("started_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return { prs: data ?? [] };
  });

export const listGoals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("goals")
      .select("id, label, active, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { goals: data ?? [] };
  });

export const upsertGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        label: z.string().min(1).max(255),
        active: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { error } = await supabase
        .from("goals")
        .update({ label: data.label, active: data.active ?? true })
        .eq("id", data.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabase
      .from("goals")
      .insert({ user_id: userId, label: data.label, active: data.active ?? true })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const toggleGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("goals")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("goals")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listConnectedRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("repositories")
      .select("id, full_name, owner, name, default_branch, private, status, last_loop_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { repos: data ?? [] };
  });