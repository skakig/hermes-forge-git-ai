import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Flame, GitBranch, Github, Sparkles, Workflow, ShieldCheck } from "lucide-react";
import heroImg from "@/assets/hero-desert.jpg";
import { Button } from "@/components/ui/button";

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
    <div className="min-h-screen relative overflow-hidden">
      {/* Hero */}
      <div className="relative">
        <img src={heroImg} alt="" width={1920} height={1080}
          className="absolute inset-0 w-full h-[90vh] object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/70 to-background" />
        <div className="absolute inset-0 rune-grid opacity-30" />

        <header className="relative z-10 container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg ember-gradient grid place-items-center shadow-[var(--shadow-ember)]">
              <Flame className="size-4 text-primary-foreground" />
            </div>
            <div className="font-display text-xl">Hermes <span className="text-primary">Forge</span></div>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <Link to="/dashboard">
            <Button variant="outline" size="sm" className="gap-2"><Github className="size-4" /> Sign in</Button>
          </Link>
        </header>

        <section className="relative z-10 container mx-auto px-6 pt-20 pb-32 text-center max-w-4xl">
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
            <Link to="/dashboard">
              <Button size="lg" className="ember-gradient text-primary-foreground border-0 shadow-[var(--shadow-ember)] gap-2">
                <Flame className="size-4" /> Ignite the Forge <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="gap-2">
              <Github className="size-4" /> Connect a repository
            </Button>
          </div>
        </section>
      </div>

      {/* Features */}
      <section id="features" className="relative container mx-auto px-6 py-24 grid md:grid-cols-3 gap-6">
        {[
          { icon: Workflow, title: "Self-improvement loops", desc: "Continuous audit → critique → refine → PR. Always-on background mode." },
          { icon: GitBranch, title: "Clean pull requests", desc: "Every change lands in a fresh branch with reasoned commit messages." },
          { icon: ShieldCheck, title: "Goal-aligned agent", desc: "Steer with goals like 'Improve docs', 'Refactor X', 'Make CAE content better'." },
        ].map(f => (
          <div key={f.title} className="rounded-2xl border border-border/60 glass p-6 drift">
            <div className="size-11 rounded-lg ember-gradient grid place-items-center text-primary-foreground mb-4 shadow-[var(--shadow-ember)]">
              <f.icon className="size-5" />
            </div>
            <h3 className="font-display text-xl mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground font-mono">
        Hermes Forge · forged in the cyber-desert
      </footer>
    </div>
  );
}
