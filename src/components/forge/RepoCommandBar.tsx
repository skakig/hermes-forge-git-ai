import { Search, ChevronDown, LayoutGrid, List, ArrowDownUp } from "lucide-react";
import { forwardRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type RepoFilter = "all" | "inForge" | "notAdded" | "private" | "public";
export type RepoSort = "updated" | "stars" | "name";
export type RepoView = "grid" | "dense";

const FILTERS: { id: RepoFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "inForge", label: "In Forge" },
  { id: "notAdded", label: "Not added" },
  { id: "private", label: "Private" },
  { id: "public", label: "Public" },
];

const SORTS: { id: RepoSort; label: string }[] = [
  { id: "updated", label: "Recently updated" },
  { id: "stars", label: "Stars" },
  { id: "name", label: "Name (A→Z)" },
];

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  filter: RepoFilter;
  onFilterChange: (f: RepoFilter) => void;
  sort: RepoSort;
  onSortChange: (s: RepoSort) => void;
  view: RepoView;
  onViewChange: (v: RepoView) => void;
};

export const RepoCommandBar = forwardRef<HTMLInputElement, Props>(function RepoCommandBar(
  { query, onQueryChange, filter, onFilterChange, sort, onSortChange, view, onViewChange },
  ref,
) {
  const sortLabel = SORTS.find((s) => s.id === sort)?.label ?? "Sort";
  return (
    <div className="sticky top-4 z-30">
      <div className="bg-card/80 backdrop-blur-xl border border-border/60 rounded-2xl shadow-[var(--shadow-deep)] overflow-hidden">
        {/* Search row */}
        <div className="flex items-center px-4 py-3.5 border-b border-border/40">
          <Search className="w-4 h-4 text-muted-foreground mr-3 shrink-0" />
          <input
            ref={ref}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by repository name or owner..."
            className="bg-transparent border-none outline-none flex-1 text-foreground placeholder:text-muted-foreground/60 text-sm font-medium"
          />
          <kbd className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 border border-border/60 text-[10px] text-muted-foreground font-mono">
            <span className="text-xs">⌘</span>K
          </kbd>
          {/* Mobile view toggle inline */}
          <div className="flex md:hidden ml-2 bg-white/5 p-0.5 rounded-md border border-border/60">
            <button
              onClick={() => onViewChange("grid")}
              className={cn(
                "p-1.5 rounded transition-colors",
                view === "grid" ? "bg-white/10 text-foreground" : "text-muted-foreground",
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onViewChange("dense")}
              className={cn(
                "p-1.5 rounded transition-colors",
                view === "dense" ? "bg-white/10 text-foreground" : "text-muted-foreground",
              )}
              aria-label="Dense view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-3 bg-white/[0.02]">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => onFilterChange(f.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
                <ArrowDownUp className="w-3 h-3" />
                <span>Sort: <span className="text-foreground">{sortLabel}</span></span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              {SORTS.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onSelect={() => onSortChange(s.id)}
                  className={cn("text-xs", sort === s.id && "text-primary")}
                >
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
});