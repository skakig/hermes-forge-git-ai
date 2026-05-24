import { Link } from "@tanstack/react-router";
import { Flame, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

const navItems = [
  { to: "/", label: "Home", exact: true },
  { to: "/how-it-works", label: "How it works", exact: false },
  { to: "/features", label: "Features", exact: false },
  { to: "/pricing", label: "Pricing", exact: false },
] as const;

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen relative">
      <header className="sticky top-0 z-40 border-b border-border/40 glass">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="size-9 rounded-lg ember-gradient grid place-items-center shadow-[var(--shadow-ember)]">
              <Flame className="size-4 text-primary-foreground" />
            </div>
            <div className="font-display text-lg">
              Hermes <span className="text-primary">Forge</span>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact }}
                className="px-3 py-2 rounded-md text-muted-foreground hover:text-foreground transition-colors data-[status=active]:text-foreground data-[status=active]:bg-primary/10"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/dashboard" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="gap-2">
                <Github className="size-4" /> Sign in
              </Button>
            </Link>
            <Link to="/dashboard/repos">
              <Button size="sm" className="ember-gradient text-primary-foreground border-0 gap-2 shadow-[var(--shadow-ember)]">
                <Flame className="size-4" /> Ignite the Forge
              </Button>
            </Link>
          </div>
        </div>
      </header>
      <main className="relative">{children}</main>
      <footer className="border-t border-border/60 mt-24">
        <div className="container mx-auto px-6 py-12 grid md:grid-cols-4 gap-8 text-sm">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="size-7 rounded-md ember-gradient grid place-items-center">
                <Flame className="size-3.5 text-primary-foreground" />
              </div>
              <span className="font-display">Hermes Forge</span>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Autonomous AI agent that audits, critiques and improves your GitHub repositories — while you sleep.
            </p>
          </div>
          <div>
            <div className="font-display text-xs uppercase tracking-[0.2em] text-primary mb-3">Product</div>
            <ul className="space-y-2 text-muted-foreground">
              <li><Link to="/how-it-works" className="hover:text-foreground">How it works</Link></li>
              <li><Link to="/features" className="hover:text-foreground">Features</Link></li>
              <li><Link to="/pricing" className="hover:text-foreground">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-display text-xs uppercase tracking-[0.2em] text-primary mb-3">Forge</div>
            <ul className="space-y-2 text-muted-foreground">
              <li><Link to="/dashboard" className="hover:text-foreground">Dashboard</Link></li>
              <li><Link to="/dashboard/repos" className="hover:text-foreground">Connect repo</Link></li>
              <li><Link to="/dashboard/goals" className="hover:text-foreground">Goals</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-display text-xs uppercase tracking-[0.2em] text-primary mb-3">Cyber-desert</div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Forged at the edge of the sand. Built for engineers who'd rather ship than babysit a copilot.
            </p>
          </div>
        </div>
        <div className="border-t border-border/40 py-6 text-center text-xs text-muted-foreground font-mono">
          © {new Date().getFullYear()} Hermes Forge · forged in the cyber-desert
        </div>
      </footer>
    </div>
  );
}