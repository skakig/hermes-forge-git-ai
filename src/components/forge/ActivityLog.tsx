import { useEffect } from "react";
import { GitPullRequest, Wand2, ScanSearch, GitMerge, AlertTriangle, CheckCircle2, Flame } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listActivityEvents } from "@/lib/dashboard.functions";
import { supabase } from "@/integrations/supabase/client";

const toneClass: Record<string, string> = {
  info: "text-muted-foreground",
  ember: "text-primary",
  warn: "text-amber-400",
  good: "text-emerald-400",
};

function iconFor(kind: string) {
  switch (kind) {
    case "loop_started": return { icon: Flame, tone: "ember" };
    case "progress": return { icon: ScanSearch, tone: "info" };
    case "pr_opened": return { icon: GitPullRequest, tone: "ember" };
    case "pr_merged": return { icon: GitMerge, tone: "good" };
    case "improvement": return { icon: Wand2, tone: "ember" };
    case "warning": return { icon: AlertTriangle, tone: "warn" };
    case "error": return { icon: AlertTriangle, tone: "warn" };
    case "completed": return { icon: CheckCircle2, tone: "good" };
    default: return { icon: ScanSearch, tone: "info" };
  }
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ActivityLog() {
  const fetchEvents = useServerFn(listActivityEvents);
  const queryClient = useQueryClient();
  const eventsQuery = useQuery({
    queryKey: ["forge", "activity"],
    queryFn: () => fetchEvents(),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel("activity_events_live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_events" },
        () => queryClient.invalidateQueries({ queryKey: ["forge", "activity"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const events = eventsQuery.data?.events ?? [];

  return (
    <div className="rounded-xl border border-border/60 glass">
      <div className="p-5 border-b border-border/60 flex items-center justify-between">
        <h3 className="font-display text-lg">Agent Activity</h3>
        <span className="text-xs text-muted-foreground font-mono">live · streaming</span>
      </div>
      {events.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground text-center">
          No activity yet. Ignite a loop to start forging.
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {events.map((e) => {
            const { icon: Icon, tone } = iconFor(e.kind);
            return (
              <li key={e.id} className="flex items-start gap-3 p-4 hover:bg-secondary/40 transition-colors">
                <div className={`mt-0.5 ${toneClass[tone]}`}><Icon className="size-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{e.message}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono">{timeAgo(e.created_at)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
