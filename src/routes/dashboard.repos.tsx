import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RepoCard } from "@/components/forge/RepoCard";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, ExternalLink, Github, Plus, RefreshCw, Check } from "lucide-react";
import { startGithubOAuth } from "@/lib/github-oauth.functions";
import { getGithubConnection, listInstallationRepos, addRepoToForge } from "@/lib/github-app.functions";
import { listConnectedRepos } from "@/lib/dashboard.functions";

const PUBLISHED_HOST = "hermes-forge-git-ai.lovable.app";

const ERROR_MESSAGES: Record<string, string> = {
  missing_installation: "GitHub didn't send an installation ID back. Try installing again.",
  bad_installation: "GitHub returned an invalid installation ID.",
  missing_state: "The install request was missing its signed state. Start the install from the dashboard, not directly from GitHub.",
  bad_state: "The install request expired or was tampered with. Start it again — it must complete within 30 minutes.",
  install_pending: "Your org admin needs to approve the GitHub App install before Hermes can connect.",
  store: "We received the installation but couldn't save it. Check the server logs.",
  missing_app_slug: "The GitHub App slug isn't configured. Add the GITHUB_APP_SLUG secret.",
};

export const Route = createFileRoute("/dashboard/repos")({
  validateSearch: (search: Record<string, unknown>) => ({
    installed: search.installed === "1" ? ("1" as const) : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: ReposPage,
});

function ReposPage() {
  const startOAuth = useServerFn(startGithubOAuth);
  const fetchInstallationRepos = useServerFn(listInstallationRepos);
  const fetchConnection = useServerFn(getGithubConnection);
  const fetchConnected = useServerFn(listConnectedRepos);
  const addRepo = useServerFn(addRepoToForge);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { installed, error } = Route.useSearch();
  const [loading, setLoading] = useState(false);
  const [isPreviewHost, setIsPreviewHost] = useState(false);

  const connectionQuery = useQuery({
    queryKey: ["github", "connection"],
    queryFn: () => fetchConnection(),
    staleTime: 30_000,
  });
  const reposQuery = useQuery({
    queryKey: ["github", "installation-repos"],
    queryFn: () => fetchInstallationRepos(),
    enabled: !!connectionQuery.data?.installation,
    staleTime: 60_000,
  });
  const connectedQuery = useQuery({
    queryKey: ["forge", "connected-repos"],
    queryFn: () => fetchConnected(),
    staleTime: 10_000,
  });

  const addMutation = useMutation({
    mutationFn: (vars: { github_id: number; full_name: string; name: string; owner: string; private: boolean; default_branch: string }) =>
      addRepo({ data: vars }),
    onSuccess: (res) => {
      if (res.added) toast.success("Repo added to The Forge");
      else toast.info("Already in The Forge");
      queryClient.invalidateQueries({ queryKey: ["forge", "connected-repos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add repo"),
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsPreviewHost(!window.location.hostname.endsWith(PUBLISHED_HOST));
    }
  }, []);

  useEffect(() => {
    if (installed === "1") {
      toast.success("GitHub App installed — Hermes can now reach your repositories.");
      queryClient.invalidateQueries({ queryKey: ["github"] });
    }
    if (installed || error) {
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

  const installation = connectionQuery.data?.installation ?? null;
  const isConnected = !!installation;
  const showInstallCard = !connectionQuery.isLoading && !installation;
  const repos = reposQuery.data?.repos ?? [];
  const connectedIds = new Set((connectedQuery.data?.repos ?? []).map((r) => r.full_name));

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
      {installed === "1" ? (
        <Alert className="border-emerald-500/40 text-emerald-400">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Installed</AlertTitle>
          <AlertDescription>The GitHub App is installed. Pick a repository below to add it to The Forge.</AlertDescription>
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
              ? `${repos.length} repositories accessible · ${connectedIds.size} added to The Forge`
              : "Install the Hermes Forge GitHub App to start forging."}
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
            <Plus className="size-4" /> {loading ? "Redirecting…" : "Install GitHub App"}
          </Button>
        )}
      </div>
      {showInstallCard ? (
        <div className="rounded-xl border border-primary/30 glass p-6 flex items-center gap-4">
          <div className="size-12 rounded-lg ember-gradient grid place-items-center text-primary-foreground"><Github className="size-5" /></div>
          <div className="flex-1">
            <div className="font-display text-lg">Install the Hermes Forge GitHub App</div>
            <div className="text-sm text-muted-foreground">
              On the next screen, pick which repositories Hermes can read, refactor, and open PRs against. You can change this anytime in GitHub settings.
            </div>
          </div>
          <Button variant="outline" onClick={connect} disabled={loading}>
            {loading ? "Redirecting…" : "Install"}
          </Button>
        </div>
      ) : null}

      {isConnected && reposQuery.isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/60 glass p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : null}

      {isConnected && repos.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {repos.map((r) => {
            const alreadyAdded = connectedIds.has(r.full_name);
            return (
              <div key={r.id} className="space-y-2">
                <RepoCard
                  name={r.full_name}
                  stars={r.stargazers_count}
                  branch={r.default_branch}
                  isPrivate={r.private}
                  active={alreadyAdded}
                />
                <Button
                  size="sm"
                  variant={alreadyAdded ? "outline" : "default"}
                  className="w-full gap-2"
                  disabled={alreadyAdded || addMutation.isPending}
                  onClick={() =>
                    addMutation.mutate({
                      github_id: r.id,
                      full_name: r.full_name,
                      name: r.name,
                      owner: r.owner,
                      private: r.private,
                      default_branch: r.default_branch,
                    })
                  }
                >
                  {alreadyAdded ? (<><Check className="size-3" /> In The Forge</>) : (<><Plus className="size-3" /> Add to Hermes</>)}
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      {isConnected && !reposQuery.isLoading && repos.length === 0 ? (
        <div className="rounded-xl border border-border/60 glass p-8 text-center text-sm text-muted-foreground">
          The GitHub App has no repositories yet. Open the app settings on GitHub and grant it access to at least one repo.
        </div>
      ) : null}
    </div>
  );
}
