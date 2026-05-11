import { createFileRoute } from "@tanstack/react-router";
import { GoalsPanel } from "@/components/forge/GoalsPanel";

export const Route = createFileRoute("/dashboard/goals")({ component: GoalsPage });

function GoalsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl">Goals</h1>
        <p className="text-sm text-muted-foreground mt-1">Steer the agent's intent. Goals influence every loop.</p>
      </div>
      <GoalsPanel />
    </div>
  );
}
