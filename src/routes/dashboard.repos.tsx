import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { RepoCard } from "@/components/forge/RepoCard";
import { Button } from "@/components/ui/button";
import { Github, Plus } from "lucide-react";
import { startGithubOAuth } from "@/lib/github-oauth.functions";

export const Route = createFileRoute("/dashboard/repos")({ component: ReposPage });

function ReposPage() {
  const startOAuth = useServerFn(startGithubOAuth);
  const [loading, setLoading] = useState(false);
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
