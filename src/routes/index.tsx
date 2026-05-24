import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight, Flame, GitBranch, Github, Sparkles, Workflow, ShieldCheck,
  Bot, GitPullRequest, Activity, Eye, Zap,
} from "lucide-react";
import heroImg from "@/assets/hero-desert.jpg";
import { Button } from "@/components/ui/button";
import { MarketingShell } from "@/components/marketing/MarketingShell";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Hermes Forge — Autonomous AI Agent for GitHub" },
      { name: "description", content: "Hermes Forge is the autonomous AI agent that audits, critiques and improves your GitHub repositories — opening clean pull requests while you sleep." },
      { property: "og:title", content: "Hermes Forge — Autonomous AI Agent for GitHub" },
      { property: "og:description", content: "Self-improvement loops for any repo. Audit. Refine. Pull-request. Repeat." },
    ],
  }),
});

function Landing() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <img src={heroImg} alt="" width={1920} height={1080}
          className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/75 to-background" />
        <div className="absolute inset-0 rune-grid opacity-30" />
        <div className="relative z-10 container mx-auto px-6 pt-24 pb-32 text-center max-w-4xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/40 bg-primary/10 text-xs uppercase tracking-[0.25em] text-primary mb-8">
            <Sparkles className="size-3" /> Autonomous · Background · Relentless
          </div>
          <h1 className="font-display text-5xl md:text-7xl leading-[1.05] text-foreground text-glow">
            The agent that <span className="text-primary">forges</span> your codebase
            <br /> while you sleep.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Hermes Forge audits any GitHub repository, critiques quality and content,
            generates improvements, and ships them as clean pull requests — autonomously.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/dashboard/repos">
              <Button size="lg" className="ember-gradient text-primary-foreground border-0 shadow-[var(--shadow-ember)] gap-2">
                <Flame className="size-4" /> Ignite the Forge <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link to="/dashboard/repos">
              <Button size="lg" variant="outline" className="gap-2">
                <Github className="size-4" /> Connect a repository
              </Button>
            </Link>
          </div>
          <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-mono text-muted-foreground">
            <span className="opacity-70">TRUSTED RUNES</span>
            {["skakig/hermes-webui","skakig/cae-content","skakig/desert-queen","skakig/oracle-api","skakig/runeforge-cli"].map(r => (
              <span key={r} className="px-2 py-1 rounded border border-border/40">{r}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Loop visualizer */}
      <section className="container mx-auto px-6 py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="text-xs uppercase tracking-[0.3em] text-primary mb-3">The Loop</div>
          <h2 className="font-display text-3xl md:text-4xl">One ritual. Four phases. Endlessly.</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: Eye, label: "Audit", desc: "Walk every file. Map debt." },
            { icon: Bot, label: "Critique", desc: "Score quality, content, fit." },
            { icon: Workflow, label: "Forge", desc: "Generate improvements." },
            { icon: GitPullRequest, label: "Ship", desc: "Open a clean PR." },
          ].map((p, i) => (
            <div key={p.label} className="relative rounded-2xl border border-border/60 glass p-5 drift" style={{ animationDelay: `${i * 0.4}s` }}>
              <div className="absolute -top-3 -right-3 text-[10px] font-mono text-primary/70">0{i+1}</div>
              <div className="size-10 rounded-lg ember-gradient grid place-items-center text-primary-foreground mb-3">
                <p.icon className="size-4" />
              </div>
              <div className="font-display text-lg">{p.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{p.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features teaser */}
      <section className="container mx-auto px-6 py-20 grid md:grid-cols-3 gap-6">
        {[
          { icon: Workflow, title: "Self-improvement loops", desc: "Continuous audit → critique → refine → PR. Always-on background mode." },
          { icon: GitBranch, title: "Clean pull requests", desc: "Every change lands in a fresh branch with reasoned commit messages." },
          { icon: ShieldCheck, title: "Goal-aligned agent", desc: "Steer with goals like 'Improve docs', 'Refactor X', 'Make CAE content better'." },
        ].map(f => (
          <div key={f.title} className="rounded-2xl border border-border/60 glass p-6">
            <div className="size-11 rounded-lg ember-gradient grid place-items-center text-primary-foreground mb-4 shadow-[var(--shadow-ember)]">
              <f.icon className="size-5" />
            </div>
            <h3 className="font-display text-xl mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.desc}</p>
          </div>
        ))}
        <div className="md:col-span-3 text-center">
          <Link to="/features" className="text-sm text-primary inline-flex items-center gap-1 hover:gap-2 transition-all">
            See all capabilities <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="container mx-auto px-6 py-24">
        <div className="relative rounded-3xl border border-primary/30 overflow-hidden p-12 text-center">
          <div className="absolute inset-0 rune-grid opacity-30" />
          <div className="absolute inset-0" style={{ background: "var(--gradient-rune)" }} />
          <div className="relative z-10 max-w-2xl mx-auto">
            <Zap className="size-8 text-primary mx-auto mb-4" />
            <h2 className="font-display text-3xl md:text-5xl text-glow">Stop reviewing. Start forging.</h2>
            <p className="mt-4 text-muted-foreground">Connect a repository. The agent does the rest.</p>
            <Link to="/dashboard/repos" className="inline-block mt-8">
              <Button size="lg" className="ember-gradient text-primary-foreground border-0 shadow-[var(--shadow-ember)] gap-2">
                <Flame className="size-4" /> Ignite the Forge <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
