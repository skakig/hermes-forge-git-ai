import { GitBranch, Star, Lock, Box, Plus, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type CardProps = {
  name: string;
  stars: number;
  branch: string;
  isPrivate?: boolean;
  updatedAt?: string | null;
  added?: boolean;
  loading?: boolean;
  onAdd?: () => void;
};

function relativeTime(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export function RepoCard({ name, stars, branch, isPrivate, updatedAt, added, loading, onAdd }: CardProps) {
  const updated = relativeTime(updatedAt);
  return (
    <div className="group relative bg-card/40 border border-border/60 rounded-xl p-5 backdrop-blur-sm hover:bg-card/60 hover:border-primary/30 transition-all duration-300 flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div
          className={cn(
            "p-2.5 rounded-lg bg-white/5 border border-border/60 transition-colors",
            added ? "text-primary" : "text-muted-foreground group-hover:text-primary",
          )}
        >
          <Box className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
            <Star className="w-3 h-3" /> {stars}
          </div>
          {added ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-tight bg-primary/10 text-primary border border-primary/20 uppercase">
              Forge
            </span>
          ) : null}
        </div>
      </div>
      <h3 className="font-mono text-sm text-foreground font-medium mb-1.5 truncate" title={name}>
        {name}
      </h3>
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-5 min-h-[1rem]">
        {isPrivate ? (
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3" /> private
          </span>
        ) : null}
        <span className="flex items-center gap-1 font-mono truncate">
          <GitBranch className="w-3 h-3" /> {branch}
        </span>
        {updated ? <span className="truncate">Updated {updated}</span> : null}
      </div>
      <button
        onClick={onAdd}
        disabled={added || loading}
        className={cn(
          "mt-auto w-full py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2",
          added
            ? "bg-white/5 text-muted-foreground border border-border/60 cursor-default"
            : "text-primary-foreground bg-gradient-to-r from-primary to-[oklch(0.65_0.19_35)] hover:brightness-110 active:scale-[0.98] shadow-[0_10px_30px_-12px_oklch(0.72_0.18_45/0.5)]",
        )}
      >
        {added ? (
          <>
            <Check className="w-4 h-4" /> In The Forge
          </>
        ) : loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Adding…
          </>
        ) : (
          <>
            <Plus className="w-4 h-4" /> Add to Hermes
          </>
        )}
      </button>
    </div>
  );
}

// Compact single-row variant used by the "Dense" view.
export function RepoRow({ name, stars, branch, isPrivate, updatedAt, added, loading, onAdd }: CardProps) {
  const updated = relativeTime(updatedAt);
  return (
    <div className="group flex items-center gap-4 bg-card/30 border border-border/60 rounded-lg pl-3 pr-2 py-2 hover:bg-card/50 hover:border-primary/30 transition-all">
      <div
        className={cn(
          "p-1.5 rounded-md bg-white/5 border border-border/60 shrink-0",
          added ? "text-primary" : "text-muted-foreground group-hover:text-primary",
        )}
      >
        <Box className="w-3.5 h-3.5" />
      </div>
      <div className="font-mono text-sm text-foreground truncate flex-1 min-w-0">{name}</div>
      <div className="hidden md:flex items-center gap-4 text-[11px] text-muted-foreground">
        {isPrivate ? (
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3" /> private
          </span>
        ) : null}
        <span className="flex items-center gap-1 font-mono">
          <Star className="w-3 h-3" /> {stars}
        </span>
        <span className="flex items-center gap-1 font-mono">
          <GitBranch className="w-3 h-3" /> {branch}
        </span>
        {updated ? <span className="w-20 text-right truncate">{updated}</span> : null}
        {added ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-tight bg-primary/10 text-primary border border-primary/20 uppercase">
            Forge
          </span>
        ) : null}
      </div>
      <button
        onClick={onAdd}
        disabled={added || loading}
        className={cn(
          "shrink-0 h-8 px-3 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5",
          added
            ? "bg-white/5 text-muted-foreground cursor-default"
            : "text-primary-foreground bg-gradient-to-r from-primary to-[oklch(0.65_0.19_35)] hover:brightness-110 active:scale-[0.98]",
        )}
      >
        {added ? (
          <>
            <Check className="w-3 h-3" /> Added
          </>
        ) : loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <>
            <Plus className="w-3 h-3" /> Add
          </>
        )}
      </button>
    </div>
  );
}