import { createFileRoute, Link } from "@tanstack/react-router";
import { GitPullRequest, Flame, GitBranch, Activity } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { StatCard } from "@/components/forge/StatCard";
import { LoopControl } from "@/components/forge/LoopControl";
import { ActivityLog } from "@/components/forge/ActivityLog";
import { PRList } from "@/components/forge/PRList";
import { GoalsPanel } from "@/components/forge/GoalsPanel";
import { RepoCard } from "@/components/forge/RepoCard";
import { getDashboardStats, listConnectedRepos } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });

function DashboardHome() {
  const fetchStats = useServerFn(getDashboardStats);
  const fetchRepos = useServerFn(listConnectedRepos);
  const statsQuery = useQuery({
    queryKey: ["forge", "stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 15_000,
  });
  const reposQuery = useQuery({
    queryKey: ["forge", "connected-repos"],
    queryFn: () => fetchRepos(),
    staleTime: 10_000,
  });
  const stats = statsQuery.data;
  const repos = reposQuery.data?.repos ?? [];
  const activeCount = stats?.activeLoops ?? 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-primary">The Forge</div>
        <h1 className="font-display text-3xl mt-1">Welcome back, Architect</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {activeCount === 0
            ? "No loops burning right now. Ignite one below."
            : `${activeCount} loop${activeCount === 1 ? "" : "s"} burning across your repositories.`}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active loops" value={String(stats?.activeLoops ?? 0)} icon={Flame} accent />
        <StatCard label="Open PRs" value={String(stats?.openPRs ?? 0)} icon={GitPullRequest} />
        <StatCard label="Repos in forge" value={String(stats?.reposConnected ?? 0)} icon={GitBranch} />
        <StatCard label="Events this week" value={String(stats?.improvementsThisWeek ?? 0)} icon={Activity} />
      </div>

      <LoopControl />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <GoalsPanel />
          <PRList />
        </div>
        <div className="space-y-6">
          <ActivityLog />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl">Repositories in The Forge</h2>
          <Link to="/dashboard/repos" className="text-xs text-primary hover:underline">Manage →</Link>
        </div>
        {repos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 glass p-8 text-center text-sm text-muted-foreground">
            No repositories added yet. <Link to="/dashboard/repos" className="text-primary hover:underline">Install the GitHub App</Link> to get started.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {repos.map((r) => (
              <RepoCard
                key={r.id}
                name={r.full_name}
                stars={0}
                branch={r.default_branch}
                isPrivate={r.private}
                added={r.status === "running"}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
