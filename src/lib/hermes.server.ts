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
  type RepoTreeEntry,
} from "./github-app.server";

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
  const branch = loop.branch ?? `forge/auto-${Date.now()}`;
  const headSha = await getBranchHeadSha(token, repo.owner, repo.name, repo.default_branch);
  await createBranch(token, repo.owner, repo.name, branch, headSha);

  // GitHub disallows opening a PR with no diff between head and base, so we
  // stage an empty marker file on the new branch first. It will be replaced
  // (or kept as a hidden footprint) during the patch phase.
  const markerPath = ".hermes/plan.md";
  const planBody = renderPlanMarkdown(loop);
  await putFile(token, repo.owner, repo.name, {
    path: markerPath,
    content: planBody,
    branch,
    message: "chore(hermes): seed plan",
  });

  const planArg = loop.plan as (LoopRow["plan"] & { pr_title?: string }) | null;
  const title = planArg?.pr_title?.slice(0, 72) || `forge: ${planArg?.hypothesis?.slice(0, 60) ?? "automated improvement"}`;
  const pr = await createPullRequest(token, repo.owner, repo.name, {
    title,
    head: branch,
    base: repo.default_branch,
    body: planBody,
    draft: true,
  });
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
  return {
    status: "completed",
    phase: "completed",
    pr_is_draft: false,
    finished_at: new Date().toISOString(),
    message: "Loop complete · PR ready for review",
    comment_kind: "completed",
  };
}