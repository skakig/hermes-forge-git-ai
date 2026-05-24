import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { Check, Flame, Sparkles, Crown, Pickaxe } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing — Hermes Forge" },
      { name: "description", content: "Apprentice, Forgemaster, Sovereign. Three tiers for engineers who want autonomous PRs at any scale." },
      { property: "og:title", content: "Pricing — Hermes Forge" },
      { property: "og:description", content: "Three tiers for engineers who want autonomous PRs at any scale." },
    ],
  }),
});

const tiers = [
  {
    name: "Apprentice",
    icon: Pickaxe,
    price: "Free",
    cadence: "forever",
    blurb: "Try the Forge on a single repo.",
    features: ["1 connected repository", "5 loops / month", "Community-curated goals", "Public-repo only", "Email digests"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Forgemaster",
    icon: Flame,
    price: "$29",
    cadence: "per month",
    blurb: "For solo builders shipping serious work.",
    features: ["10 connected repositories", "Unlimited loops", "Private repos", "Background mode", "Custom goals", "Priority queue", "Slack & Discord alerts"],
    cta: "Start Forgemaster",
    featured: true,
  },
  {
    name: "Sovereign",
    icon: Crown,
    price: "$99",
    cadence: "per month",
    blurb: "Teams running fleets of repos.",
    features: ["Unlimited repositories", "Unlimited loops", "Team seats included", "SSO (SAML)", "Custom critique rubrics", "Audit log export", "Priority support", "Early access to new models"],
    cta: "Start Sovereign",
    featured: false,
  },
];

const faqs = [
  { q: "Is there a free trial on paid tiers?", a: "Apprentice is free forever. Forgemaster and Sovereign each include a 14-day trial — no card required to start." },
  { q: "Will the agent touch my main branch?", a: "Never. Every change lands on a fresh branch and is opened as a PR for you to review. There is no force-push path." },
  { q: "What permissions does it need?", a: "Scoped, revocable GitHub access. Read for audit; write only to non-default branches and PRs you authorize." },
  { q: "Can I cancel anytime?", a: "Yes. Cancel from your dashboard, keep access until the period ends, and your data exports cleanly." },
];

function PricingPage() {
  return (
    <MarketingShell>
      <section className="container mx-auto px-6 pt-20 pb-12 text-center max-w-3xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/40 bg-primary/10 text-xs uppercase tracking-[0.25em] text-primary mb-6">
          <Sparkles className="size-3" /> Pricing
        </div>
        <h1 className="font-display text-5xl md:text-6xl text-glow">Three obelisks in the sand.</h1>
        <p className="mt-5 text-lg text-muted-foreground">
          Start free. Scale when the Forge starts shipping faster than you can review.
        </p>
      </section>

      <section className="container mx-auto px-6 py-12">
        <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto items-stretch">
          {tiers.map(tier => (
            <div
              key={tier.name}
              className={`relative rounded-3xl p-8 flex flex-col ${
                tier.featured
                  ? "border-2 border-primary/60 glass shadow-[var(--shadow-ember)] md:scale-[1.04] md:-translate-y-2"
                  : "border border-border/60 glass"
              }`}
            >
              {tier.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full ember-gradient text-primary-foreground text-[10px] font-mono uppercase tracking-[0.2em]">
                  Most chosen
                </div>
              )}
              <div className="size-12 rounded-xl ember-gradient grid place-items-center text-primary-foreground mb-4 shadow-[var(--shadow-ember)]">
                <tier.icon className="size-5" />
              </div>
              <div className="font-display text-2xl">{tier.name}</div>
              <div className="text-sm text-muted-foreground mb-5">{tier.blurb}</div>
              <div className="flex items-baseline gap-2 mb-6">
                <div className="font-display text-5xl text-glow">{tier.price}</div>
                <div className="text-xs text-muted-foreground">{tier.cadence}</div>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {tier.features.map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check className="size-4 text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/dashboard/repos">
                <Button
                  className={`w-full gap-2 ${tier.featured ? "ember-gradient text-primary-foreground border-0 shadow-[var(--shadow-ember)]" : ""}`}
                  variant={tier.featured ? "default" : "outline"}
                  size="lg"
                >
                  <Flame className="size-4" /> {tier.cta}
                </Button>
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-8 font-mono">
          Billing rolls out soon — every plan starts on the Apprentice tier and upgrades land in your dashboard.
        </p>
      </section>

      <section className="container mx-auto px-6 py-20 max-w-3xl">
        <h2 className="font-display text-3xl text-center mb-10">Questions before you ignite</h2>
        <div className="space-y-3">
          {faqs.map(f => (
            <details key={f.q} className="group rounded-2xl border border-border/60 glass p-5">
              <summary className="cursor-pointer flex items-center justify-between font-display text-lg">
                {f.q}
                <span className="text-primary transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}