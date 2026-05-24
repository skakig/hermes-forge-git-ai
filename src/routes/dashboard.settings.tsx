import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { Activity, CheckCircle2, ExternalLink, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstallationHealthCard } from "@/components/forge/InstallationHealth";
import { checkHermesHealth, type HermesHealth } from "@/lib/github-app.functions";

export const Route = createFileRoute("/dashboard/settings")({ component: SettingsPage });

function HermesCard() {
  const check = useServerFn(checkHermesHealth);
  const mut = useMutation<HermesHealth>({ mutationFn: () => check() });
  useEffect(() => {
    mut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const data = mut.data;
  const running = mut.isPending;
  const ok = data?.ok ?? false;
  return (
    <div className="rounded-xl border border-border/60 glass p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className={`size-8 rounded-lg grid place-items-center ${
              running || !data
                ? "bg-muted text-muted-foreground"
                : ok
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-destructive/15 text-destructive"
            }`}
          >
            <Activity className="size-4" />
          </div>
          <div>
            <div className="font-display text-sm">Hermes runtime</div>
            <div className="text-xs text-muted-foreground">
              {running ? "Probing Hermes…" : data ? data.message : "Not yet checked."}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={running} onClick={() => mut.mutate()} className="gap-2">
          <RefreshCw className={`size-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Checking" : "Re-check"}
        </Button>
      </div>
      <ul className="text-xs space-y-1.5">
        <li className="flex items-center gap-2">
          {data?.hasUrl ? (
            <CheckCircle2 className="size-3.5 text-emerald-400" />
          ) : (
            <XCircle className="size-3.5 text-destructive" />
          )}
          <span className="text-muted-foreground">HERMES_API_URL</span>
          <span className="font-mono truncate">{data?.url ?? "—"}</span>
        </li>
        <li className="flex items-center gap-2">
          {data?.hasKey ? (
            <CheckCircle2 className="size-3.5 text-emerald-400" />
          ) : (
            <XCircle className="size-3.5 text-destructive" />
          )}
          <span className="text-muted-foreground">HERMES_API_KEY</span>
          <span className="font-mono">{data?.hasKey ? "configured" : "missing"}</span>
        </li>
        {data?.status != null ? (
          <li className="flex items-center gap-2">
            {data.ok ? (
              <CheckCircle2 className="size-3.5 text-emerald-400" />
            ) : (
              <XCircle className="size-3.5 text-destructive" />
            )}
            <span className="text-muted-foreground">/health</span>
            <span className="font-mono">HTTP {data.status}</span>
          </li>
        ) : running ? (
          <li className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Calling /health…
          </li>
        ) : null}
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
