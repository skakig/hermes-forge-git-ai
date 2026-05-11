import { GitBranch, Star, GitPullRequest } from "lucide-react";
import { cn } from "@/lib/utils";

export function RepoCard({ name, stars, prs, branch, active }:
  { name: string; stars: number; prs: number; branch: string; active?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border/60 glass p-4 hover:border-primary/40 transition-colors cursor-pointer",
      active && "border-primary/60")}>
      <div className="flex items-center justify-between">
        <div className="font-mono text-sm text-foreground truncate">{name}</div>
        {active && <span className="text-[10px] uppercase tracking-widest text-primary">Active</span>}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Star className="size-3" /> {stars}</span>
        <span className="flex items-center gap-1"><GitPullRequest className="size-3" /> {prs}</span>
        <span className="flex items-center gap-1 truncate"><GitBranch className="size-3" /> {branch}</span>
      </div>
    </div>
  );
}
