import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { ArrowRight, Flame, Github, Eye, Bot, GitPullRequest, Sparkles } from "lucide-react";

export const Route = createFileRoute("/how-it-works")({
  component: HowItWorks,
  head: () => ({
    meta: [
      { title: "How it works — Hermes Forge" },
      { name: "description", content: "Connect, audit, forge, ship. The four-phase ritual Hermes Forge runs on every repository — autonomously and in the background." },
      { property: "og:title", content: "How it works — Hermes Forge" },
      { property: "og:description", content: "The four-phase ritual Hermes Forge runs on every repository — autonomously and in the background." },
    ],
  }),
});

const steps = [
  {
    n: "01",
    icon: Github,
    title: "Connect",
    sub: "Bind a repository to the forge",
    body: "OAuth into GitHub with scoped, revocable permissions. Pick any repo — public, private, mono, or many. The agent never touches main directly; every action is branch-and-PR.",
    panel: ["✓ skakig/hermes-webui — connected", "✓ skakig/cae-content — connected", "○ skakig/desert-queen — pending"],
  },
  {
    n: "02",
    icon: Eye,
    title: "Audit",
    sub: "Walk every file. Map the debt.",
    body: "Hermes walks your tree, fingerprints architecture, and builds an internal map of code, content, docs and dead corners. Nothing is shipped yet. Just understanding.",
    panel: ["scanning src/ … 412 files", "scanning content/ … 38 files", "graphing dependencies …", "auditing docs/ for drift …"],
  },
  {
    n: "03",
    icon: Bot,
    title: "Critique & Forge",
    sub: "Score, then generate the diff",
    body: "Quality, clarity, content fit, naming, dead code, missing types, drift between docs and reality — each scored. Then the agent forges improvements as real, reviewable diffs.",
    panel: ["critique: hermes-webui · grade B+", "+ refactor LoopControl (clarity)", "+ tighten CAE copy (voice)", "+ add tests for queue/*", "writing diff …"],
  },
  {
    n: "04",
    icon: GitPullRequest,
    title: "Ship",
    sub: "Clean branch. Reasoned PR.",
    body: "A fresh branch, atomic commits with reasoning, a PR with the critique inline, and a link back to the loop run. You review. You merge. The loop runs again tomorrow.",
    panel: ["✓ branch forge/refactor-loop-control", "✓ 6 commits with reasoning", "✓ PR #142 opened", "↻ scheduled next loop in 24h"],
  },
];

function HowItWorks() {
  return (
    <MarketingShell>
      <section className="container mx-auto px-6 pt-20 pb-12 text-center max-w-3xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/40 bg-primary/10 text-xs uppercase tracking-[0.25em] text-primary mb-6">
          <Sparkles className="size-3" /> The Ritual
        </div>
        <h1 className="font-display text-5xl md:text-6xl text-glow">How the Forge works</h1>
        <p className="mt-5 text-lg text-muted-foreground">
          Four phases, one loop. Hermes runs them on a cadence you set — silently, in the background, on every repo you connect.
        </p>
      </section>

      <section className="relative container mx-auto px-6 py-16">
        <div className="absolute inset-0 rune-grid opacity-20 pointer-events-none" />
        <div className="relative max-w-5xl mx-auto">
          {/* Vertical ember spine */}
          <div className="absolute left-6 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-primary/60 to-transparent" />

          <div className="space-y-16">
            {steps.map((s, i) => (
              <div key={s.n} className={`relative grid md:grid-cols-2 gap-8 items-center ${i % 2 === 1 ? "md:[direction:rtl]" : ""}`}>
                {/* Node */}
                <div className="absolute left-6 md:left-1/2 -translate-x-1/2 size-4 rounded-full ember-gradient shadow-[var(--shadow-ember)] pulse-ember" />
                <div className={`pl-16 md:pl-0 ${i % 2 === 0 ? "md:pr-16 md:text-right" : "md:pl-16 [direction:ltr]"}`}>
                  <div className="font-mono text-xs text-primary/80 tracking-[0.3em] mb-2">PHASE {s.n}</div>
                  <h3 className="font-display text-3xl md:text-4xl mb-1">{s.title}</h3>
                  <div className="text-sm text-muted-foreground italic mb-3">{s.sub}</div>
                  <p className="text-muted-foreground leading-relaxed">{s.body}</p>
                </div>
                <div className={`pl-16 md:pl-0 ${i % 2 === 0 ? "md:pl-16" : "md:pr-16 [direction:ltr]"}`}>
                  <div className="rounded-2xl border border-border/60 glass p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="size-8 rounded-md ember-gradient grid place-items-center text-primary-foreground">
                        <s.icon className="size-4" />
                      </div>
                      <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">phase output</span>
                    </div>
                    <ul className="space-y-1.5 font-mono text-xs text-muted-foreground">
                      {s.panel.map(line => (
                        <li key={line} className="border-l-2 border-primary/30 pl-3">{line}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-6 py-20">
        <div className="relative rounded-3xl border border-primary/30 overflow-hidden p-12 text-center">
          <div className="absolute inset-0" style={{ background: "var(--gradient-rune)" }} />
          <div className="relative z-10 max-w-2xl mx-auto">
            <h2 className="font-display text-3xl md:text-4xl">Ready to run the loop?</h2>
            <p className="mt-3 text-muted-foreground">Connect a repo and the first audit starts within minutes.</p>
            <Link to="/dashboard/repos" className="inline-block mt-6">
              <Button size="lg" className="ember-gradient text-primary-foreground border-0 gap-2">
                <Flame className="size-4" /> Ignite the Forge <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}