import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const presets = [
  "Improve documentation",
  "Add new features",
  "Refactor module loader",
  "Make CAE content better",
  "Tighten type safety",
  "Boost test coverage",
];

export function GoalsPanel() {
  const [active, setActive] = useState<string[]>(["Improve documentation", "Make CAE content better"]);
  const toggle = (g: string) =>
    setActive(a => a.includes(g) ? a.filter(x => x !== g) : [...a, g]);

  return (
    <div className="rounded-xl border border-border/60 glass p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Active Goals</h3>
        <button className="text-xs text-primary hover:underline flex items-center gap-1"><Plus className="size-3" /> Custom</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map(g => (
          <button key={g} onClick={() => toggle(g)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs border transition-all",
              active.includes(g)
                ? "border-primary/60 bg-primary/15 text-primary shadow-[var(--glow-rune)]"
                : "border-border/60 text-muted-foreground hover:border-primary/30 hover:text-foreground"
            )}>
            {g}
          </button>
        ))}
      </div>
    </div>
  );
}
