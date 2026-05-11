import { GitPullRequest, GitMerge, Clock } from "lucide-react";

const prs = [
  { num: 284, title: "forge/refactor-module-loader", status: "open", time: "3m" },
  { num: 282, title: "forge/improve-readme-structure", status: "review", time: "47m" },
  { num: 281, title: "forge/docs/api-reference-cleanup", status: "merged", time: "1h" },
  { num: 279, title: "forge/cae-content-rewrite", status: "merged", time: "5h" },
  { num: 277, title: "forge/typesafe-ingest-pipeline", status: "open", time: "1d" },
];

const statusBadge: Record<string, string> = {
  open: "bg-primary/15 text-primary border-primary/30",
  review: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  merged: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

export function PRList() {
  return (
    <div className="rounded-xl border border-border/60 glass">
      <div className="p-5 border-b border-border/60 flex items-center justify-between">
        <h3 className="font-display text-lg">Recent Pull Requests</h3>
        <a href="#" className="text-xs text-primary hover:underline">View all</a>
      </div>
      <ul className="divide-y divide-border/40">
        {prs.map(pr => (
          <li key={pr.num} className="flex items-center gap-3 p-4 hover:bg-secondary/40 transition-colors">
            {pr.status === "merged"
              ? <GitMerge className="size-4 text-emerald-400" />
              : <GitPullRequest className="size-4 text-primary" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-mono text-foreground truncate">#{pr.num} · {pr.title}</div>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider ${statusBadge[pr.status]}`}>{pr.status}</span>
            <span className="text-xs text-muted-foreground font-mono flex items-center gap-1"><Clock className="size-3" /> {pr.time}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
