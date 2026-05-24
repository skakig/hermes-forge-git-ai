import { useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listGoals, upsertGoal, toggleGoal, deleteGoal } from "@/lib/dashboard.functions";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const presets = [
  "Improve documentation",
  "Add new features",
  "Refactor module loader",
  "Tighten type safety",
  "Boost test coverage",
];

export function GoalsPanel() {
  const queryClient = useQueryClient();
  const fetchGoals = useServerFn(listGoals);
  const upsertFn = useServerFn(upsertGoal);
  const toggleFn = useServerFn(toggleGoal);
  const deleteFn = useServerFn(deleteGoal);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const goalsQuery = useQuery({
    queryKey: ["forge", "goals"],
    queryFn: () => fetchGoals(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["forge", "goals"] });

  const addMut = useMutation({
    mutationFn: (label: string) => upsertFn({ data: { label } }),
    onSuccess: () => { invalidate(); setDraft(""); setAdding(false); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add goal"),
  });
  const toggleMut = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggleFn({ data: v }),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
  });

  const goals = goalsQuery.data?.goals ?? [];
  const existingLabels = new Set(goals.map((g) => g.label));

  return (
    <div className="rounded-xl border border-border/60 glass p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Active Goals</h3>
        <button onClick={() => setAdding((v) => !v)} className="text-xs text-primary hover:underline flex items-center gap-1"><Plus className="size-3" /> Custom</button>
      </div>
      {adding ? (
        <form
          className="flex gap-2 mb-3"
          onSubmit={(e) => { e.preventDefault(); if (draft.trim()) addMut.mutate(draft.trim()); }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Custom goal…" autoFocus />
          <button type="submit" disabled={addMut.isPending} className="px-3 rounded-md bg-primary text-primary-foreground text-sm">Add</button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {goals.map((g) => (
          <span key={g.id} className={cn(
            "group inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full text-xs border transition-all",
            g.active
              ? "border-primary/60 bg-primary/15 text-primary shadow-[var(--glow-rune)]"
              : "border-border/60 text-muted-foreground"
          )}>
            <button onClick={() => toggleMut.mutate({ id: g.id, active: !g.active })}>{g.label}</button>
            <button onClick={() => deleteMut.mutate(g.id)} className="opacity-50 hover:opacity-100"><X className="size-3" /></button>
          </span>
        ))}
        {presets.filter((p) => !existingLabels.has(p)).map((p) => (
          <button
            key={p}
            onClick={() => addMut.mutate(p)}
            className="px-3 py-1.5 rounded-full text-xs border border-dashed border-border/60 text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all"
          >
            + {p}
          </button>
        ))}
      </div>
    </div>
  );
}
