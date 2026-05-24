import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Github } from "lucide-react";
import { checkInstallationHealth } from "@/lib/github-app.functions";

type Tone = "green" | "yellow" | "red" | "gray";

function dotClass(tone: Tone) {
  switch (tone) {
    case "green":
      return "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]";
    case "yellow":
      return "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.6)]";
    case "red":
      return "bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.6)]";
    default:
      return "bg-muted-foreground/60";
  }
}

export function ConnectionStatusPill() {
  const check = useServerFn(checkInstallationHealth);
  const q = useQuery({
    queryKey: ["github", "health"],
    queryFn: () => check(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  let tone: Tone = "gray";
  let label = "Checking…";
  const d = q.data;
  if (q.isError) {
    tone = "red";
    label = "Offline";
  } else if (d) {
    if (d.ok) {
      tone = "green";
      label = d.account_login ? `Live · ${d.account_login}` : "Live";
    } else if (!d.steps.record.ok) {
      tone = "red";
      label = "Not connected";
    } else if (!d.steps.token.ok) {
      tone = "red";
      label = "Auth error";
    } else if (!d.steps.repos.ok) {
      tone = "yellow";
      label = "Limited";
    } else {
      tone = "yellow";
      label = "Degraded";
    }
  }

  const tooltip = d
    ? [d.steps.record.message, d.steps.token.message, d.steps.repos.message].join(" · ")
    : q.isError
      ? q.error instanceof Error
        ? q.error.message
        : "Health probe failed"
      : "Probing GitHub App…";

  return (
    <Link
      to="/dashboard/repos"
      title={tooltip}
      className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border/60 text-sm hover:bg-secondary/50 transition-colors"
    >
      <span className={`size-2 rounded-full ${dotClass(tone)}`} />
      <Github className="size-4" />
      <span className="truncate max-w-[160px]">{label}</span>
    </Link>
  );
}