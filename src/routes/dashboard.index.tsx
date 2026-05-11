import { createFileRoute } from "@tanstack/react-router";
import { GitPullRequest, Flame, GitBranch, Activity } from "lucide-react";
import { StatCard } from "@/components/forge/StatCard";
import { LoopControl } from "@/components/forge/LoopControl";
import { ActivityLog } from "@/components/forge/ActivityLog";
import { PRList } from "@/components/forge/PRList";
import { GoalsPanel } from "@/components/forge/GoalsPanel";
import { RepoCard } from "@/components/forge/RepoCard";

export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });

function DashboardHome() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-primary">The Forge</div>
        <h1 className="font-display text-3xl mt-1">Welcome back, Architect</h1>
        <p className="text-sm text-muted-foreground mt-1">3 loops are burning across your repositories.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active loops" value="3" delta="+1 today" icon={Flame} accent />
        <StatCard label="Open PRs" value="12" delta="4 awaiting review" icon={GitPullRequest} />
        <StatCard label="Repos connected" value="7" icon={GitBranch} />
        <StatCard label="Improvements / wk" value="48" delta="+22% vs last" icon={Activity} />
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
        <h2 className="font-display text-xl mb-3">Repositories</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <RepoCard name="skakig/hermes-webui" stars={128} prs={4} branch="forge/refactor" active />
          <RepoCard name="skakig/cae-content" stars={42} prs={2} branch="main" />
          <RepoCard name="skakig/desert-queen" stars={319} prs={6} branch="forge/docs" />
          <RepoCard name="skakig/oracle-api" stars={87} prs={1} branch="main" />
          <RepoCard name="skakig/runeforge-cli" stars={54} prs={0} branch="main" />
          <RepoCard name="skakig/sandstorm-core" stars={201} prs={3} branch="forge/types" />
        </div>
      </div>
    </div>
  );
}
