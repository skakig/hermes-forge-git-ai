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
import { startHermesLoop, pollLoopStatus, listLoops, cancelLoop } from "@/lib/hermes.functions";
import { listConnectedRepos } from "@/lib/dashboard.functions";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const phaseOrder = ["audit", "plan", "draft_pr", "patch", "commit", "ready", "completed"];
const phaseLabels: Record<string, string> = {
  audit: "Auditing source tree",
  plan: "Forming a plan",
  draft_pr: "Opening draft PR",
  patch: "Editing files",
  commit: "Pushing commits",
  ready: "Flipping to ready for review",
  completed: "Done",
  error: "Failed",
  canceled: "Canceled",
};

export function LoopControl() {
  const queryClient = useQueryClient();
  const fetchRepos = useServerFn(listConnectedRepos);
  const fetchLoops = useServerFn(listLoops);
  const startFn = useServerFn(startHermesLoop);
  const pollFn = useServerFn(pollLoopStatus);
  const cancelFn = useServerFn(cancelLoop);
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
        </div>
      )}
    </div>
  );
}
