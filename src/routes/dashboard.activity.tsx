import { createFileRoute } from "@tanstack/react-router";
import { ActivityLog } from "@/components/forge/ActivityLog";

export const Route = createFileRoute("/dashboard/activity")({ component: ActivityPage });

function ActivityPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl">Activity</h1>
        <p className="text-sm text-muted-foreground mt-1">A live ledger of every move the agent makes.</p>
      </div>
      <ActivityLog />
    </div>
  );
}
