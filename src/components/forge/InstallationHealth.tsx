import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { Activity, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkInstallationHealth, type InstallationHealth as Health } from "@/lib/github-app.functions";

function StepRow({ ok, message, label, pending }: { ok: boolean; message: string; label: string; pending?: boolean }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className="mt-0.5">
        {pending ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : ok ? (
          <CheckCircle2 className="size-4 text-emerald-400" />
        ) : (
          <XCircle className="size-4 text-destructive" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground break-words">{message}</div>
      </div>
    </li>
  );
}

export function InstallationHealthCard({ autoRun = true }: { autoRun?: boolean }) {
  const check = useServerFn(checkInstallationHealth);
  const mut = useMutation<Health>({ mutationFn: () => check() });

  useEffect(() => {
    if (autoRun) mut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = mut.data;
  const headerOk = data?.ok ?? false;
  const running = mut.isPending;

  return (
    <div className="rounded-xl border border-border/60 glass p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className={`size-8 rounded-lg grid place-items-center ${
              running
                ? "bg-muted text-muted-foreground"
                : !data
                  ? "bg-muted text-muted-foreground"
                  : headerOk
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-destructive/15 text-destructive"
            }`}
          >
            <Activity className="size-4" />
          </div>
          <div>
            <div className="font-display text-sm">Installation health</div>
            <div className="text-xs text-muted-foreground">
              {running
                ? "Probing GitHub…"
                : data
                  ? headerOk
                    ? "All checks passing."
                    : "One or more checks failed."
                  : "Not yet checked."}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={running}
          onClick={() => mut.mutate()}
        >
          <RefreshCw className={`size-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Checking" : "Re-check"}
        </Button>
      </div>
      {mut.isError ? (
        <div className="text-sm text-destructive">
          Health probe failed: {mut.error instanceof Error ? mut.error.message : String(mut.error)}
        </div>
      ) : null}
      {data ? (
        <ul className="space-y-2 pt-1">
          <StepRow label="Installation linked" ok={data.steps.record.ok} message={data.steps.record.message} />
          <StepRow label="Mint access token" ok={data.steps.token.ok} message={data.steps.token.message} />
          <StepRow label="Read repositories" ok={data.steps.repos.ok} message={data.steps.repos.message} />
        </ul>
      ) : running ? (
        <ul className="space-y-2 pt-1">
          <StepRow pending label="Installation linked" ok={false} message="Checking database…" />
          <StepRow pending label="Mint access token" ok={false} message="Signing App JWT…" />
          <StepRow pending label="Read repositories" ok={false} message="Calling GitHub API…" />
        </ul>
      ) : null}
      {data?.checkedAt ? (
        <div className="text-[11px] text-muted-foreground pt-1">
          Last checked {new Date(data.checkedAt).toLocaleTimeString()}
        </div>
      ) : null}
    </div>
  );
}