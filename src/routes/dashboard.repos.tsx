import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RepoCard } from "@/components/forge/RepoCard";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, ExternalLink, Github, Plus } from "lucide-react";
import { startGithubOAuth } from "@/lib/github-oauth.functions";

const PUBLISHED_HOST = "hermes-forge-git-ai.lovable.app";

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "GitHub didn't return an authorization code. Try again, or check that the GitHub OAuth App is active.",
  bad_state: "The sign-in request expired or was tampered with. Start the flow again — it must complete within 10 minutes.",
  token_exchange: "GitHub rejected the token exchange. The OAuth App's client secret may be wrong, or the callback URL doesn't match exactly.",
  store: "We got your GitHub token but couldn't save it. Check the server logs for the database error.",
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
  const navigate = useNavigate();
  const { connected, error } = Route.useSearch();
  const [loading, setLoading] = useState(false);
  const [isPreviewHost, setIsPreviewHost] = useState(false);

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
      toast.error("Could not start GitHub connection");
      setLoading(false);
    }
  };
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
      {isPreviewHost ? (
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
          <p className="text-sm text-muted-foreground mt-1">Connect any GitHub repo for the agent to forge.</p>
        </div>
        <Button onClick={connect} disabled={loading} className="ember-gradient text-primary-foreground border-0 gap-2"><Plus className="size-4" /> {loading ? "Redirecting…" : "Connect repo"}</Button>
      </div>
      <div className="rounded-xl border border-primary/30 glass p-6 flex items-center gap-4">
        <div className="size-12 rounded-lg ember-gradient grid place-items-center text-primary-foreground"><Github className="size-5" /></div>
        <div className="flex-1">
          <div className="font-display text-lg">Install the Hermes GitHub App</div>
          <div className="text-sm text-muted-foreground">Grant the agent the access it needs to open branches and pull requests autonomously.</div>
        </div>
        <Button variant="outline" onClick={connect} disabled={loading}>{loading ? "Redirecting…" : "Connect"}</Button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <RepoCard key={i}
            name={["skakig/hermes-webui","skakig/cae-content","skakig/desert-queen","skakig/oracle-api","skakig/runeforge-cli","skakig/sandstorm-core","skakig/glyph-parser","skakig/ember-router","skakig/obelisk-ui"][i]}
            stars={[128,42,319,87,54,201,33,18,77][i]}
            prs={[4,2,6,1,0,3,2,0,1][i]}
            branch={["forge/refactor","main","forge/docs","main","main","forge/types","main","forge/cleanup","main"][i]}
            active={i===0}
          />
        ))}
      </div>
    </div>
  );
}
