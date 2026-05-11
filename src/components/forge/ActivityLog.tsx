import { GitPullRequest, Wand2, ScanSearch, GitMerge, AlertTriangle, CheckCircle2 } from "lucide-react";

const events = [
  { icon: ScanSearch, text: "Audited 412 files in skakig/hermes-webui", time: "just now", tone: "info" },
  { icon: Wand2, text: "Generated 7 improvements · refactor module loader", time: "2m ago", tone: "ember" },
  { icon: GitPullRequest, text: "Opened PR #284 · 'forge/refactor-loader'", time: "3m ago", tone: "ember" },
  { icon: AlertTriangle, text: "Flagged 3 type-safety risks in /api/ingest", time: "11m ago", tone: "warn" },
  { icon: CheckCircle2, text: "Merged PR #281 · docs improvements", time: "1h ago", tone: "good" },
  { icon: GitMerge, text: "Started loop · goal: 'Make CAE content better'", time: "2h ago", tone: "info" },
];

const toneClass: Record<string, string> = {
  info: "text-muted-foreground",
  ember: "text-primary",
  warn: "text-amber-400",
  good: "text-emerald-400",
};

export function ActivityLog() {
  return (
    <div className="rounded-xl border border-border/60 glass">
      <div className="p-5 border-b border-border/60 flex items-center justify-between">
        <h3 className="font-display text-lg">Agent Activity</h3>
        <span className="text-xs text-muted-foreground font-mono">live · streaming</span>
      </div>
      <ul className="divide-y divide-border/40">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-3 p-4 hover:bg-secondary/40 transition-colors">
            <div className={`mt-0.5 ${toneClass[e.tone]}`}><e.icon className="size-4" /></div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-foreground truncate">{e.text}</div>
              <div className="text-xs text-muted-foreground mt-0.5 font-mono">{e.time}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
