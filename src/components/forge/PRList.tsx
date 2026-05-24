import { GitPullRequest, GitMerge, Clock, ExternalLink } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listPullRequests } from "@/lib/dashboard.functions";

const statusBadge: Record<string, string> = {
  open: "bg-primary/15 text-primary border-primary/30",
  running: "bg-primary/15 text-primary border-primary/30",
  review: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  merged: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
};

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function PRList() {
  const fetchPRs = useServerFn(listPullRequests);
  const prsQuery = useQuery({
    queryKey: ["forge", "prs"],
    queryFn: () => fetchPRs(),
    refetchInterval: 15_000,
  });
  const prs = prsQuery.data?.prs ?? [];

  return (
    <div className="rounded-xl border border-border/60 glass">
      <div className="p-5 border-b border-border/60 flex items-center justify-between">
        <h3 className="font-display text-lg">Recent Pull Requests</h3>
      </div>
      {prs.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground text-center">No pull requests yet.</div>
      ) : (
        <ul className="divide-y divide-border/40">
          {prs.map((pr) => (
            <li key={pr.id} className="flex items-center gap-3 p-4 hover:bg-secondary/40 transition-colors">
              {pr.status === "merged" || pr.status === "completed"
                ? <GitMerge className="size-4 text-emerald-400" />
                : <GitPullRequest className="size-4 text-primary" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono text-foreground truncate">
                  {pr.pr_number ? `#${pr.pr_number} · ` : ""}{pr.branch}
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider ${statusBadge[pr.status] ?? "border-border/60 text-muted-foreground"}`}>{pr.status}</span>
              <span className="text-xs text-muted-foreground font-mono flex items-center gap-1"><Clock className="size-3" /> {timeAgo(pr.started_at)}</span>
              {pr.pr_url ? (
                <a href={pr.pr_url} target="_blank" rel="noreferrer" className="text-primary"><ExternalLink className="size-3.5" /></a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
