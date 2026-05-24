import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RepoCard, RepoRow } from "@/components/forge/RepoCard";
import {
  RepoCommandBar,
  type RepoFilter,
  type RepoSort,
  type RepoView,
} from "@/components/forge/RepoCommandBar";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Github,
  Plus,
  RefreshCw,
  Link2,
  LayoutGrid,
  List,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { startGithubOAuth } from "@/lib/github-oauth.functions";
import {
  getGithubConnection,
  listInstallationRepos,
  addRepoToForge,
  recordInstallation,
  listAppInstallations,
  claimInstallation,
} from "@/lib/github-app.functions";
import { listConnectedRepos } from "@/lib/dashboard.functions";
import { InstallationHealthCard } from "@/components/forge/InstallationHealth";

const PUBLISHED_HOST = "hermes-forge-git-ai.lovable.app";
const PENDING_INSTALL_KEY = "hermes:pending_install_id";

const ERROR_MESSAGES: Record<string, string> = {
  missing_installation: "GitHub didn't send an installation ID back. Try installing again.",
  bad_installation: "GitHub returned an invalid installation ID.",
  missing_state: "The install request was missing its signed state. Start the install from the dashboard, not directly from GitHub.",
  bad_state: "The install request expired or was tampered with. Start it again — it must complete within 30 minutes.",
  install_pending: "Your org admin needs to approve the GitHub App install before Hermes can connect.",
  store: "We received the installation but couldn't save it. Check the server logs.",
  missing_app_slug: "The GitHub App slug isn't configured. Add the GITHUB_APP_SLUG secret.",
  missing_callback_params: "GitHub redirected back with no useful parameters. Try installing again from the dashboard.",
  record_failed: "We couldn't save your GitHub App installation. Try installing again.",
};

export const Route = createFileRoute("/dashboard/repos")({
  validateSearch: (search: Record<string, unknown>) => ({
    installed: search.installed === "1" ? ("1" as const) : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    pending_install:
      typeof search.pending_install === "string" || typeof search.pending_install === "number"
        ? Number(search.pending_install)
        : undefined,
  }),
  component: ReposPage,
});

function ReposPage() {
  const startOAuth = useServerFn(startGithubOAuth);
  const fetchInstallationRepos = useServerFn(listInstallationRepos);
  const fetchConnection = useServerFn(getGithubConnection);
  const fetchConnected = useServerFn(listConnectedRepos);
  const addRepo = useServerFn(addRepoToForge);
  const recordInstall = useServerFn(recordInstallation);
  const listInstallations = useServerFn(listAppInstallations);
  const claimInstall = useServerFn(claimInstallation);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { installed, error, pending_install } = Route.useSearch();
  const [loading, setLoading] = useState(false);
  const [isPreviewHost, setIsPreviewHost] = useState(false);
  const [stashedPending, setStashedPending] = useState<number | null>(null);
  const [showReconcile, setShowReconcile] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RepoFilter>("all");
  const [sort, setSort] = useState<RepoSort>("updated");
  const [view, setView] = useState<RepoView>("grid");
  const [pendingRepoId, setPendingRepoId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
    onMutate: (vars) => setPendingRepoId(vars.github_id),
    onSettled: () => setPendingRepoId(null),
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

  // Global ⌘K / Ctrl+K → focus the repo search input. Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  // Finish the App install flow. The id can arrive two ways:
  // 1. ?pending_install=<id> on this exact navigation
  // 2. Stashed in sessionStorage from a prior tab that lost auth
  // Stash first so a reload or auth bounce doesn't drop it, then attempt
  // to record it under the authenticated user.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let id: number | null = null;
    if (pending_install && Number.isFinite(pending_install)) {
      id = pending_install;
      try {
        sessionStorage.setItem(PENDING_INSTALL_KEY, String(pending_install));
      } catch {
        /* ignore */
      }
    } else {
      const raw = sessionStorage.getItem(PENDING_INSTALL_KEY);
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) id = parsed;
    }
    if (!id) return;
    setStashedPending(id);
    let cancelled = false;
    (async () => {
      try {
        await recordInstall({ data: { installation_id: id! } });
        if (cancelled) return;
        try {
          sessionStorage.removeItem(PENDING_INSTALL_KEY);
        } catch {
          /* ignore */
        }
        setStashedPending(null);
        toast.success("GitHub App installed — Hermes can now reach your repositories.");
        queryClient.invalidateQueries({ queryKey: ["github"] });
        if (pending_install) {
          navigate({ to: "/dashboard/repos", search: {}, replace: true });
        }
      } catch (e) {
        console.error(e);
        if (cancelled) return;
        // Keep the stash so the recovery card stays visible and the user
        // can retry without re-running the GitHub flow.
        toast.error(e instanceof Error ? e.message : "Failed to record installation");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending_install]);

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

  const reconcileQuery = useQuery({
    queryKey: ["github", "reconcile"],
    queryFn: () => listInstallations(),
    enabled: showReconcile,
    staleTime: 0,
  });

  const retryRecord = useMutation({
    mutationFn: (id: number) => recordInstall({ data: { installation_id: id } }),
    onSuccess: () => {
      try {
        sessionStorage.removeItem(PENDING_INSTALL_KEY);
      } catch {
        /* ignore */
      }
      setStashedPending(null);
      toast.success("Installation linked.");
      queryClient.invalidateQueries({ queryKey: ["github"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Retry failed"),
  });

  const claimMut = useMutation({
    mutationFn: (id: number) => claimInstall({ data: { installation_id: id } }),
    onSuccess: () => {
      toast.success("Installation linked to your account.");
      setShowReconcile(false);
      try {
        sessionStorage.removeItem(PENDING_INSTALL_KEY);
      } catch {
        /* ignore */
      }
      setStashedPending(null);
      queryClient.invalidateQueries({ queryKey: ["github"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not claim installation"),
  });

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

      {/* Recovery card: we have a pending install ID but no installation row yet. */}
      {stashedPending && !installation ? (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Finish GitHub App install</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              GitHub sent us installation <code>#{stashedPending}</code>, but we couldn't link it to your account yet.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => retryRecord.mutate(stashedPending)}
                disabled={retryRecord.isPending}
                className="gap-2"
              >
                <RefreshCw className={`size-3.5 ${retryRecord.isPending ? "animate-spin" : ""}`} />
                {retryRecord.isPending ? "Linking…" : "Retry link"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(PENDING_INSTALL_KEY);
                  } catch {
                    /* ignore */
                  }
                  setStashedPending(null);
                }}
              >
                Dismiss
              </Button>
            </div>
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
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowReconcile((v) => !v)}
              className="gap-2"
            >
              <Link2 className="size-4" /> Re-sync from GitHub
            </Button>
            <Button onClick={connect} disabled={loading} className="ember-gradient text-primary-foreground border-0 gap-2">
              <Plus className="size-4" /> {loading ? "Redirecting…" : "Install GitHub App"}
            </Button>
          </div>
        )}
      </div>

      {/* Reconcile panel: lists every installation the App can see and lets the
          user claim one. Useful when the redirect handoff failed. */}
      {showReconcile ? (
        <div className="rounded-xl border border-border/60 glass p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-lg">App installations</div>
              <div className="text-sm text-muted-foreground">
                If you already installed the Hermes Forge GitHub App, pick the
                account/org it was installed on to link it to your Hermes account.
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => reconcileQuery.refetch()}
              disabled={reconcileQuery.isFetching}
              className="gap-2"
            >
              <RefreshCw className={`size-3.5 ${reconcileQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          {reconcileQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading installations…</div>
          ) : reconcileQuery.data?.error ? (
            <div className="text-sm text-destructive">
              Couldn't list installations: {reconcileQuery.data.error}
            </div>
          ) : (reconcileQuery.data?.installations.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">
              No installations found. Install the GitHub App first, then come
              back here.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {reconcileQuery.data!.installations.map((i) => {
                const claimedByOther =
                  reconcileQuery.data!.already_claimed_ids.includes(i.installation_id);
                const me = reconcileQuery.data!.github_username;
                const suggested = !!me && me.toLowerCase() === i.account_login.toLowerCase();
                return (
                  <li key={i.installation_id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {i.account_login}
                        <span className="text-xs text-muted-foreground">({i.account_type})</span>
                        {suggested ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                            matches your GitHub
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        installation #{i.installation_id} · {i.repository_selection} access
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={suggested ? "default" : "outline"}
                      disabled={claimMut.isPending || claimedByOther}
                      onClick={() => claimMut.mutate(i.installation_id)}
                    >
                      {claimedByOther ? "Linked elsewhere" : "Link to my account"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {showInstallCard ? (
        <div className="rounded-xl border border-primary/30 glass p-6 flex items-center gap-4">
          <div className="size-12 rounded-lg ember-gradient grid place-items-center text-primary-foreground"><Github className="size-5" /></div>
          <div className="flex-1">
            <div className="font-display text-lg">Install the Hermes Forge GitHub App</div>
            <div className="text-sm text-muted-foreground">
              On the next screen, pick which repositories Hermes can read, refactor, and open PRs against. Already installed? Click <span className="text-foreground">Re-sync from GitHub</span> above to link it.
            </div>
          </div>
          <Button variant="outline" onClick={connect} disabled={loading}>
            {loading ? "Redirecting…" : "Install"}
          </Button>
        </div>
      ) : null}

      {/* Always show health probe so users get diagnostics whether or not
          an installation is linked. */}
      <InstallationHealthCard />

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

      {isConnected && reposQuery.data?.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Couldn't load repositories</div>
          <div className="text-muted-foreground mt-1 break-words">{reposQuery.data.error}</div>
        </div>
      ) : null}

      {isConnected && !reposQuery.isLoading && repos.length === 0 && !reposQuery.data?.error ? (
        <div className="rounded-xl border border-border/60 glass p-8 text-center text-sm text-muted-foreground">
          The GitHub App has no repositories yet. Open the app settings on GitHub and grant it access to at least one repo.
        </div>
      ) : null}
    </div>
  );
}
