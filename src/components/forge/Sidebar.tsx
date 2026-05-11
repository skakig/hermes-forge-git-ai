import { Link } from "@tanstack/react-router";
import { LayoutDashboard, GitBranch, Target, Activity, Settings, Flame } from "lucide-react";

const nav = [
  { to: "/dashboard", label: "Forge", icon: LayoutDashboard },
  { to: "/dashboard/repos", label: "Repositories", icon: GitBranch },
  { to: "/dashboard/goals", label: "Goals", icon: Target },
  { to: "/dashboard/activity", label: "Activity", icon: Activity },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border/60 glass">
      <div className="p-6 flex items-center gap-3">
        <div className="size-10 rounded-xl ember-gradient grid place-items-center shadow-[var(--shadow-ember)]">
          <Flame className="size-5 text-primary-foreground" />
        </div>
        <div>
          <div className="font-display text-lg leading-none">Hermes</div>
          <div className="text-xs text-muted-foreground tracking-widest uppercase">Forge</div>
        </div>
      </div>
      <nav className="px-3 flex-1 space-y-1">
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/dashboard" }}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            activeProps={{ className: "bg-secondary text-foreground" }}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="p-4 m-3 rounded-xl border border-primary/30 bg-primary/5">
        <div className="text-xs text-primary/90 uppercase tracking-wider mb-1">Background Mode</div>
        <div className="text-sm text-foreground">Agent active · 3 loops running</div>
        <div className="mt-2 size-2 rounded-full bg-primary pulse-ember" />
      </div>
    </aside>
  );
}
