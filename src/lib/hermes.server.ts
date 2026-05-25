// In-app Hermes agent. Runs as discrete phases, one per server-fn call.
// Uses Lovable AI Gateway for reasoning + GitHub REST/GraphQL for code ops.

import {
  getInstallationToken,
  getBranchHeadSha,
  listRepoTree,
  getFileContents,
  createBranch,
  putFile,
  createPullRequest,
  addPRComment,
  markPRReadyForReview,
  listPRChecks,
  collectFailureLogs,
  type FailureLog,
  type RepoTreeEntry,
} from "./github-app.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-pro";

type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string };

async function callAI(opts: {
  messages: ChatMessage[];
  model?: string;
  tool?: { name: string; description: string; parameters: Record<string, unknown> };
}): Promise<{ text: string | null; tool: Record<string, unknown> | null }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("missing_lovable_api_key: LOVABLE_API_KEY not configured");
  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_MODEL,
    messages: opts.messages,
  };
  if (opts.tool) {
    body.tools = [{ type: "function", function: opts.tool }];
    body.tool_choice = { type: "function", function: { name: opts.tool.name } };
  }
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("ai_rate_limited: Lovable AI is rate-limiting this workspace; try again in a minute.");
  if (res.status === 402) throw new Error("ai_credits_exhausted: Lovable AI credits are exhausted. Top up at Settings → Workspace → Usage.");
  if (!res.ok) throw new Error(`ai_${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
  const json = (await res.json()) as {
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: Array<{ function: { name: string; arguments: string } }>;
      };
    }>;
  };
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error("ai_empty_response");
  const call = msg.tool_calls?.[0];
  if (call) {
    try {
      return { text: msg.content ?? null, tool: JSON.parse(call.function.arguments) };
    } catch {
      throw new Error("ai_tool_args_invalid_json");
    }
  }
  return { text: msg.content ?? null, tool: null };
}

// ---------------------------------------------------------------------------
// File-ranking heuristics: pick interesting source files for the AI to look at.
// ---------------------------------------------------------------------------

const SOURCE_EXT = new RegExp(
  "\\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|md|mdx|sol|sql|toml|yaml|yml|json)$",
  "i",
);
const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.next|\.turbo|\.vercel|\.cache|coverage|out|vendor|\.git|\.venv|__pycache__|target)(\/|$)/i;
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|bun\.lock|Cargo\.lock|composer\.lock|poetry\.lock)$/i;

function filterSourceFiles(tree: RepoTreeEntry[]): RepoTreeEntry[] {
  return tree
    .filter((e) => e.type === "blob")
    .filter((e) => SOURCE_EXT.test(e.path))
    .filter((e) => !SKIP_DIR.test(e.path))
    .filter((e) => !SKIP_FILE.test(e.path))
    .filter((e) => (e.size ?? 0) < 200_000);
}

// ---------------------------------------------------------------------------
// Phase runners. Each returns the patch to apply to the loop row.
// ---------------------------------------------------------------------------

export type LoopRow = {
  id: string;
  user_id: string;
  repository_id: string;
  status: string;
  phase: string;
  branch: string | null;
  goals: string[];
  bug_report: string | null;
  plan: { summary?: string; hypothesis?: string; suspect_files?: string[]; proposed_change?: string; risk?: string } | null;
  suspect_files: string[];
  pr_number: number | null;
  pr_url: string | null;
  attempt_count?: number;
  max_attempts?: number;
  checks_status?: string | null;
  checks_payload?: import("@/integrations/supabase/types").Json | null;
};

export type RepoRow = {
  id: string;
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
};

export type PhasePatch = {
  phase?: string;
  status?: string;
  branch?: string;
  plan?: LoopRow["plan"];
  suspect_files?: string[];
  pr_number?: number;
  pr_url?: string;
  pr_is_draft?: boolean;
  finished_at?: string;
  attempt_count?: number;
  last_error?: string | null;
  checks_status?: string | null;
  checks_payload?: import("@/integrations/supabase/types").Json;
  next_run_at?: string | null;
  message: string;
  comment_kind?: "progress" | "pr_opened" | "completed" | "error";
};

type PhaseCtx = {
  loop: LoopRow;
  repo: RepoRow;
  installationId: number;
};

export async function runPhase(ctx: PhaseCtx): Promise<PhasePatch> {
  const token = await getInstallationToken(ctx.installationId);
  switch (ctx.loop.phase) {
    case "queued":
    case "starting":
    case "audit":
      return runAudit(ctx, token);
    case "plan":
      return runPlan(ctx);
    case "draft_pr":
      return runDraftPr(ctx, token);
    case "patch":
      return runPatch(ctx, token);
    case "commit":
      return runCommit(ctx, token);
    case "ready":
      return runReady(ctx, token);
    case "checks_pending":
      return runChecksPending(ctx, token);
    case "diagnose_failure":
      return runDiagnoseFailure(ctx);
    case "repair_patch":
      return runPatch(ctx, token);
    default:
      return { message: `Phase "${ctx.loop.phase}" has no runner.`, comment_kind: "progress" };
  }
}

async function runAudit(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const { repo } = ctx;
  const tree = await listRepoTree(token, repo.owner, repo.name, repo.default_branch);
  const sourceFiles = filterSourceFiles(tree.tree);
  // Cap paths sent to AI to keep token usage reasonable.
  const paths = sourceFiles.slice(0, 400).map((f) => f.path);
  const readme = await getFileContents(token, repo.owner, repo.name, "README.md", repo.default_branch);
  const pkg = await getFileContents(token, repo.owner, repo.name, "package.json", repo.default_branch);

  const ai = await callAI({
    messages: [
      {
        role: "system",
        content:
          "You are Hermes, an autonomous code-improvement agent. You are auditing a GitHub repository to understand its purpose, stack, and structure. Reply with a tight 5-8 sentence brief. Be specific about likely entry points and where business logic lives.",
      },
      {
        role: "user",
        content: [
          `Repository: ${repo.full_name}`,
          `Default branch: ${repo.default_branch}`,
          ``,
          `README.md (first 4000 chars):`,
          readme?.content?.slice(0, 4000) ?? "(no README)",
          ``,
          `package.json:`,
          pkg?.content?.slice(0, 3000) ?? "(no package.json)",
          ``,
          `Source file paths (${paths.length}${tree.truncated ? ", tree truncated" : ""}):`,
          paths.join("\n"),
        ].join("\n"),
      },
    ],
  });
  const summary = (ai.text ?? "").trim() || "No summary produced.";
  return {
    phase: "plan",
    plan: { summary, ...(ctx.loop.plan ?? {}) },
    message: `Audit complete · ${paths.length} source files reviewed`,
    comment_kind: "progress",
  };
}

async function runPlan(ctx: PhaseCtx): Promise<PhasePatch> {
  const goals = ctx.loop.goals.length ? ctx.loop.goals.join("\n- ") : "Improve overall code quality.";
  const bug = ctx.loop.bug_report?.trim();
  const ai = await callAI({
    messages: [
      {
        role: "system",
        content:
          "You are Hermes. Given a repo brief, a user bug report, and active goals, propose ONE focused improvement that can ship in a small pull request. Identify the most likely suspect files (max 5) by path. Be concrete about the change.",
      },
      {
        role: "user",
        content: [
          `Repo brief:\n${ctx.loop.plan?.summary ?? "(none)"}`,
          ``,
          `Active goals:\n- ${goals}`,
          ``,
          bug ? `Bug report / instructions from the user:\n${bug}` : `(no specific bug report; investigate the goals)`,
        ].join("\n"),
      },
    ],
    tool: {
      name: "submit_plan",
      description: "Submit a focused improvement plan for the repository.",
      parameters: {
        type: "object",
        properties: {
          hypothesis: { type: "string", description: "Short hypothesis about the issue / opportunity." },
          suspect_files: {
            type: "array",
            items: { type: "string" },
            description: "Up to 5 source file paths (repo-relative) you intend to inspect or modify.",
          },
          proposed_change: { type: "string", description: "Plain-English description of the change you will make." },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          pr_title: { type: "string", description: "Concise PR title (max 72 chars, conventional commit style)." },
        },
        required: ["hypothesis", "suspect_files", "proposed_change", "risk", "pr_title"],
        additionalProperties: false,
      },
    },
  });
  const planArgs = ai.tool as
    | { hypothesis: string; suspect_files: string[]; proposed_change: string; risk: string; pr_title: string }
    | null;
  if (!planArgs) throw new Error("plan_missing_tool_call");
  const suspect = (planArgs.suspect_files ?? []).filter(Boolean).slice(0, 5);
  return {
    phase: "draft_pr",
    plan: {
      summary: ctx.loop.plan?.summary,
      hypothesis: planArgs.hypothesis,
      suspect_files: suspect,
      proposed_change: planArgs.proposed_change,
      risk: planArgs.risk,
      // @ts-expect-error stored alongside plan for later use
      pr_title: planArgs.pr_title,
    },
    suspect_files: suspect,
    message: `Plan ready · ${planArgs.hypothesis.slice(0, 90)}`,
    comment_kind: "progress",
  };
}

async function runDraftPr(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const { repo, loop } = ctx;
  // Stable, deterministic branch name keyed to the loop id — eliminates
  // races from parallel pollers and lets us safely retry.
  const branch = loop.branch ?? `forge/auto-${loop.id.slice(0, 8)}`;
  const headSha = await getBranchHeadSha(token, repo.owner, repo.name, repo.default_branch);
  try {
    await createBranch(token, repo.owner, repo.name, branch, headSha);
  } catch (e) {
    // "Reference already exists" → branch is already there; safe to continue.
    if (!(e instanceof Error) || !/gh_422/.test(e.message)) throw e;
  }

  // GitHub disallows opening a PR with no diff between head and base, so we
  // stage a marker file on the new branch first. It will be updated during
  // the patch phase. Use the existing file SHA if it already exists.
  const markerPath = ".hermes/plan.md";
  const planBody = renderPlanMarkdown(loop);
  const existingMarker = await getFileContents(token, repo.owner, repo.name, markerPath, branch);
  try {
    await putFile(token, repo.owner, repo.name, {
      path: markerPath,
      content: planBody,
      branch,
      message: "chore(hermes): seed plan",
      ...(existingMarker ? { sha: existingMarker.sha } : {}),
    });
  } catch (e) {
    // If content hasn't changed GitHub may 422 — non-fatal.
    if (!(e instanceof Error) || !/gh_422/.test(e.message)) throw e;
  }

  const planArg = loop.plan as (LoopRow["plan"] & { pr_title?: string }) | null;
  const title = planArg?.pr_title?.slice(0, 72) || `forge: ${planArg?.hypothesis?.slice(0, 60) ?? "automated improvement"}`;
  let pr: { number: number; html_url: string; node_id: string; draft: boolean };
  try {
    pr = await createPullRequest(token, repo.owner, repo.name, {
      title,
      head: branch,
      base: repo.default_branch,
      body: planBody,
      draft: true,
    });
  } catch (e) {
    // PR already exists for this branch → fetch it and reuse.
    if (!(e instanceof Error) || !/gh_422/.test(e.message)) throw e;
    const list = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls?head=${repo.owner}:${branch}&state=open`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "hermes-forge",
        },
      },
    );
    const existing = (await list.json()) as Array<{ number: number; html_url: string; node_id: string; draft: boolean }>;
    if (!existing?.[0]) throw e;
    pr = existing[0];
  }
  return {
    phase: "patch",
    branch,
    pr_number: pr.number,
    pr_url: pr.html_url,
    pr_is_draft: true,
    message: `Draft PR #${pr.number} opened`,
    comment_kind: "pr_opened",
  };
}

function renderPlanMarkdown(loop: LoopRow): string {
  const p = loop.plan ?? {};
  const lines: string[] = [];
  lines.push("# Hermes Forge — Autonomous Improvement");
  lines.push("");
  lines.push("> Draft PR opened by Hermes. The agent will commit its proposed changes to this branch, then flip the PR to ready for review.");
  lines.push("");
  if (loop.bug_report?.trim()) {
    lines.push("## Bug report / instructions");
    lines.push("");
    lines.push("> " + loop.bug_report.trim().split("\n").join("\n> "));
    lines.push("");
  }
  if (loop.goals.length) {
    lines.push("## Active goals");
    lines.push("");
    for (const g of loop.goals) lines.push(`- ${g}`);
    lines.push("");
  }
  if (p.summary) {
    lines.push("## Repo brief");
    lines.push("");
    lines.push(p.summary);
    lines.push("");
  }
  lines.push("## Hypothesis");
  lines.push("");
  lines.push(p.hypothesis ?? "_(pending)_");
  lines.push("");
  lines.push("## Proposed change");
  lines.push("");
  lines.push(p.proposed_change ?? "_(pending)_");
  lines.push("");
  if (p.suspect_files?.length) {
    lines.push("## Files in scope");
    lines.push("");
    for (const f of p.suspect_files) lines.push(`- [ ] \`${f}\``);
    lines.push("");
  }
  if (p.risk) {
    lines.push(`**Risk:** ${p.risk}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("_Generated by [Hermes Forge](https://hermes-forge-git-ai.lovable.app/)._");
  return lines.join("\n");
}

async function runPatch(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const { repo, loop } = ctx;
  if (!loop.branch) throw new Error("patch_missing_branch");
  const files = (loop.suspect_files ?? []).slice(0, 5);
  if (files.length === 0) {
    return { phase: "commit", message: "No suspect files identified; skipping patch.", comment_kind: "progress" };
  }

  let edits = 0;
  const errors: string[] = [];
  for (const path of files) {
    try {
      const existing = await getFileContents(token, repo.owner, repo.name, path, loop.branch);
      if (!existing) {
        errors.push(`${path}: file not found on branch`);
        continue;
      }
      const ai = await callAI({
        messages: [
          {
            role: "system",
            content:
              "You are Hermes, an autonomous code engineer. You will be given a single source file plus the improvement plan. Return the FULL new contents of the file via the apply_edit tool. Make the minimum change required by the plan. Do not change unrelated code, comments, or formatting. If the file does not need to change for this plan, return the file unchanged.",
          },
          {
            role: "user",
            content: [
              `Repo: ${repo.full_name}`,
              `Path: ${path}`,
              ``,
              `Plan hypothesis: ${loop.plan?.hypothesis ?? ""}`,
              `Proposed change: ${loop.plan?.proposed_change ?? ""}`,
              loop.bug_report ? `User bug report: ${loop.bug_report}` : "",
              ``,
              `CURRENT FILE CONTENTS:`,
              "```",
              existing.content,
              "```",
            ].filter(Boolean).join("\n"),
          },
        ],
        tool: {
          name: "apply_edit",
          description: "Return the full new contents of the file.",
          parameters: {
            type: "object",
            properties: {
              new_contents: { type: "string", description: "Complete new file contents." },
              changed: { type: "boolean", description: "True if you actually changed the file." },
              note: { type: "string", description: "Short note on what you changed (or why not)." },
            },
            required: ["new_contents", "changed", "note"],
            additionalProperties: false,
          },
        },
      });
      const args = ai.tool as { new_contents: string; changed: boolean; note: string } | null;
      if (!args) {
        errors.push(`${path}: model did not return an edit`);
        continue;
      }
      if (!args.changed || args.new_contents === existing.content) continue;
      await putFile(token, repo.owner, repo.name, {
        path,
        content: args.new_contents,
        branch: loop.branch,
        message: `forge: ${args.note.slice(0, 60)}`,
        sha: existing.sha,
      });
      edits++;
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const msg = edits === 0
    ? "No file edits were applied" + (errors.length ? ` (${errors.length} issue${errors.length === 1 ? "" : "s"})` : "")
    : `Patched ${edits} file${edits === 1 ? "" : "s"}`;
  return {
    phase: "commit",
    message: msg,
    comment_kind: "progress",
  };
}

async function runCommit(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const { repo, loop } = ctx;
  if (loop.pr_number) {
    const note = [
      "**Hermes summary**",
      "",
      loop.plan?.proposed_change ?? "(no proposed change)",
      "",
      loop.suspect_files?.length
        ? `Touched files:\n${loop.suspect_files.map((f) => `- \`${f}\``).join("\n")}`
        : "",
    ].filter(Boolean).join("\n");
    try {
      await addPRComment(token, repo.owner, repo.name, loop.pr_number, note);
    } catch {
      /* non-fatal */
    }
  }
  return { phase: "ready", message: "Commits pushed; preparing PR for review", comment_kind: "progress" };
}

async function runReady(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const { repo, loop } = ctx;
  if (loop.pr_number) {
    // Fetch node_id (needed for GraphQL markReadyForReview).
    try {
      const pr = await (await fetch(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls/${loop.pr_number}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "hermes-forge",
          },
        },
      )).json() as { node_id: string; draft: boolean };
      if (pr.draft) {
        await markPRReadyForReview(token, pr.node_id);
      }
    } catch {
      /* non-fatal */
    }
  }
  // Don't declare victory yet — wait for CI/deploy checks.
  if (loop.pr_number) {
    return {
      phase: "checks_pending",
      pr_is_draft: false,
      checks_status: "pending",
      // Give CI a moment to register check runs before the first poll.
      next_run_at: new Date(Date.now() + 20_000).toISOString(),
      message: "PR ready for review · waiting on CI checks",
      comment_kind: "progress",
    };
  }
  return {
    status: "completed",
    phase: "completed",
    pr_is_draft: false,
    finished_at: new Date().toISOString(),
    message: "Loop complete · PR ready for review",
    comment_kind: "completed",
  };
}

// ---------------------------------------------------------------------------
// CI feedback + self-repair
// ---------------------------------------------------------------------------

const CHECKS_POLL_WINDOW_MS = 12 * 60 * 1000; // give CI up to 12 minutes

async function runChecksPending(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const { repo, loop } = ctx;
  if (!loop.pr_number) {
    return {
      status: "completed",
      phase: "completed",
      finished_at: new Date().toISOString(),
      message: "No PR to monitor; marking complete.",
      comment_kind: "completed",
    };
  }
  const { runs, statuses, headSha } = await listPRChecks(
    token,
    repo.owner,
    repo.name,
    loop.pr_number,
  );

  const allChecks = [
    ...runs.map((r) => ({
      name: r.name,
      state: r.status === "completed" ? (r.conclusion ?? "neutral") : "pending",
      url: r.html_url,
      summary: r.output_title ?? r.output_summary ?? null,
    })),
    ...statuses.map((s) => ({
      name: s.context,
      state: s.state,
      url: s.target_url,
      summary: s.description,
    })),
  ];

  const failed = allChecks.filter((c) =>
    ["failure", "error", "timed_out", "action_required", "cancelled"].includes(c.state),
  );
  const stillPending = allChecks.some((c) =>
    ["pending", "queued", "in_progress"].includes(c.state),
  );
  const succeeded =
    allChecks.length > 0 && !stillPending && failed.length === 0;

  // Has CI even started? If no checks reported yet, keep waiting (up to window).
  const noChecksYet = allChecks.length === 0;

  // Time-bounded wait: don't poll forever if CI never reports.
  const startedAt = ctx.loop.checks_payload && typeof (ctx.loop.checks_payload as { started_at?: string }).started_at === "string"
    ? new Date((ctx.loop.checks_payload as { started_at: string }).started_at).getTime()
    : Date.now();
  const expired = Date.now() - startedAt > CHECKS_POLL_WINDOW_MS;

  const payload = {
    head_sha: headSha,
    started_at: new Date(startedAt).toISOString(),
    last_checked_at: new Date().toISOString(),
    checks: allChecks,
  } as unknown as import("@/integrations/supabase/types").Json;

  if (succeeded) {
    return {
      status: "completed",
      phase: "completed",
      checks_status: "success",
      checks_payload: payload,
      finished_at: new Date().toISOString(),
      message: `All ${allChecks.length} checks passed · PR ready to merge`,
      comment_kind: "completed",
    };
  }

  if (failed.length > 0) {
    const attempts = ctx.loop.attempt_count ?? 0;
    const max = ctx.loop.max_attempts ?? 3;
    if (attempts >= max) {
      return {
        status: "failed",
        phase: "blocked",
        checks_status: "failure",
        checks_payload: payload,
        last_error: `Checks still failing after ${attempts} repair attempts: ${failed.map((f) => f.name).join(", ")}`,
        finished_at: new Date().toISOString(),
        message: `Giving up after ${attempts} repair attempt${attempts === 1 ? "" : "s"} · ${failed.length} check${failed.length === 1 ? "" : "s"} still failing`,
        comment_kind: "error",
      };
    }
    return {
      phase: "diagnose_failure",
      checks_status: "failure",
      checks_payload: payload,
      next_run_at: new Date().toISOString(),
      message: `${failed.length} check${failed.length === 1 ? "" : "s"} failed · diagnosing (attempt ${attempts + 1}/${max})`,
      comment_kind: "progress",
    };
  }

  if (noChecksYet && expired) {
    // CI never spoke up. Consider PR ready and let the human take it from here.
    return {
      status: "completed",
      phase: "completed",
      checks_status: "no_checks",
      checks_payload: payload,
      finished_at: new Date().toISOString(),
      message: "No CI checks reported in 12 minutes · marking PR ready for review",
      comment_kind: "completed",
    };
  }

  // Still pending — schedule the next poll.
  return {
    checks_status: "pending",
    checks_payload: payload,
    next_run_at: new Date(Date.now() + 30_000).toISOString(),
    message: `Checks running · ${allChecks.filter((c) => ["pending", "queued", "in_progress"].includes(c.state)).length} pending`,
    comment_kind: "progress",
  };
}

async function runDiagnoseFailure(ctx: PhaseCtx): Promise<PhasePatch> {
  const { loop } = ctx;
  const payload = (loop.checks_payload ?? {}) as {
    checks?: Array<{ name: string; state: string; url: string | null; summary: string | null }>;
  };
  const failed = (payload.checks ?? []).filter((c) =>
    ["failure", "error", "timed_out", "action_required", "cancelled"].includes(c.state),
  );
  const failureDigest = failed
    .map((f) => `- ${f.name} (${f.state})${f.summary ? `: ${f.summary.slice(0, 240)}` : ""}`)
    .join("\n");

  const ai = await callAI({
    messages: [
      {
        role: "system",
        content:
          "You are Hermes. A PR you opened has failing CI/deploy checks. Given the previous plan and the failure summaries, propose a corrective patch focused ONLY on the failing checks. Identify up to 5 likely files to modify (repo-relative paths). Be specific and conservative — fix the failure, do not refactor.",
      },
      {
        role: "user",
        content: [
          `Original hypothesis: ${loop.plan?.hypothesis ?? "(none)"}`,
          `Original proposed change: ${loop.plan?.proposed_change ?? "(none)"}`,
          `Previously touched files:\n${(loop.suspect_files ?? []).map((f) => `- ${f}`).join("\n") || "(none)"}`,
          ``,
          `Failing checks:\n${failureDigest || "(no detail available)"}`,
        ].join("\n"),
      },
    ],
    tool: {
      name: "submit_repair_plan",
      description: "Submit a corrective plan for the failing checks.",
      parameters: {
        type: "object",
        properties: {
          diagnosis: { type: "string", description: "1-3 sentence root cause." },
          suspect_files: {
            type: "array",
            items: { type: "string" },
            description: "Up to 5 source file paths (repo-relative) to modify.",
          },
          proposed_fix: { type: "string", description: "Plain-English description of the fix." },
        },
        required: ["diagnosis", "suspect_files", "proposed_fix"],
        additionalProperties: false,
      },
    },
  });
  const repair = ai.tool as
    | { diagnosis: string; suspect_files: string[]; proposed_fix: string }
    | null;
  if (!repair) throw new Error("diagnose_missing_tool_call");
  const suspect = (repair.suspect_files ?? []).filter(Boolean).slice(0, 5);
  const attempts = (loop.attempt_count ?? 0) + 1;
  return {
    phase: "repair_patch",
    attempt_count: attempts,
    suspect_files: suspect,
    plan: {
      ...(loop.plan ?? {}),
      hypothesis: repair.diagnosis,
      proposed_change: repair.proposed_fix,
      suspect_files: suspect,
    },
    message: `Diagnosis · ${repair.diagnosis.slice(0, 120)}`,
    comment_kind: "progress",
  };
}

// ---------------------------------------------------------------------------
// Shared phase advancement worker — used by both pollLoopStatus and the cron.
// Acquires a lock, runs a single phase, releases it. Returns the updated loop.
// ---------------------------------------------------------------------------

const STALE_LOCK_MS = 90_000;

const LOOP_SELECT =
  "id, user_id, repository_id, status, phase, branch, goals, bug_report, plan, suspect_files, pr_number, pr_url, attempt_count, max_attempts, checks_status, checks_payload, next_run_at";

export async function advanceLoopOnce(loopId: string): Promise<{
  loop: LoopRow | null;
  advanced: boolean;
  reason?: string;
}> {
  const { data: row } = await supabaseAdmin
    .from("loops")
    .select(LOOP_SELECT)
    .eq("id", loopId)
    .maybeSingle();
  if (!row) return { loop: null, advanced: false, reason: "loop_not_found" };
  const loop = row as unknown as LoopRow;
  if (loop.status !== "running") return { loop, advanced: false, reason: "loop_not_running" };

  const nextRunAt = (row as { next_run_at?: string | null }).next_run_at;
  if (nextRunAt && new Date(nextRunAt).getTime() > Date.now()) {
    return { loop, advanced: false, reason: "not_due" };
  }

  const { data: repo } = await supabaseAdmin
    .from("repositories")
    .select("id, full_name, owner, name, default_branch")
    .eq("id", loop.repository_id)
    .maybeSingle();
  if (!repo) return { loop, advanced: false, reason: "repo_not_found" };

  const { data: install } = await supabaseAdmin
    .from("github_installations")
    .select("installation_id")
    .eq("user_id", loop.user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!install) return { loop, advanced: false, reason: "no_installation" };

  // Lock the row for this phase.
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  const { data: locked } = await supabaseAdmin
    .from("loops")
    .update({ phase_running: true, phase_started_at: new Date().toISOString() })
    .eq("id", loop.id)
    .eq("phase", loop.phase)
    .or(`phase_running.eq.false,phase_started_at.lt.${staleCutoff}`)
    .select(LOOP_SELECT)
    .maybeSingle();
  if (!locked) return { loop, advanced: false, reason: "locked" };

  const lockedLoop = locked as unknown as LoopRow;
  const phaseFrom = lockedLoop.phase;

  try {
    const patch = await runPhase({
      loop: lockedLoop,
      repo: repo as RepoRow,
      installationId: Number((install as { installation_id: number | string }).installation_id),
    });
    const { message, comment_kind, ...dbPatch } = patch;
    // If the patch didn't set next_run_at, advancing the phase should make the
    // loop immediately due so the next worker tick picks it up.
    const next_run_at = dbPatch.next_run_at !== undefined
      ? dbPatch.next_run_at
      : dbPatch.phase
      ? new Date().toISOString()
      : null;
    const releasePatch = { ...dbPatch, phase_running: false, next_run_at };
    const { data: updated } = await supabaseAdmin
      .from("loops")
      .update(releasePatch)
      .eq("id", lockedLoop.id)
      .eq("phase", phaseFrom)
      .select(LOOP_SELECT)
      .maybeSingle();
    await supabaseAdmin.from("activity_events").insert({
      user_id: lockedLoop.user_id,
      loop_id: lockedLoop.id,
      repository_id: lockedLoop.repository_id,
      kind: comment_kind ?? "progress",
      message,
      metadata: { phase_from: phaseFrom, phase_to: dbPatch.phase ?? phaseFrom },
    });
    return { loop: (updated as unknown as LoopRow) ?? lockedLoop, advanced: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("loops")
      .update({
        status: "failed",
        phase: "error",
        phase_running: false,
        last_error: msg.slice(0, 1000),
        finished_at: new Date().toISOString(),
      })
      .eq("id", lockedLoop.id);
    await supabaseAdmin.from("activity_events").insert({
      user_id: lockedLoop.user_id,
      loop_id: lockedLoop.id,
      repository_id: lockedLoop.repository_id,
      kind: "error",
      message: `Phase "${phaseFrom}" failed: ${msg.slice(0, 240)}`,
    });
    return { loop: lockedLoop, advanced: false, reason: `error:${msg.slice(0, 100)}` };
  }
}

export async function advanceDueLoops(limit = 10): Promise<{ processed: number; advanced: number }> {
  const { data: due } = await supabaseAdmin
    .from("loops")
    .select("id")
    .eq("status", "running")
    .eq("phase_running", false)
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit);
  let advanced = 0;
  for (const r of due ?? []) {
    const res = await advanceLoopOnce((r as { id: string }).id);
    if (res.advanced) advanced++;
  }
  return { processed: (due ?? []).length, advanced };
}