import { useEffect, useState } from "react";
import { Flame, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startHermesLoop, pollLoopStatus, listLoops } from "@/lib/hermes.functions";
import { listConnectedRepos } from "@/lib/dashboard.functions";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const phaseOrder = ["queued", "starting", "auditing", "critiquing", "generating", "drafting", "completed"];
const phaseLabels: Record<string, string> = {
  queued: "Queued",
  starting: "Starting loop",
  auditing: "Auditing source tree",
  critiquing: "Critiquing quality & content",
  generating: "Generating improvements",
  drafting: "Drafting branch & PR",
  completed: "PR opened",
  error: "Failed",
};

export function LoopControl() {
  const queryClient = useQueryClient();
  const fetchRepos = useServerFn(listConnectedRepos);
  const fetchLoops = useServerFn(listLoops);
  const startFn = useServerFn(startHermesLoop);
  const pollFn = useServerFn(pollLoopStatus);
  const [selectedRepo, setSelectedRepo] = useState<string | undefined>();

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

  // Poll the active loop more aggressively
  useEffect(() => {
    if (!activeLoop) return;
    const id = setInterval(() => {
      pollFn({ data: { loop_id: activeLoop.id } })
        .then(() => queryClient.invalidateQueries({ queryKey: ["forge"] }))
        .catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, [activeLoop?.id, pollFn, queryClient]);

  const startMutation = useMutation({
    mutationFn: (repository_id: string) => startFn({ data: { repository_id } }),
    onSuccess: () => {
      toast("Self-Improvement Loop ignited", { description: "Hermes is starting on your repo." });
      queryClient.invalidateQueries({ queryKey: ["forge"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to start loop"),
  });

  const repos = reposQuery.data?.repos ?? [];
  const running = !!activeLoop;
  const currentPhase = activeLoop?.phase ?? "queued";
  const currentIdx = Math.max(0, phaseOrder.indexOf(currentPhase));
  const visiblePhases = phaseOrder.slice(0, 6);

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
              : "The agent will audit the repo, critique quality, generate refinements, then open a clean branch and pull request — autonomously."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!running && repos.length > 0 ? (
            <Select value={selectedRepo} onValueChange={setSelectedRepo}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Choose repo" /></SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {running ? (
            <Button size="lg" variant="outline" disabled className="gap-2">
              <Loader2 className="size-4 animate-spin" /> Running…
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={() => selectedRepo && startMutation.mutate(selectedRepo)}
              disabled={!selectedRepo || startMutation.isPending || repos.length === 0}
              className="gap-2 ember-gradient text-primary-foreground border-0 shadow-[var(--shadow-ember)] hover:opacity-95"
            >
              <Flame className="size-4" /> {startMutation.isPending ? "Igniting…" : "Ignite loop"}
            </Button>
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
              View PR <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}
