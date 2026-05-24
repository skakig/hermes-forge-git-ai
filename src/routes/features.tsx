import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Flame, Bot, GitBranch, GitPullRequest, ShieldCheck,
  Workflow, FileText, Activity, Lock, Bell, Clock, Layers, Power, Target,
} from "lucide-react";

export const Route = createFileRoute("/features")({
  component: FeaturesPage,
  head: () => ({
    meta: [
      { title: "Features — Hermes Forge" },
      { name: "description", content: "Background loops, goal alignment, clean PRs, scoped GitHub auth, audit trails — everything the autonomous Forge ships with." },
      { property: "og:title", content: "Features — Hermes Forge" },
      { property: "og:description", content: "Background loops, goal alignment, clean PRs, scoped GitHub auth, audit trails — everything the autonomous Forge ships with." },
    ],
  }),
});

const groups = [
  {
    title: "Autonomy",
    blurb: "The agent works on its own clock.",
    items: [
      { icon: Workflow, title: "Self-improvement loops", desc: "Continuous audit → critique → refine → PR. No babysitting." },
      { icon: Power, title: "Background mode", desc: "Keeps forging while you're offline. Wake up to ready PRs." },
      { icon: Clock, title: "Scheduled cadence", desc: "Daily, weekly, or on-push. Set the rhythm per repo." },
      { icon: Layers, title: "Multi-repo orchestration", desc: "Run dozens of repos in parallel from one dashboard." },
    ],
  },
  {
    title: "Craftsmanship",
    blurb: "Every output is review-ready.",
    items: [
      { icon: GitBranch, title: "Clean branches", desc: "Fresh branch per loop. Never touches main directly." },
      { icon: GitPullRequest, title: "Reasoned commits", desc: "Each commit message explains the why, not just the what." },
      { icon: FileText, title: "Critique reports", desc: "Quality, clarity, and drift scores attached to every PR." },
      { icon: Bot, title: "Content QA", desc: "Voice, tone, and content fit — not just code." },
    ],
  },
  {
    title: "Trust & Control",
    blurb: "You stay sovereign.",
    items: [
      { icon: ShieldCheck, title: "Scoped GitHub auth", desc: "Revocable, least-privilege, audited." },
      { icon: Lock, title: "PR-only writes", desc: "The agent can never force-push to default branches." },
      { icon: Activity, title: "Full audit log", desc: "Every phase, every diff, every decision — timestamped." },
      { icon: Target, title: "Goal alignment", desc: "Steer with goals like 'Improve docs' or 'Refactor X'." },
      { icon: Bell, title: "Smart notifications", desc: "Only ping you when a PR is ready or a loop needs you." },
      { icon: Power, title: "Kill switch", desc: "One click pauses every loop across every repo. Instantly." },
    ],
  },
];

function FeaturesPage() {
  return (
    <MarketingShell>
      <section className="container mx-auto px-6 pt-20 pb-12 text-center max-w-3xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/40 bg-primary/10 text-xs uppercase tracking-[0.25em] text-primary mb-6">
          The arsenal
        </div>
        <h1 className="font-display text-5xl md:text-6xl text-glow">Forged for relentless ones.</h1>
        <p className="mt-5 text-lg text-muted-foreground">
          Hermes Forge isn't a copilot. It's an autonomous agent that ships real PRs — with the guardrails of a senior engineer.
        </p>
      </section>

      {/* Bento hero */}
      <section className="container mx-auto px-6 py-12">
        <div className="grid md:grid-cols-3 md:grid-rows-2 gap-4 max-w-6xl mx-auto" style={{ minHeight: "440px" }}>
          <div className="md:col-span-2 md:row-span-2 relative rounded-3xl border border-primary/30 overflow-hidden p-8 glass">
            <div className="absolute inset-0 rune-grid opacity-30" />
            <div className="relative">
              <Workflow className="size-8 text-primary mb-4" />
              <h3 className="font-display text-3xl mb-2">Always-on loops</h3>
              <p className="text-muted-foreground max-w-md">Hermes runs the audit-critique-forge-ship loop on a cadence you set — for every repo you connect.</p>
              <div className="mt-6 grid grid-cols-4 gap-2 max-w-md font-mono text-[10px]">
                {["AUDIT","CRITIQUE","FORGE","SHIP"].map((p, i) => (
                  <div key={p} className="text-center">
                    <div className="h-1 ember-gradient rounded-full mb-1" style={{ opacity: 0.4 + i * 0.2 }} />
                    <div className="text-muted-foreground">{p}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="relative rounded-3xl border border-border/60 glass p-6">
            <GitPullRequest className="size-7 text-primary mb-3" />
            <h3 className="font-display text-xl mb-1">Clean PRs</h3>
            <p className="text-xs text-muted-foreground">Atomic commits. Reasoned messages. Critique attached.</p>
          </div>
          <div className="relative rounded-3xl border border-border/60 glass p-6">
            <ShieldCheck className="size-7 text-primary mb-3" />
            <h3 className="font-display text-xl mb-1">Sovereign by default</h3>
            <p className="text-xs text-muted-foreground">Scoped auth, PR-only writes, full audit log.</p>
          </div>
        </div>
      </section>

      {/* Grouped capabilities */}
      {groups.map(group => (
        <section key={group.title} className="container mx-auto px-6 py-12">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-baseline justify-between mb-6 border-b border-border/40 pb-4">
              <h2 className="font-display text-3xl">{group.title}</h2>
              <div className="text-sm text-muted-foreground italic">{group.blurb}</div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {group.items.map(item => (
                <div key={item.title} className="rounded-2xl border border-border/60 glass p-5 hover:border-primary/40 transition-colors">
                  <div className="size-10 rounded-lg ember-gradient grid place-items-center text-primary-foreground mb-3 shadow-[var(--shadow-ember)]">
                    <item.icon className="size-4" />
                  </div>
                  <h3 className="font-display text-base mb-1">{item.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="container mx-auto px-6 py-20">
        <div className="relative rounded-3xl border border-primary/30 overflow-hidden p-12 text-center">
          <div className="absolute inset-0" style={{ background: "var(--gradient-rune)" }} />
          <div className="relative z-10 max-w-2xl mx-auto">
            <h2 className="font-display text-3xl md:text-4xl">Plug in. Walk away.</h2>
            <p className="mt-3 text-muted-foreground">The Forge does what a senior engineer would, on the cadence you set.</p>
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