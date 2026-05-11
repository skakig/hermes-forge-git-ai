import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard/settings")({ component: SettingsPage });

function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure background mode, billing and the agent's reach.</p>
      </div>
      <div className="rounded-xl border border-border/60 glass p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-lg">Background mode</div>
            <div className="text-sm text-muted-foreground">Keep loops running while you're offline.</div>
          </div>
          <div className="px-3 py-1 rounded-full text-xs bg-primary/15 text-primary border border-primary/30">Enabled</div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-lg">Hermes API</div>
            <div className="text-sm text-muted-foreground">Connect to skakig/hermes-webui backend.</div>
          </div>
          <Button variant="outline" size="sm">Configure</Button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-lg">Billing</div>
            <div className="text-sm text-muted-foreground">Plan: Forgemaster · unlimited loops</div>
          </div>
          <Button variant="outline" size="sm">Manage</Button>
        </div>
      </div>
    </div>
  );
}
