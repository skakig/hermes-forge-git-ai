import { useEffect, useRef, useState } from "react";
import { Flame, Loader2, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startHermesLoop, pollLoopStatus, listLoops, cancelLoop, resumeLoop } from "@/lib/hermes.functions";
import { listConnectedRepos } from "@/lib/dashboard.functions";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const phaseOrder = ["audit", "plan", "research", "draft_pr", "patch", "commit", "ready", "checks_pending", "completed"];
const phaseLabels: Record<string, string> = {
  audit: "Auditing source tree",
  plan: "Forming a plan",
  research: "Researching authoritative rules",
  draft_pr: "Opening draft PR",
  patch: "Editing files",
  commit: "Pushing commits",
  ready: "Flipping to ready for review",
  checks_pending: "Waiting on CI checks",
  diagnose_failure: "Diagnosing failed checks",
  repair_patch: "Patching to fix CI",
  completed: "Done",
  error: "Failed",
  blocked: "Blocked · needs human review",
  canceled: "Canceled",
};

type CheckItem = { name: string; state: string; url: string | null; summary: string | null };
type FailureLog = { name: string; kind: "check_run" | "status"; url: string | null; log: string };

function checkTone(state: string): string {
  if (["success", "completed"].includes(state)) return "text-emerald-400";
  if (["failure", "error", "timed_out", "action_required", "cancelled"].includes(state)) return "text-red-400";
  if (["pending", "queued", "in_progress"].includes(state)) return "text-amber-300";
  return "text-muted-foreground";
}

function CheckRunList({
  loop,
}: {
  loop: {
    attempt_count?: number | null;
    max_attempts?: number | null;
    checks_status?: string | null;
    checks_payload?: unknown;
    last_error?: string | null;
    plan?: unknown;
    phase?: string | null;
  };
}) {
  const payload = (loop.checks_payload ?? {}) as {
    checks?: CheckItem[];
    failure_logs?: FailureLog[];
  };
  const checks = payload.checks ?? [];
  const failureLogs = payload.failure_logs ?? [];
  const plan = (loop.plan ?? {}) as { hypothesis?: string; proposed_change?: string };
  const planExtra = (loop.plan ?? {}) as {
    validation_notes?: string[];
    build_errors?: Array<{ path: string; line: number; col: number; message: string }>;
  };
  const showDiagnosis = (loop.phase === "diagnose_failure" || loop.phase === "repair_patch" || loop.phase === "blocked")
    && (plan.hypothesis || plan.proposed_change);
  const hasValidationNotes = (planExtra.validation_notes?.length ?? 0) > 0;
  const hasBuildErrors = (planExtra.build_errors?.length ?? 0) > 0;
  if (!loop.checks_status && checks.length === 0 && !loop.last_error && !showDiagnosis && !hasValidationNotes && !hasBuildErrors) return null;
  const attempts = loop.attempt_count ?? 0;
  const max = loop.max_attempts ?? 3;
  return (
    <div className="relative mt-4 rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>CI checks {loop.checks_status ? `· ${loop.checks_status}` : ""}</span>
        <span className="font-mono">repair {attempts}/{max}</span>
      </div>
      {checks.length > 0 ? (
        <ul className="mt-2 grid gap-1 max-h-40 overflow-auto pr-1">
          {checks.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                <span className={`font-mono uppercase mr-2 ${checkTone(c.state)}`}>{c.state}</span>
                <span className="text-foreground">{c.name}</span>
              </span>
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline shrink-0">
                  logs <ExternalLink className="size-3" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {showDiagnosis ? (
        <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-2">
          <div className="text-[10px] uppercase tracking-wider text-amber-300/80 mb-1">Hermes diagnosis</div>
          {plan.hypothesis ? <div className="text-xs text-amber-100/90">{plan.hypothesis}</div> : null}
          {plan.proposed_change ? (
            <div className="mt-1 text-xs text-amber-100/70"><span className="text-amber-300/80">Fix:</span> {plan.proposed_change}</div>
          ) : null}
          {hasBuildErrors ? (
            <div className="mt-2 grid gap-0.5">
              <div className="text-[10px] uppercase tracking-wider text-amber-300/80">Parsed build errors</div>
              {planExtra.build_errors!.slice(0, 5).map((e, i) => (
                <div key={i} className="text-[11px] font-mono text-amber-100/80">
                  {e.path}:{e.line}:{e.col} — {e.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {hasValidationNotes ? (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
            Pre-commit validation ({planExtra.validation_notes!.length}) — click to expand
          </summary>
          <ul className="mt-2 grid gap-0.5 text-[11px] font-mono text-foreground/75">
            {planExtra.validation_notes!.map((n, i) => (
              <li key={i} className="whitespace-pre-wrap break-words">{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {failureLogs.length > 0 ? (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
            Failure logs ({failureLogs.length}) — click to expand
          </summary>
          <div className="mt-2 grid gap-2">
            {failureLogs.map((f, i) => (
              <div key={`${f.name}-${i}`} className="rounded border border-border/60 bg-background/60 p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center justify-between gap-2">
                  <span>{f.name}</span>
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
                      open <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
                <pre className="text-[11px] leading-snug font-mono text-foreground/80 whitespace-pre-wrap break-words max-h-56 overflow-auto">
                  {f.log || "(no log captured)"}
                </pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {loop.last_error ? (
        <div className="mt-2 text-xs text-red-300/90 font-mono whitespace-pre-wrap break-words">
          {loop.last_error}
        </div>
      ) : null}
    </div>
  );
}

export function LoopControl() {
  const queryClient = useQueryClient();
  const fetchRepos = useServerFn(listConnectedRepos);
  const fetchLoops = useServerFn(listLoops);
  const startFn = useServerFn(startHermesLoop);
  const pollFn = useServerFn(pollLoopStatus);
  const cancelFn = useServerFn(cancelLoop);
  const resumeFn = useServerFn(resumeLoop);
  const [selectedRepo, setSelectedRepo] = useState<string | undefined>();
  const [bugReport, setBugReport] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const reposQuery = useQuery({
    queryKey: ["forge", "connected-repos"],
    queryFn: () => fetchRepos(),
    staleTime: 10_000,
  });

  const loopsQuery = useQuery({
    queryKey: ["forge", "loops"],
    queryFn: () => fetchLoops(),
    refetchInterval: 5_000,
  });

  const activeLoop = loopsQuery.data?.loops.find(
    (l) => l.status === "running" || l.status === "queued",
  );

  // Drive phase transitions server-side. Single in-flight call per loop;
  // the server holds a per-loop lock so duplicates are harmless anyway.
  const inflight = useRef(false);
  useEffect(() => {
    if (!activeLoop || inflight.current) return;
    inflight.current = true;
    pollFn({ data: { loop_id: activeLoop.id } })
      .then(() => queryClient.invalidateQueries({ queryKey: ["forge"] }))
      .catch(() => {})
      .finally(() => { inflight.current = false; });
  }, [activeLoop?.id, activeLoop?.phase, pollFn, queryClient]);

  const startMutation = useMutation({
    mutationFn: (args: { repository_id: string; bug_report?: string }) => startFn({ data: args }),
    onSuccess: () => {
      toast("Self-Improvement Loop ignited", { description: "Hermes is auditing your repo." });
      setDialogOpen(false);
      setBugReport("");
      queryClient.invalidateQueries({ queryKey: ["forge"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to start loop"),
  });

  const cancelMutation = useMutation({
    mutationFn: (loop_id: string) => cancelFn({ data: { loop_id } }),
    onSuccess: () => {
      toast("Loop canceled");
      queryClient.invalidateQueries({ queryKey: ["forge"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Cancel failed"),
  });

  const resumeMutation = useMutation({
    mutationFn: (loop_id: string) => resumeFn({ data: { loop_id } }),
    onSuccess: () => {
      toast("Loop resumed");
      queryClient.invalidateQueries({ queryKey: ["forge"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Resume failed"),
  });

  const lastFailed = loopsQuery.data?.loops.find(
    (l) => l.status === "failed" || l.phase === "blocked",
  );

  const repos = reposQuery.data?.repos ?? [];
  const running = !!activeLoop;
  const currentPhase = activeLoop?.phase ?? "queued";
  const currentIdx = Math.max(0, phaseOrder.indexOf(currentPhase));
  const visiblePhases = phaseOrder;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 p-6 glass">
      <div className="absolute inset-0 rune-grid opacity-40 pointer-events-none" />
      <div className="absolute -top-20 -right-20 size-64 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-primary mb-2">Hermes Forge · Ritual</div>
          <h2 className="font-display text-3xl text-foreground">Start Self-Improvement Loop</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg">
            {repos.length === 0
              ? "Add a repository to The Forge first (Dashboard → Repositories) before igniting a loop."
              : "The agent audits the repo, drafts a PR with its plan, edits files, then flips the PR to ready for review — autonomously."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {running ? (
            <div className="flex items-center gap-2">
              <Button size="lg" variant="outline" disabled className="gap-2">
                <Loader2 className="size-4 animate-spin" /> Running…
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Cancel loop"
                onClick={() => cancelMutation.mutate(activeLoop!.id)}
                disabled={cancelMutation.isPending}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  size="lg"
                  disabled={repos.length === 0}
                  className="gap-2 ember-gradient text-primary-foreground border-0 shadow-[var(--shadow-ember)] hover:opacity-95"
                >
                  <Flame className="size-4" /> Ignite loop
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle className="font-display text-2xl">Ignite a Self-Improvement Loop</DialogTitle>
                  <DialogDescription>
                    Pick a repo and optionally describe a specific bug or task. Hermes opens a draft PR with its plan before writing any code.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground">Repository</label>
                    <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                      <SelectTrigger><SelectValue placeholder="Choose a repo in The Forge" /></SelectTrigger>
                      <SelectContent>
                        {repos.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Bug report / instructions <span className="text-muted-foreground/60">(optional)</span>
                    </label>
                    <Textarea
                      value={bugReport}
                      onChange={(e) => setBugReport(e.target.value)}
                      placeholder="e.g. The dice probability calculation returns wrong odds when rolling 3 or more dice. Should be much lower than what it shows."
                      rows={5}
                      className="resize-none"
                    />
                    <p className="text-xs text-muted-foreground">
                      Used to steer this loop in addition to your standing goals.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() =>
                      selectedRepo &&
                      startMutation.mutate({
                        repository_id: selectedRepo,
                        bug_report: bugReport.trim() || undefined,
                      })
                    }
                    disabled={!selectedRepo || startMutation.isPending}
                    className="gap-2 ember-gradient text-primary-foreground border-0 shadow-[var(--shadow-ember)] hover:opacity-95"
                  >
                    <Flame className="size-4" /> {startMutation.isPending ? "Igniting…" : "Ignite loop"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
      {running && (
        <div className="relative mt-6 grid gap-2">
          {visiblePhases.map((p, i) => (
            <div key={p} className={`flex items-center gap-3 text-sm ${i < currentIdx ? "text-foreground" : i === currentIdx ? "text-primary" : "text-muted-foreground/60"}`}>
              {i === currentIdx ? <Loader2 className="size-3.5 animate-spin" /> :
               i < currentIdx ? <div className="size-1.5 rounded-full bg-primary" /> :
               <div className="size-1.5 rounded-full bg-muted-foreground/30" />}
              <span className="font-mono text-xs uppercase tracking-wider">{phaseLabels[p] ?? p}</span>
            </div>
          ))}
          {activeLoop?.pr_url ? (
            <a href={activeLoop.pr_url} target="_blank" rel="noreferrer" className="mt-2 text-xs text-primary inline-flex items-center gap-1 hover:underline">
              View draft PR #{activeLoop.pr_number} <ExternalLink className="size-3" />
            </a>
          ) : null}
          <CheckRunList loop={activeLoop!} />
        </div>
      )}
      {!running && lastFailed ? (
        <div className="relative mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-amber-200/90">
              Last loop ended in <span className="font-mono uppercase">{lastFailed.phase}</span>.
              {lastFailed.pr_url ? (
                <> <a href={lastFailed.pr_url} target="_blank" rel="noreferrer" className="underline">View PR #{lastFailed.pr_number}</a>.</>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => resumeMutation.mutate(lastFailed.id)}
              disabled={resumeMutation.isPending}
            >
              Resume / retry repair
            </Button>
          </div>
          <CheckRunList loop={lastFailed} />
        </div>
      ) : null}
    </div>
  );
}
