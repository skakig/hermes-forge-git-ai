import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ExternalLink, Sparkles } from "lucide-react";
import { InstallationHealthCard } from "@/components/forge/InstallationHealth";

export const Route = createFileRoute("/dashboard/settings")({ component: SettingsPage });

function HermesCard() {
  return (
    <div className="rounded-xl border border-border/60 glass p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="size-8 rounded-lg grid place-items-center bg-emerald-500/15 text-emerald-400">
          <Activity className="size-4" />
        </div>
        <div>
          <div className="font-display text-sm">Hermes engine</div>
          <div className="text-xs text-muted-foreground">
            Running in-app — no external service required.
          </div>
        </div>
      </div>
      <ul className="text-xs space-y-1.5 pl-1">
        <li className="flex items-center gap-2 text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          <span>Reasoning model</span>
          <span className="font-mono text-foreground">google/gemini-2.5-pro</span>
          <span className="text-muted-foreground">via Lovable AI Gateway</span>
        </li>
        <li className="flex items-center gap-2 text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          <span>Code I/O</span>
          <span className="font-mono text-foreground">GitHub REST + GraphQL</span>
          <span className="text-muted-foreground">via installed GitHub App</span>
        </li>
      </ul>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Operational health for the GitHub App, the Hermes runtime, and background scheduling.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <div className="font-display text-lg mb-2">GitHub App</div>
          <InstallationHealthCard />
          <div className="text-xs text-muted-foreground mt-2">
            Manage repositories from the{" "}
            <Link to="/dashboard/repos" className="text-primary underline">
              Repositories page
            </Link>
            .
          </div>
        </div>

        <div>
          <div className="font-display text-lg mb-2">Hermes API</div>
          <HermesCard />
        </div>

        <div className="rounded-xl border border-border/60 glass p-5 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg">Background mode</div>
              <div className="text-sm text-muted-foreground">
                Scheduled loops run automatically on a cadence you configure per goal.
              </div>
            </div>
            <div className="px-3 py-1 rounded-full text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30">
              Coming in Phase 3
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Today loops are launched manually from the dashboard. Phase 3 will add a scheduler so the agent ticks on its own.
          </p>
        </div>

        <div className="rounded-xl border border-border/60 glass p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg">GitHub App settings</div>
              <div className="text-sm text-muted-foreground">
                Change which repositories Hermes can read, refactor, and open PRs against.
              </div>
            </div>
            <a
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm h-9 px-3 rounded-md border border-border/60 hover:bg-secondary/50"
            >
              Open on GitHub <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
