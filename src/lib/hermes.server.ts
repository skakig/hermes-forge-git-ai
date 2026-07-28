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
  getPRState,
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
      return runPlan(ctx, token);
    case "research":
      return runResearch(ctx);
    case "draft_pr":
      return runDraftPr(ctx, token);
    case "patch":
      return runPatch(ctx, token);
    case "commit":
      return runCommit(ctx, token);
    case "verify":
      return runVerify(ctx, token);
    case "ready":
      return runReady(ctx, token);
    case "checks_pending":
      return runChecksPending(ctx, token);
    case "diagnose_failure":
      return runDiagnoseFailure(ctx, token);
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

// Extract meaningful keywords from a bug report — nouns/terms ≥ 4 chars that
// aren't in a small English stopword list. Deterministic; used to grep the
// repo tree for candidate files that mention the buggy concept even if their
// filenames don't advertise it.
const STOPWORDS = new Set([
  "the","and","for","with","this","that","from","have","when","then","have",
  "them","they","their","your","just","some","been","were","will","would","should",
  "could","into","also","only","because","which","what","where","there","here",
  "about","after","before","between","during","under","over","above","below","again",
  "very","much","more","less","most","many","much","such","than","them","these",
  "those","this","those","being","doesn","doesnt","dont","cant","cannot","null",
  "true","false","none","function","class","file","code","line","error","issue",
  "problem","actually","game","play","player","user","users","using","used","need",
  "make","made","take","taken","seems","looks","look","looking","fix","fixed",
  "still","again","every","each","when","case","cases","rule","rules","logic",
]);

function extractKeywords(text: string, max = 12): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  // Frequency-weight, prefer distinctive terms.
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

// Rank source files by how well their PATH matches bug-report keywords.
// (Content-grep would be more accurate but costs one API call per file; the
// path signal is deterministic and cheap, and combined with the AI's own
// filename-based intuition it materially widens candidate scope.)
function discoverCandidateFiles(files: RepoTreeEntry[], bugReport: string): string[] {
  const keywords = extractKeywords(bugReport);
  if (keywords.length === 0) return [];
  type Scored = { path: string; score: number };
  const scored: Scored[] = [];
  for (const f of files) {
    const p = f.path.toLowerCase();
    let score = 0;
    for (const k of keywords) {
      if (p.includes(k)) score += k.length >= 6 ? 3 : 2;
    }
    // Bonus for likely business-logic locations.
    if (/(logic|rules|validate|validation|score|scoring|engine|state|reducer)/.test(p)) score += 1;
    // Penalty for tests/mocks/stories.
    if (/(\.test\.|\.spec\.|__tests__|__mocks__|\.stories\.)/.test(p)) score -= 2;
    if (score > 0) scored.push({ path: f.path, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((s) => s.path);
}

async function runPlan(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const goals = ctx.loop.goals.length ? ctx.loop.goals.join("\n- ") : "Improve overall code quality.";
  const bug = ctx.loop.bug_report?.trim();
  const { repo } = ctx;

  // Deterministic candidate discovery from the bug report BEFORE asking the AI.
  let candidatePaths: string[] = [];
  if (bug) {
    try {
      const tree = await listRepoTree(token, repo.owner, repo.name, repo.default_branch);
      const files = filterSourceFiles(tree.tree);
      candidatePaths = discoverCandidateFiles(files, bug);
    } catch (e) {
      console.error("candidate discovery failed:", e);
    }
  }

  // Stage 1: initial hypothesis + candidate file list from the AI.
  const ai = await callAI({
    messages: [
      {
        role: "system",
        content:
          "You are Hermes. Given a repo brief, a user bug report, active goals, and a keyword-derived candidate file list, propose ONE focused improvement that can ship in a small pull request. Identify the most likely suspect files (max 5) by path — you may pick from the candidate list, from the repo brief, or from your own inference, and you SHOULD prefer paths that plausibly contain the business logic named in the bug report (e.g. scoring, validation, rules), not just UI/state hooks. Be concrete about the change.",
      },
      {
        role: "user",
        content: [
          `Repo brief:\n${ctx.loop.plan?.summary ?? "(none)"}`,
          ``,
          `Active goals:\n- ${goals}`,
          ``,
          bug ? `Bug report / instructions from the user:\n${bug}` : `(no specific bug report; investigate the goals)`,
          candidatePaths.length
            ? `\nCandidate files (paths matching keywords in the bug report — inspect before finalizing scope):\n${candidatePaths.map((p) => `- ${p}`).join("\n")}`
            : "",
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
  let suspect = (planArgs.suspect_files ?? []).filter(Boolean).slice(0, 5);

  // Stage 2: read the actual contents of the top 3 candidate files, then let
  // the model refine the suspect list. This is the "read code before locking
  // scope" step — it's what fixes the Farkle-style half-fix where the plan
  // picked useGameState.ts but missed the scoring validator.
  const toInspect = Array.from(new Set([...suspect, ...candidatePaths])).slice(0, 4);
  const fileBlocks: string[] = [];
  for (const p of toInspect) {
    try {
      const got = await getFileContents(token, repo.owner, repo.name, p, repo.default_branch);
      if (got?.content) fileBlocks.push(`### ${p}\n\`\`\`\n${got.content.slice(0, 4000)}\n\`\`\``);
    } catch { /* file may not exist on default branch */ }
  }
  if (fileBlocks.length > 0) {
    try {
      const refine = await callAI({
        messages: [
          {
            role: "system",
            content:
              "You are Hermes. You proposed an initial plan and now have the actual contents of the most likely candidate files. Refine the suspect_files list (max 5) to include EVERY file whose code must change to implement the proposed change end-to-end. If the bug is about validation/rules/scoring logic and you see that logic in one file but not in your current suspect list, ADD IT. If a file in your current list doesn't actually contain the relevant code, REPLACE it. Return a concise, updated plan.",
          },
          {
            role: "user",
            content: [
              `Bug report: ${bug ?? "(none)"}`,
              `Current hypothesis: ${planArgs.hypothesis}`,
              `Current proposed change: ${planArgs.proposed_change}`,
              `Current suspect_files: ${suspect.join(", ") || "(none)"}`,
              ``,
              `FILES READ (from default branch):`,
              fileBlocks.join("\n\n"),
            ].join("\n"),
          },
        ],
        tool: {
          name: "refine_plan",
          description: "Return a refined suspect_files list and (optionally) an updated proposed_change.",
          parameters: {
            type: "object",
            properties: {
              suspect_files: { type: "array", items: { type: "string" }, description: "Final list of files to edit (max 5)." },
              proposed_change: { type: "string", description: "Refined proposed change (may be unchanged)." },
              rationale: { type: "string", description: "One sentence: why this set of files, not the previous one." },
            },
            required: ["suspect_files", "proposed_change", "rationale"],
            additionalProperties: false,
          },
        },
      });
      const r = refine.tool as { suspect_files?: string[]; proposed_change?: string; rationale?: string } | null;
      if (r?.suspect_files?.length) {
        suspect = r.suspect_files.filter(Boolean).slice(0, 5);
        if (r.proposed_change) planArgs.proposed_change = r.proposed_change;
      }
    } catch (e) {
      console.error("plan refinement failed (non-fatal):", e);
    }
  }

  return {
    phase: "research",
    plan: {
      summary: ctx.loop.plan?.summary,
      hypothesis: planArgs.hypothesis,
      suspect_files: suspect,
      proposed_change: planArgs.proposed_change,
      risk: planArgs.risk,
      // @ts-expect-error stored alongside plan for later use
      pr_title: planArgs.pr_title,
      candidate_paths: candidatePaths,
    },
    suspect_files: suspect,
    message: `Plan ready · ${planArgs.hypothesis.slice(0, 90)}`,
    comment_kind: "progress",
  };
}

// ---------------------------------------------------------------------------
// Research phase. The agent writes down the authoritative rules / spec /
// algorithm it intends to implement BEFORE touching code. Two paths:
//
//   1. AI-only: ask the model to recall the canonical rules from its training
//      data, with explicit source citations (URLs / RFCs / book titles).
//   2. Firecrawl-augmented (when FIRECRAWL_API_KEY is set): use the AI's
//      search queries, scrape the top results, and feed the markdown back in.
//
// The distilled rules become a `research` block on the plan and are injected
// verbatim into the patch system prompt so the agent codes AGAINST the spec
// rather than inventing behavior. Falls back to a no-op if AI fails.
// ---------------------------------------------------------------------------

type ResearchBlock = {
  queries: string[];
  sources: Array<{ url: string; title: string; summary: string }>;
  rules_extracted: string;
  augmented: boolean;
};

async function firecrawlSearchAndScrape(query: string): Promise<Array<{ url: string; title: string; markdown: string }>> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!lovableKey || !firecrawlKey) return [];
  try {
    // Firecrawl is a gateway-backed connector — route through the Lovable
    // gateway so OAuth/token refresh is handled for us.
    const res = await fetch("https://connector-gateway.lovable.dev/firecrawl/v2/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": firecrawlKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: 3,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
    });
    if (!res.ok) {
      console.error("firecrawl gateway error:", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return [];
    }
    const json = (await res.json()) as {
      data?:
        | { web?: Array<{ url: string; title?: string; markdown?: string }> }
        | Array<{ url: string; title?: string; markdown?: string }>;
    };
    const raw = Array.isArray(json.data) ? json.data : json.data?.web ?? [];
    return raw.slice(0, 3).map((r) => ({
      url: r.url,
      title: r.title ?? r.url,
      markdown: (r.markdown ?? "").slice(0, 4000),
    }));
  } catch (e) {
    console.error("firecrawl search failed:", e);
    return [];
  }
}

async function runResearch(ctx: PhaseCtx): Promise<PhasePatch> {
  const { loop } = ctx;
  const plan = loop.plan ?? {};
  const bug = loop.bug_report?.trim() ?? "";
  // Ask the AI to produce search queries + an authoritative rules brief from
  // its own knowledge, with source citations. This is useful even without
  // Firecrawl because well-known domains (game rules, RFCs, common algorithms)
  // are in the model's training data.
  let ai;
  try {
    ai = await callAI({
      messages: [
        {
          role: "system",
          content:
            "You are Hermes' research analyst. Before any code changes, you produce an AUTHORITATIVE rules brief for the proposed change so the engineer codes against the spec, not against guesses. " +
            "If the proposed change touches a well-known domain (game rules, protocols, algorithms, accessibility specs, etc.), recall the canonical rules from your training and cite the most authoritative public source URL you know. " +
            "Also produce 1-3 targeted web search queries someone could run to verify. If the change is purely internal refactor / typing with no external spec, return empty rules and one query.",
        },
        {
          role: "user",
          content: [
            `Hypothesis: ${plan.hypothesis ?? "(none)"}`,
            `Proposed change: ${plan.proposed_change ?? "(none)"}`,
            bug ? `User bug report: ${bug}` : "",
            `Repo brief: ${plan.summary ?? "(none)"}`,
          ].filter(Boolean).join("\n"),
        },
      ],
      tool: {
        name: "submit_research",
        description: "Submit a rules brief grounding the proposed change.",
        parameters: {
          type: "object",
          properties: {
            queries: {
              type: "array",
              items: { type: "string" },
              description: "1-3 web search queries that would verify the rules.",
            },
            sources: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                  summary: { type: "string", description: "One-paragraph summary of what this source says about the rules." },
                },
                required: ["url", "title", "summary"],
                additionalProperties: false,
              },
              description: "Up to 3 authoritative source URLs from your training data.",
            },
            rules_extracted: {
              type: "string",
              description: "The actual rules / spec the engineer must implement, in numbered form. Be specific and conservative. If no external spec applies, write 'No external spec applies.'",
            },
          },
          required: ["queries", "sources", "rules_extracted"],
          additionalProperties: false,
        },
      },
    });
  } catch (e) {
    console.error("research phase AI call failed:", e);
    return {
      phase: "draft_pr",
      message: `Research skipped (${e instanceof Error ? e.message.slice(0, 80) : "AI error"})`,
      comment_kind: "progress",
    };
  }
  const r = ai.tool as { queries: string[]; sources: Array<{ url: string; title: string; summary: string }>; rules_extracted: string } | null;
  if (!r) {
    return { phase: "draft_pr", message: "Research returned no brief; proceeding", comment_kind: "progress" };
  }

  let augmented = false;
  const sources = [...(r.sources ?? [])];
  // Optional Firecrawl augmentation: actually fetch the top query's results
  // and append a short summary so the patch step has fresh ground truth.
  if (process.env.FIRECRAWL_API_KEY && (r.queries?.[0]?.length ?? 0) > 3) {
    const hits = await firecrawlSearchAndScrape(r.queries[0]);
    if (hits.length) {
      augmented = true;
      for (const h of hits) {
        if (sources.some((s) => s.url === h.url)) continue;
        sources.push({
          url: h.url,
          title: h.title,
          summary: h.markdown.slice(0, 600).replace(/\s+/g, " ").trim(),
        });
      }
    }
  }

  const research: ResearchBlock = {
    queries: (r.queries ?? []).slice(0, 3),
    sources: sources.slice(0, 5),
    rules_extracted: r.rules_extracted ?? "",
    augmented,
  };

  return {
    phase: "draft_pr",
    plan: {
      ...(loop.plan ?? {}),
      // @ts-expect-error stored alongside plan for the patch step + UI
      research,
    },
    message: `Research ready · ${research.sources.length} source${research.sources.length === 1 ? "" : "s"}${augmented ? " (web-verified)" : ""}`,
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

// Unbypassable pre-commit validator. Returns a rule name + human message when
// the file MUST NOT be pushed. Every putFile of agent-authored source MUST go
// through this gate. We can't run the build inside the Worker, but we can
// deterministically catch the AI-output failure modes that have actually
// broken our deploys (stray ''' wrappers, markdown fences, chat preambles,
// bracket-imbalance) — much more strictly than before.
export type ValidationResult = { ok: true } | { ok: false; rule: string; message: string };

function reject(rule: string, message: string): ValidationResult {
  return { ok: false, rule, message };
}

export function validateProposedFile(path: string, contents: string): ValidationResult {
  if (!contents || contents.length < 2) return reject("EMPTY_FILE", "file is empty or too short");

  // Strip a leading BOM for comparison, keep original for line work.
  const stripped = contents.replace(/^\uFEFF/, "");

  // Universal AI-output artifacts. Apply to EVERY file type.
  if (/^\s*```/.test(stripped)) return reject("LEADING_MARKDOWN_FENCE", "file starts with a ``` code fence");
  if (/\n\s*```\s*$/.test(stripped)) return reject("TRAILING_MARKDOWN_FENCE", "file ends with a ``` code fence");
  if (/^\s*'{3,}/.test(stripped)) return reject("LEADING_TRIPLE_QUOTE", "file starts with stray ''' characters");
  if (/^\s*"{3,}/.test(stripped)) return reject("LEADING_TRIPLE_DQUOTE", "file starts with stray \"\"\" characters");

  // Line-level scan: ANY line that consists solely of ''' / """ / ``` is
  // a Python-docstring/markdown leakage and must be rejected — this is the
  // exact pattern that broke Netlify (line 1 + last line of useGameState.ts).
  const lines = stripped.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "'''" || t === '"""' || t === "```") {
      return reject(
        "STRAY_TRIPLE_QUOTE_LINE",
        `line ${i + 1} is a stray ${t} wrapper (Python docstring / markdown leakage)`,
      );
    }
  }

  // Trailing-only artifact: last non-blank line is a stray wrapper.
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t === "'''" || t === '"""' || t === "```") {
      return reject("TRAILING_TRIPLE_QUOTE", `last line is a stray ${t} wrapper`);
    }
    break;
  }

  if (/^\s*(?:Here(?:'s| is)|Sure[,!]|Below is|Certainly[,.]|Of course|I('?| ?'?ve| will| can))/i.test(stripped)) {
    return reject("CHAT_PREAMBLE", "file starts with a chat-style preamble instead of code");
  }
  if (/\u0000/.test(contents)) return reject("NULL_BYTES", "contains null bytes");
  if (/\uFFFD/.test(contents)) return reject("BAD_ENCODING", "contains Unicode replacement characters (corrupt encoding)");

  if (/\.json$/i.test(path)) {
    try { JSON.parse(contents); return { ok: true }; }
    catch (e) { return reject("INVALID_JSON", `invalid JSON: ${e instanceof Error ? e.message : String(e)}`); }
  }

  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) {
    // First non-comment, non-blank line must look like valid TS/JS.
    const firstCode = lines
      .map((l) => l.replace(/^\s+/, ""))
      .find((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"));
    if (firstCode) {
      const ok = /^(import\b|export\b|const\b|let\b|var\b|function\b|class\b|type\b|interface\b|enum\b|declare\b|async\b|namespace\b|module\b|@|\/\*|\(|\{|"use |'use |if\b|return\b|<|;)/.test(firstCode);
      if (!ok) {
        return reject("FIRST_LINE_NOT_JS", `first code line does not look like valid JS/TS: ${firstCode.slice(0, 60)}`);
      }
    }
    // Cheap bracket-balance check after stripping strings + comments.
    const cleaned = contents
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/`(?:\\.|[^`\\])*`/g, "``")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''");
    let curly = 0, paren = 0, square = 0;
    for (const ch of cleaned) {
      if (ch === "{") curly++; else if (ch === "}") curly--;
      else if (ch === "(") paren++; else if (ch === ")") paren--;
      else if (ch === "[") square++; else if (ch === "]") square--;
      if (curly < 0 || paren < 0 || square < 0) return reject("UNMATCHED_BRACKET", "unmatched closing bracket");
    }
    if (curly !== 0) return reject("UNBALANCED_BRACES", `unbalanced braces (${curly > 0 ? "+" : ""}${curly})`);
    if (paren !== 0) return reject("UNBALANCED_PARENS", `unbalanced parens (${paren > 0 ? "+" : ""}${paren})`);
    if (square !== 0) return reject("UNBALANCED_BRACKETS", `unbalanced brackets (${square > 0 ? "+" : ""}${square})`);
  }
  return { ok: true };
}

const PATCH_CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "netlify.toml",
  "next.config.js",
  "tailwind.config.ts",
];

const MAX_BUNDLE_CHARS = 40_000;

// Try once to repair an AI edit that failed local validation. We send the
// rejected file back with the exact validation error and ask for a corrected
// full-file output. Only used pre-commit; never pushed unless it validates.
async function repairProposedFile(args: {
  path: string;
  rejectedContents: string;
  reason: string;
  originalContents: string;
  hypothesis: string;
  proposedChange: string;
}): Promise<string | null> {
  const ai = await callAI({
    messages: [
      {
        role: "system",
        content:
          "You are Hermes. Your previous edit to a file was rejected by a pre-commit validator because the file is not valid JS/TS/JSON. " +
          "Return the FULL corrected file contents. Make the MINIMUM change needed to make it valid while preserving the intent of the original edit. " +
          "Never wrap the output in markdown code fences. Never add a preamble. Output must be raw source code only.",
      },
      {
        role: "user",
        content: [
          `Path: ${args.path}`,
          `Validator rejection reason: ${args.reason}`,
          ``,
          `Original hypothesis: ${args.hypothesis}`,
          `Proposed change: ${args.proposedChange}`,
          ``,
          `REJECTED CONTENTS (your previous output):`,
          "```",
          args.rejectedContents.slice(0, 12000),
          "```",
          ``,
          `ORIGINAL CONTENTS (on branch, before any edit):`,
          "```",
          args.originalContents.slice(0, 12000),
          "```",
        ].join("\n"),
      },
    ],
    tool: {
      name: "submit_repaired_file",
      description: "Return the corrected full contents of the file.",
      parameters: {
        type: "object",
        properties: {
          new_contents: { type: "string", description: "Complete corrected file contents, raw source only." },
          note: { type: "string" },
        },
        required: ["new_contents"],
        additionalProperties: false,
      },
    },
  });
  const t = ai.tool as { new_contents?: string } | null;
  return t?.new_contents ?? null;
}

async function runPatch(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const { repo, loop } = ctx;
  if (!loop.branch) throw new Error("patch_missing_branch");
  const files = (loop.suspect_files ?? []).slice(0, 5);
  if (files.length === 0) {
    return { phase: "commit", message: "No suspect files identified; skipping patch.", comment_kind: "progress" };
  }

  // Pull current contents from the PR branch (so repair sees prior edits).
  type Loaded = { path: string; sha: string; content: string };
  const loaded: Loaded[] = [];
  const errors: string[] = [];
  for (const path of files) {
    try {
      const existing = await getFileContents(token, repo.owner, repo.name, path, loop.branch);
      if (!existing) { errors.push(`${path}: not found on branch`); continue; }
      loaded.push({ path, sha: existing.sha, content: existing.content });
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (loaded.length === 0) {
    return { phase: "commit", message: `No files could be loaded for patching (${errors.length} error${errors.length === 1 ? "" : "s"})`, comment_kind: "progress" };
  }

  // Failure-log context (only present on repair attempts).
  const ckPayload = (loop.checks_payload ?? {}) as { failure_logs?: FailureLog[] };
  const failureLogs = ckPayload.failure_logs ?? [];
  const failureDigest = failureLogs.length
    ? failureLogs.map((f) => `### ${f.name}\n${f.log || "(no log)"}`).join("\n\n").slice(0, 8000)
    : "";

  // Pull a couple of build-config files for context (read-only signal).
  const configBlocks: string[] = [];
  for (const p of PATCH_CONFIG_FILES) {
    try {
      const got = await getFileContents(token, repo.owner, repo.name, p, loop.branch);
      if (got?.content) configBlocks.push(`### ${p}\n\`\`\`\n${got.content.slice(0, 3000)}\n\`\`\``);
    } catch { /* missing files are expected */ }
  }

  // Bundle files into a single AI call when they fit; fall back per-file otherwise.
  const totalChars = loaded.reduce((n, f) => n + f.content.length, 0);
  const useBundle = totalChars <= MAX_BUNDLE_CHARS;

  type Edit = { path: string; new_contents: string; changed: boolean; note: string };
  let proposed: Edit[] = [];

  const systemMsg =
    "You are Hermes, an autonomous code engineer. You will receive several source files plus a plan and (when present) the build/CI failure logs. " +
    "Return a coherent set of edits via the apply_edits tool. Make the MINIMUM change needed. Preserve unrelated code, formatting, comments, imports, and types. " +
    "If a file does not need to change, omit it from the edits array. Never invent APIs. If the failure logs point at a config file or an import that doesn't exist, fix the import or revert the offending change rather than editing more code.";

  // Inject the research rules brief (if the research phase produced one) so
  // the engineer codes against the authoritative spec, not guesses.
  const research = (loop.plan as { research?: ResearchBlock } | null)?.research;
  const researchPrompt = research && research.rules_extracted && research.rules_extracted !== "No external spec applies."
    ? `\n\nAUTHORITATIVE RULES (implement EXACTLY these; do not invent additional behavior):\n${research.rules_extracted}\n\nSources: ${research.sources.map((s) => s.url).join(", ")}`
    : "";
  const fullSystemMsg = systemMsg + researchPrompt;

  if (useBundle) {
    const ai = await callAI({
      messages: [
        { role: "system", content: fullSystemMsg },
        {
          role: "user",
          content: [
            `Repo: ${repo.full_name}`,
            `Branch: ${loop.branch}`,
            ``,
            `Plan hypothesis: ${loop.plan?.hypothesis ?? ""}`,
            `Proposed change: ${loop.plan?.proposed_change ?? ""}`,
            loop.bug_report ? `User bug report: ${loop.bug_report}` : "",
            failureDigest ? `\nCI / DEPLOY FAILURE LOGS (most recent attempt):\n${failureDigest}` : "",
            configBlocks.length ? `\nBUILD CONFIG (read-only context):\n${configBlocks.join("\n\n")}` : "",
            ``,
            `FILES IN SCOPE:`,
            ...loaded.map((f) => `\n### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``),
          ].filter(Boolean).join("\n"),
        },
      ],
      tool: {
        name: "apply_edits",
        description: "Return the full new contents for each file you want to change.",
        parameters: {
          type: "object",
          properties: {
            edits: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  new_contents: { type: "string", description: "Complete new file contents." },
                  changed: { type: "boolean" },
                  note: { type: "string", description: "One-line explanation." },
                },
                required: ["path", "new_contents", "changed", "note"],
                additionalProperties: false,
              },
            },
            summary: { type: "string", description: "Two-sentence summary of the overall change." },
          },
          required: ["edits", "summary"],
          additionalProperties: false,
        },
      },
    });
    const args = ai.tool as { edits?: Edit[]; summary?: string } | null;
    proposed = (args?.edits ?? []).filter((e) => e && e.path && typeof e.new_contents === "string");
  } else {
    // Files too big — fall back to per-file mode (legacy path).
    for (const f of loaded) {
      const ai = await callAI({
        messages: [
          { role: "system", content: fullSystemMsg },
          {
            role: "user",
            content: [
              `Repo: ${repo.full_name}`,
              `Path: ${f.path}`,
              ``,
              `Plan hypothesis: ${loop.plan?.hypothesis ?? ""}`,
              `Proposed change: ${loop.plan?.proposed_change ?? ""}`,
              loop.bug_report ? `User bug report: ${loop.bug_report}` : "",
              failureDigest ? `\nCI FAILURE LOGS:\n${failureDigest}` : "",
              ``,
              `CURRENT FILE CONTENTS:`,
              "```",
              f.content,
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
              new_contents: { type: "string" },
              changed: { type: "boolean" },
              note: { type: "string" },
            },
            required: ["new_contents", "changed", "note"],
            additionalProperties: false,
          },
        },
      });
      const a = ai.tool as { new_contents: string; changed: boolean; note: string } | null;
      if (a) proposed.push({ path: f.path, ...a });
    }
  }

  // Apply edits: sanity-check first, then write only files that pass.
  let edits = 0;
  const skipped: string[] = [];
  const validationNotes: string[] = [];
  const repaired: string[] = [];
  for (const e of proposed) {
    const src = loaded.find((l) => l.path === e.path);
    if (!src) { skipped.push(`${e.path}: not in scope`); continue; }
    if (!e.changed || e.new_contents === src.content) continue;
    let toWrite = e.new_contents;
    let v = validateProposedFile(e.path, toWrite);
    if (!v.ok) {
      validationNotes.push(`${e.path}: rejected [${v.rule}] ${v.message}; attempting one-shot repair…`);
      try {
        const repairedContents = await repairProposedFile({
          path: e.path,
          rejectedContents: toWrite,
          reason: `[${v.rule}] ${v.message}`,
          originalContents: src.content,
          hypothesis: loop.plan?.hypothesis ?? "",
          proposedChange: loop.plan?.proposed_change ?? "",
        });
        if (repairedContents) {
          const v2 = validateProposedFile(e.path, repairedContents);
          if (v2.ok) {
            toWrite = repairedContents;
            v = { ok: true };
            repaired.push(e.path);
            validationNotes.push(`${e.path}: repair passed validation`);
          } else {
            validationNotes.push(`${e.path}: repair still invalid [${v2.rule}] ${v2.message}`);
          }
        } else {
          validationNotes.push(`${e.path}: repair returned no contents`);
        }
      } catch (err) {
        validationNotes.push(`${e.path}: repair errored (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    if (!v.ok) { skipped.push(`${e.path}: [${v.rule}] ${v.message}`); continue; }
    // Belt-and-braces: re-validate immediately before pushing. Repair is the
    // only path that could change toWrite after the first check, but if a
    // future refactor adds another mutation we still cannot push junk.
    const finalCheck = validateProposedFile(e.path, toWrite);
    if (!finalCheck.ok) {
      skipped.push(`${e.path}: final-check [${finalCheck.rule}] ${finalCheck.message}`);
      continue;
    }
    try {
      await putFile(token, repo.owner, repo.name, {
        path: e.path,
        content: toWrite,
        branch: loop.branch,
        message: `forge: ${(e.note || "automated edit").slice(0, 60)}`,
        sha: src.sha,
      });
      edits++;
    } catch (err) {
      skipped.push(`${e.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Append a repair-attempt note to the PR plan marker so the human reviewer
  // (and the next Hermes attempt) can see what we tried and what was rejected.
  if (validationNotes.length || repaired.length || skipped.length) {
    try {
      const markerPath = ".hermes/plan.md";
      const existing = await getFileContents(token, repo.owner, repo.name, markerPath, loop.branch);
      if (existing) {
        const block = [
          ``,
          `---`,
          ``,
          `## Attempt ${(loop.attempt_count ?? 0) + (loop.phase === "repair_patch" ? 1 : 0)} · pre-commit validation`,
          ``,
          `- Edits applied: ${edits}`,
          `- Files repaired in-flight: ${repaired.length ? repaired.map((p) => `\`${p}\``).join(", ") : "none"}`,
          `- Skipped: ${skipped.length ? skipped.slice(0, 8).map((s) => `\`${s}\``).join("; ") : "none"}`,
          ...(validationNotes.length ? [``, `**Validator notes:**`, ...validationNotes.map((n) => `- ${n}`)] : []),
        ].join("\n");
        await putFile(token, repo.owner, repo.name, {
          path: markerPath,
          content: existing.content + "\n" + block + "\n",
          branch: loop.branch,
          message: "chore(hermes): record validation notes",
          sha: existing.sha,
        });
      }
    } catch { /* non-fatal */ }
  }

  const parts: string[] = [];
  parts.push(edits === 0 ? "No file edits were applied" : `Patched ${edits} file${edits === 1 ? "" : "s"}`);
  if (repaired.length) parts.push(`${repaired.length} auto-repaired pre-commit`);
  if (skipped.length) parts.push(`${skipped.length} skipped: ${skipped.slice(0, 3).join("; ")}`);
  if (errors.length) parts.push(`${errors.length} load error${errors.length === 1 ? "" : "s"}`);
  return {
    phase: "commit",
    plan: {
      ...(loop.plan ?? {}),
      // @ts-expect-error stored alongside plan for UI rendering
      validation_notes: validationNotes.slice(-20),
    },
    message: parts.join(" · "),
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
  return { phase: "verify", message: "Commits pushed; verifying spec compliance", comment_kind: "progress" };
}

// ---------------------------------------------------------------------------
// Verify phase: does the diff actually satisfy the rules brief?
//
// Reads the final contents of every touched file from the PR branch and asks
// the model, using the research brief (if any) as ground truth, whether the
// change implements each rule. If any rule is unimplemented, the loop bounces
// back to `patch` with the rule-gap message as failure logs, up to the
// existing `max_attempts` budget. Otherwise it advances to `ready`.
// ---------------------------------------------------------------------------

async function runVerify(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const { loop, repo } = ctx;
  if (!loop.branch) {
    return { phase: "ready", message: "No branch to verify; skipping", comment_kind: "progress" };
  }
  const research = (loop.plan as { research?: ResearchBlock } | null)?.research;
  const rules = research?.rules_extracted?.trim() ?? "";
  // No authoritative rules brief → nothing to verify against. Skip cleanly.
  if (!rules || rules === "No external spec applies.") {
    return { phase: "ready", message: "No spec to verify against; proceeding to review", comment_kind: "progress" };
  }

  const files = (loop.suspect_files ?? []).slice(0, 5);
  const fileBlocks: string[] = [];
  for (const p of files) {
    try {
      const got = await getFileContents(token, repo.owner, repo.name, p, loop.branch);
      if (got?.content) fileBlocks.push(`### ${p}\n\`\`\`\n${got.content.slice(0, 6000)}\n\`\`\``);
    } catch { /* deleted or missing — non-fatal */ }
  }
  if (fileBlocks.length === 0) {
    return { phase: "ready", message: "No files to verify; proceeding to review", comment_kind: "progress" };
  }

  let ai;
  try {
    ai = await callAI({
      messages: [
        {
          role: "system",
          content:
            "You are Hermes' spec auditor. You are given (1) an authoritative rules brief and (2) the final contents of the files changed in the current PR branch. Decide, rule by rule, whether the code as it now stands implements that rule. Be strict: half-fixes count as GAP, not PASS. If a rule references validation, scoring, or bust/failure conditions and the code doesn't perform that validation, that's a GAP. Return a machine-readable audit.",
        },
        {
          role: "user",
          content: [
            `AUTHORITATIVE RULES BRIEF:`,
            rules,
            ``,
            `PR hypothesis: ${loop.plan?.hypothesis ?? "(none)"}`,
            `PR proposed change: ${loop.plan?.proposed_change ?? "(none)"}`,
            ``,
            `FINAL FILE CONTENTS ON PR BRANCH (${loop.branch}):`,
            fileBlocks.join("\n\n"),
          ].join("\n"),
        },
      ],
      tool: {
        name: "submit_verification",
        description: "Report whether the diff implements each rule in the brief.",
        parameters: {
          type: "object",
          properties: {
            gaps: {
              type: "array",
              description: "One entry per rule the code does NOT fully implement. Empty array means the diff is spec-complete.",
              items: {
                type: "object",
                properties: {
                  rule: { type: "string", description: "Verbatim rule text from the brief (or a paraphrase if numbered)." },
                  evidence: { type: "string", description: "Why the current code doesn't satisfy it — cite the file/function." },
                  suggested_fix: { type: "string", description: "One-sentence fix suggestion." },
                },
                required: ["rule", "evidence", "suggested_fix"],
                additionalProperties: false,
              },
            },
            summary: { type: "string", description: "One-sentence overall verdict." },
          },
          required: ["gaps", "summary"],
          additionalProperties: false,
        },
      },
    });
  } catch (e) {
    console.error("verify phase AI call failed:", e);
    return { phase: "ready", message: `Verify skipped (${e instanceof Error ? e.message.slice(0, 80) : "AI error"})`, comment_kind: "progress" };
  }
  const v = ai.tool as {
    gaps: Array<{ rule: string; evidence: string; suggested_fix: string }>;
    summary: string;
  } | null;
  if (!v) {
    return { phase: "ready", message: "Verify returned no audit; proceeding", comment_kind: "progress" };
  }

  if (v.gaps.length === 0) {
    const nextPlan = { ...(loop.plan ?? {}), verify: { summary: v.summary, gaps: [] as Array<{ rule: string; evidence: string; suggested_fix: string }> } } as unknown as LoopRow["plan"];
    return {
      phase: "ready",
      plan: nextPlan,
      message: `Verify passed · ${v.summary.slice(0, 120)}`,
      comment_kind: "progress",
    };
  }

  // Gaps exist → decide whether to bounce back to patch or block.
  const attempts = loop.attempt_count ?? 0;
  const max = loop.max_attempts ?? 3;
  const gapDigest = v.gaps
    .map((g, i) => `${i + 1}. ${g.rule}\n   evidence: ${g.evidence}\n   suggested fix: ${g.suggested_fix}`)
    .join("\n\n");

  // Post the gap list on the PR so the human reviewer sees it too.
  if (loop.pr_number) {
    try {
      await addPRComment(
        token,
        repo.owner,
        repo.name,
        loop.pr_number,
        `**Hermes spec verification — ${v.gaps.length} gap${v.gaps.length === 1 ? "" : "s"}**\n\n${v.summary}\n\n${gapDigest}`,
      );
    } catch { /* non-fatal */ }
  }

  if (attempts >= max) {
    const blockedPlan = { ...(loop.plan ?? {}), verify: { summary: v.summary, gaps: v.gaps } } as unknown as LoopRow["plan"];
    return {
      status: "failed",
      phase: "blocked",
      plan: blockedPlan,
      last_error: `Spec verification found ${v.gaps.length} unimplemented rule${v.gaps.length === 1 ? "" : "s"} after ${attempts} attempts.`,
      finished_at: new Date().toISOString(),
      message: `Verify failed after ${attempts} attempt${attempts === 1 ? "" : "s"} · ${v.gaps.length} rule gap${v.gaps.length === 1 ? "" : "s"}`,
      comment_kind: "error",
    };
  }

  // Bounce back to patch. Reuse the checks_payload channel so runPatch's
  // failureDigest picks up the rule gaps as if they were CI errors.
  const syntheticLogs: FailureLog[] = [
    {
      name: "hermes-spec-verify",
      kind: "check_run",
      url: null,
      log: `Spec verification found ${v.gaps.length} gap${v.gaps.length === 1 ? "" : "s"}:\n\n${gapDigest}`,
    },
  ];
  const patchPlan = { ...(loop.plan ?? {}), verify: { summary: v.summary, gaps: v.gaps } } as unknown as LoopRow["plan"];
  return {
    phase: "patch",
    attempt_count: attempts + 1,
    checks_status: "spec_gap",
    checks_payload: { failure_logs: syntheticLogs, verify_gaps: v.gaps, verify_summary: v.summary } as unknown as import("@/integrations/supabase/types").Json,
    plan: patchPlan,
    message: `Verify found ${v.gaps.length} spec gap${v.gaps.length === 1 ? "" : "s"} · repatching (${attempts + 1}/${max})`,
    comment_kind: "progress",
  };
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
      kind: "check_run" as const,
      check_run_id: r.id,
    })),
    ...statuses.map((s) => ({
      name: s.context,
      state: s.state,
      url: s.target_url,
      summary: s.description,
      kind: "status" as const,
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

  // For failures, pull real logs so the diagnose step has something to chew on.
  let failureLogs: FailureLog[] = [];
  if (failed.length > 0) {
    try {
      failureLogs = await collectFailureLogs(token, repo.owner, repo.name, failed);
    } catch (e) {
      console.error("collectFailureLogs failed:", e);
    }
  }

  const payload = {
    head_sha: headSha,
    started_at: new Date(startedAt).toISOString(),
    last_checked_at: new Date().toISOString(),
    checks: allChecks.map((c) => ({
      name: c.name,
      state: c.state,
      url: c.url,
      summary: c.summary,
    })),
    failure_logs: failureLogs,
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
    // Reconciliation: before we declare failure, ask GitHub whether the PR
    // was actually merged anyway (auto-merge or human merge despite failing
    // checks). If so, the loop is effectively complete and should NOT show
    // as ERROR in the dashboard.
    try {
      const prState = await getPRState(token, repo.owner, repo.name, loop.pr_number);
      if (prState.merged) {
        return {
          status: "completed",
          phase: "completed",
          checks_status: "merged_with_failures",
          checks_payload: payload,
          finished_at: new Date().toISOString(),
          message: `PR #${loop.pr_number} was merged despite ${failed.length} failing check${failed.length === 1 ? "" : "s"} · review recommended`,
          comment_kind: "completed",
        };
      }
    } catch (e) {
      console.error("getPRState failed during checks reconciliation:", e);
    }
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

async function runDiagnoseFailure(ctx: PhaseCtx, token: string): Promise<PhasePatch> {
  const { loop, repo } = ctx;
  const payload = (loop.checks_payload ?? {}) as {
    checks?: Array<{ name: string; state: string; url: string | null; summary: string | null }>;
    failure_logs?: FailureLog[];
  };
  const failed = (payload.checks ?? []).filter((c) =>
    ["failure", "error", "timed_out", "action_required", "cancelled"].includes(c.state),
  );
  const failureLogs = payload.failure_logs ?? [];
  const logDigest = failureLogs.length
    ? failureLogs.map((f) => `### ${f.name}\n${f.log || "(no log)"}`).join("\n\n").slice(0, 8000)
    : failed.map((f) => `- ${f.name} (${f.state})${f.summary ? `: ${f.summary.slice(0, 240)}` : ""}`).join("\n");

  // Pull explicit file:line:col references out of the build logs. These are
  // deterministic hints that the AI's free-text plan must respect.
  const extracted = extractErrorLocations(logDigest);

  // Read the files we touched last attempt + key build configs so the
  // model can reason about WHY the change broke the build.
  const fileBlocks: string[] = [];
  if (loop.branch) {
    const prevFiles = (loop.suspect_files ?? []).slice(0, 5);
    for (const p of prevFiles) {
      try {
        const got = await getFileContents(token, repo.owner, repo.name, p, loop.branch);
        if (got?.content) fileBlocks.push(`### ${p}\n\`\`\`\n${got.content.slice(0, 6000)}\n\`\`\``);
      } catch { /* file may have been deleted */ }
    }
    for (const p of PATCH_CONFIG_FILES) {
      try {
        const got = await getFileContents(token, repo.owner, repo.name, p, loop.branch);
        if (got?.content) fileBlocks.push(`### ${p}\n\`\`\`\n${got.content.slice(0, 2500)}\n\`\`\``);
      } catch { /* not present */ }
    }
  }

  const ai = await callAI({
    messages: [
      {
        role: "system",
        content:
          "You are Hermes. A PR you opened has failing CI/deploy checks. Read the failure logs and the current file contents on the PR branch, then propose a corrective plan focused ONLY on fixing those checks. Identify up to 5 likely files to modify (repo-relative paths). Be specific and conservative — fix the failure, do not refactor. If the root cause is the prior edit itself, the right fix may be to revert specific lines.",
      },
      {
        role: "user",
        content: [
          `Original hypothesis: ${loop.plan?.hypothesis ?? "(none)"}`,
          `Original proposed change: ${loop.plan?.proposed_change ?? "(none)"}`,
          `Previously touched files:\n${(loop.suspect_files ?? []).map((f) => `- ${f}`).join("\n") || "(none)"}`,
          extracted.length
            ? `\nEXPLICIT FILE:LINE ERRORS PARSED FROM LOGS (treat as ground truth):\n${extracted.map((e) => `- ${e.path}:${e.line}:${e.col} — ${e.message}`).join("\n")}`
            : "",
          ``,
          `FAILING CHECKS / BUILD LOGS:\n${logDigest || "(no detail available)"}`,
          fileBlocks.length ? `\nCURRENT FILES ON BRANCH:\n${fileBlocks.join("\n\n")}` : "",
        ].filter(Boolean).join("\n"),
      },
    ],
    tool: {
      name: "submit_repair_plan",
      description: "Submit a corrective plan for the failing checks.",
      parameters: {
        type: "object",
        properties: {
          diagnosis: { type: "string", description: "1-3 sentence root cause, citing the failing check and the offending line/file when possible." },
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
  // Always include files the build log explicitly named, even if the AI
  // forgot them. Deterministic hints beat AI inference.
  const aiSuspects = (repair.suspect_files ?? []).filter(Boolean);
  const explicit = extracted.map((e) => e.path);
  const mergedSet = new Set<string>([...explicit, ...aiSuspects]);
  const suspect = Array.from(mergedSet).slice(0, 5);
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
      // @ts-expect-error informational only — surfaced in UI
      build_errors: extracted.slice(0, 10),
    },
    message: `Diagnosis · ${repair.diagnosis.slice(0, 120)}`,
    comment_kind: "progress",
  };
}

// Extract file:line:col error references from raw build logs.
// Handles esbuild ("/path/to/file.ts:1:2: ERROR: ..."), tsc
// ("path/to/file.ts(12,5): error TSxxxx"), and Vite variants.
function extractErrorLocations(log: string): Array<{ path: string; line: number; col: number; message: string }> {
  if (!log) return [];
  const out: Array<{ path: string; line: number; col: number; message: string }> = [];
  const seen = new Set<string>();
  // esbuild / vite: /abs/or/rel/path.ts:LINE:COL: ERROR: message
  const esbuild = /(?:^|\s)((?:\/opt\/build\/repo\/)?(?:src|app|lib|pages|components|hooks|utils|server|routes)[^\s:()]*\.(?:tsx?|jsx?|mjs|cjs|json|toml|yaml|yml)):(\d+):(\d+)(?::\s*(?:ERROR|error|Error):?\s*([^\n]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = esbuild.exec(log)) !== null) {
    const path = m[1].replace(/^\/opt\/build\/repo\//, "");
    const line = Number(m[2]);
    const col = Number(m[3]);
    const message = (m[4] ?? "").trim().slice(0, 240);
    const key = `${path}:${line}:${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, line, col, message });
  }
  // tsc style: path/to/file.ts(12,5): error TSxxxx: message
  const tsc = /((?:src|app|lib|pages|components|hooks|utils|server|routes)[^\s:()]*\.(?:tsx?|jsx?)):?\((\d+),(\d+)\):\s*error\s+TS\d+:\s*([^\n]+)/g;
  while ((m = tsc.exec(log)) !== null) {
    const key = `${m[1]}:${m[2]}:${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: m[1], line: Number(m[2]), col: Number(m[3]), message: m[4].trim().slice(0, 240) });
  }
  return out.slice(0, 10);
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