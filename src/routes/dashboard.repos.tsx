import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RepoCard } from "@/components/forge/RepoCard";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, ExternalLink, Github, Plus, RefreshCw } from "lucide-react";
import { startGithubOAuth, listGithubRepos } from "@/lib/github-oauth.functions";

const PUBLISHED_HOST = "hermes-forge-git-ai.lovable.app";

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "GitHub didn't return an authorization code. Try again, or check that the GitHub OAuth App is active.",
  bad_state: "The sign-in request expired or was tampered with. Start the flow again — it must complete within 10 minutes.",
  token_exchange: "GitHub rejected the token exchange. The OAuth App's client secret may be wrong, or the callback URL doesn't match exactly.",
  store: "We got your GitHub token but couldn't save it. Check the server logs for the database error.",
  missing_app_slug: "Your GitHub credentials are for a GitHub App, but the app's public slug isn't configured yet. Add the GITHUB_APP_SLUG secret (the URL slug from https://github.com/apps/<slug>) and try again.",
};

export const Route = createFileRoute("/dashboard/repos")({
  validateSearch: (search: Record<string, unknown>) => ({
    connected: search.connected === "1" ? "1" as const : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: ReposPage,
});

function ReposPage() {
  const startOAuth = useServerFn(startGithubOAuth);
  const fetchRepos = useServerFn(listGithubRepos);
  const navigate = useNavigate();
  const { connected, error } = Route.useSearch();
  const [loading, setLoading] = useState(false);
  const [isPreviewHost, setIsPreviewHost] = useState(false);

  const reposQuery = useQuery({
    queryKey: ["github", "repos"],
    queryFn: () => fetchRepos(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsPreviewHost(!window.location.hostname.endsWith(PUBLISHED_HOST));
    }
  }, []);

  useEffect(() => {
    if (connected === "1") {
      toast.success("GitHub connected — Hermes can now reach your repositories.");
    }
    if (connected || error) {
      navigate({ to: "/dashboard/repos", search: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    try {
      setLoading(true);
      const { url } = await startOAuth();
      window.location.assign(url);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      const code = msg.includes("missing_app_slug") ? "missing_app_slug" : undefined;
      if (code) {
        navigate({ to: "/dashboard/repos", search: { error: code }, replace: true });
      } else {
        toast.error("Could not start GitHub connection");
      }
      setLoading(false);
    }
  };

  const data = reposQuery.data;
  const isConnected = !!data && !data.notConnected && !data.tokenInvalid;
  const showInstallCard = !data || data.notConnected || data.tokenInvalid;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>GitHub connection failed</AlertTitle>
          <AlertDescription>
            {ERROR_MESSAGES[error] ?? "Something went wrong during the GitHub handshake."}
            <div className="text-xs opacity-70 mt-1">Error code: <code>{error}</code></div>
          </AlertDescription>
        </Alert>
      ) : null}
      {connected === "1" ? (
        <Alert className="border-emerald-500/40 text-emerald-400">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Connected</AlertTitle>
          <AlertDescription>Your GitHub account is linked. Pick a repository below to start forging.</AlertDescription>
        </Alert>
      ) : null}
      {isPreviewHost && showInstallCard ? (
        <Alert>
          <ExternalLink className="size-4" />
          <AlertTitle>Heads up — GitHub returns to the published site</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>GitHub only knows one callback URL, so the OAuth round-trip completes on your published domain, not the preview.</p>
            <a
              href={`https://${PUBLISHED_HOST}/dashboard/repos`}
              className="inline-flex items-center gap-1 underline text-primary"
            >
              Open published dashboard <ExternalLink className="size-3" />
            </a>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Repositories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isConnected
              ? `Showing ${data?.repos.length ?? 0} repositories from your GitHub account.`
              : "Connect any GitHub repo for the agent to forge."}
          </p>
        </div>
        {isConnected ? (
          <Button
            variant="outline"
            onClick={() => reposQuery.refetch()}
            disabled={reposQuery.isFetching}
            className="gap-2"
          >
            <RefreshCw className={`size-4 ${reposQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        ) : (
          <Button onClick={connect} disabled={loading} className="ember-gradient text-primary-foreground border-0 gap-2">
            <Plus className="size-4" /> {loading ? "Redirecting…" : "Connect repo"}
          </Button>
        )}
      </div>
      {showInstallCard ? (
        <div className="rounded-xl border border-primary/30 glass p-6 flex items-center gap-4">
          <div className="size-12 rounded-lg ember-gradient grid place-items-center text-primary-foreground"><Github className="size-5" /></div>
          <div className="flex-1">
            <div className="font-display text-lg">
              {data?.tokenInvalid ? "Reconnect GitHub" : "Connect your GitHub account"}
            </div>
            <div className="text-sm text-muted-foreground">
              {data?.tokenInvalid
                ? "Your previous GitHub token was revoked or expired. Reconnect to keep forging."
                : "Grant the agent the access it needs to read your repositories and open pull requests."}
            </div>
          </div>
          <Button variant="outline" onClick={connect} disabled={loading}>
            {loading ? "Redirecting…" : data?.tokenInvalid ? "Reconnect" : "Connect"}
          </Button>
        </div>
      ) : null}

      {reposQuery.isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/60 glass p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : null}

      {isConnected && data && data.repos.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.repos.map((r) => (
            <RepoCard
              key={r.id}
              name={r.full_name}
              stars={r.stargazers_count}
              branch={r.default_branch}
              isPrivate={r.private}
            />
          ))}
        </div>
      ) : null}

      {isConnected && data && data.repos.length === 0 ? (
        <div className="rounded-xl border border-border/60 glass p-8 text-center text-sm text-muted-foreground">
          No repositories found on your GitHub account yet.
        </div>
      ) : null}
    </div>
  );
}
