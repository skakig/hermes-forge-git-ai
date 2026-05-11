import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label, value, delta, icon: Icon, accent,
}: { label: string; value: string; delta?: string; icon: LucideIcon; accent?: boolean }) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border border-border/60 glass p-5",
      accent && "border-primary/40"
    )}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="mt-2 font-display text-3xl">{value}</div>
          {delta && <div className="mt-1 text-xs text-primary">{delta}</div>}
        </div>
        <div className={cn("size-10 rounded-lg grid place-items-center",
          accent ? "ember-gradient text-primary-foreground" : "bg-secondary text-foreground")}>
          <Icon className="size-5" />
        </div>
      </div>
      {accent && <div className="absolute -bottom-12 -right-12 size-40 rounded-full bg-primary/20 blur-3xl" />}
    </div>
  );
}
