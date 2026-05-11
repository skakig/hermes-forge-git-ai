import { useState } from "react";
import { Flame, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const phases = [
  "Cloning repository",
  "Auditing source tree",
  "Critiquing quality & content",
  "Generating improvements",
  "Drafting branch & PR",
];

export function LoopControl() {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(0);

  const start = () => {
    setRunning(true); setPhase(0);
    toast("Self-Improvement Loop ignited", { description: "Hermes is auditing your repo." });
    let i = 0;
    const tick = () => {
      i++; setPhase(i);
      if (i < phases.length) setTimeout(tick, 1200);
      else { setRunning(false); toast.success("PR opened: forge/auto-improvements"); }
    };
    setTimeout(tick, 1200);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 p-6 glass">
      <div className="absolute inset-0 rune-grid opacity-40 pointer-events-none" />
      <div className="absolute -top-20 -right-20 size-64 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-primary mb-2">Hermes Forge · Ritual</div>
          <h2 className="font-display text-3xl text-foreground">Start Self-Improvement Loop</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg">
            The agent will audit the repo, critique quality, generate refinements,
            then open a clean branch and pull request — autonomously.
          </p>
        </div>
        {running ? (
          <Button size="lg" variant="outline" onClick={() => setRunning(false)} className="gap-2">
            <Square className="size-4" /> Halt loop
          </Button>
        ) : (
          <Button size="lg" onClick={start} className="gap-2 ember-gradient text-primary-foreground border-0 shadow-[var(--shadow-ember)] hover:opacity-95">
            <Flame className="size-4" /> Ignite loop
          </Button>
        )}
      </div>
      {running && (
        <div className="relative mt-6 grid gap-2">
          {phases.map((p, i) => (
            <div key={p} className={`flex items-center gap-3 text-sm ${i < phase ? "text-foreground" : i === phase ? "text-primary" : "text-muted-foreground/60"}`}>
              {i === phase ? <Loader2 className="size-3.5 animate-spin" /> :
               i < phase ? <div className="size-1.5 rounded-full bg-primary" /> :
               <div className="size-1.5 rounded-full bg-muted-foreground/30" />}
              <span className="font-mono text-xs uppercase tracking-wider">{p}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
