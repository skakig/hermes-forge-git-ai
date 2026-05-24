import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Flame, Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

type Search = { redirect?: string; mode?: "signin" | "signup" };

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
    mode: s.mode === "signup" ? "signup" : "signin",
  }),
  beforeLoad: async ({ search }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      throw redirect({ to: search.redirect ?? "/dashboard/repos" } as never);
    }
  },
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign in — Hermes Forge" },
      { name: "description", content: "Sign in to Hermes Forge to ignite autonomous AI pull requests on your GitHub repositories." },
      { property: "og:title", content: "Sign in — Hermes Forge" },
      { property: "og:description", content: "Sign in or create an account to start forging." },
    ],
  }),
});

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const target = search.redirect ?? "/dashboard/repos";

  const [tab, setTab] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        let dest = target;
        try {
          const stashed = sessionStorage.getItem("hermes:postLoginRedirect");
          if (stashed) {
            dest = stashed;
            sessionStorage.removeItem("hermes:postLoginRedirect");
          }
        } catch {
          /* ignore */
        }
        navigate({ to: dest } as never);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [navigate, target]);

  const onEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (tab === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back to the Forge.");
        navigate({ to: target } as never);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/login` },
        });
        if (error) throw error;
        // Supabase returns 200 with an empty identities array when the email
        // is already registered (anti-enumeration). Detect and surface it.
        const alreadyExists =
          !data.session &&
          data.user &&
          Array.isArray(data.user.identities) &&
          data.user.identities.length === 0;
        if (alreadyExists) {
          setTab("signin");
          const msg = "An account with this email already exists. Try signing in — or use Google if you signed up that way.";
          setErr(msg);
          toast.error(msg);
        } else if (data.session) {
          toast.success("Account forged. Igniting…");
          navigate({ to: target } as never);
        } else {
          toast.success("Check your email to confirm your account.");
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    setErr(null);
    setOauthLoading(true);
    try {
      // Stash the post-auth destination — the OAuth broker requires a clean
      // redirect_uri without query strings.
      try {
        sessionStorage.setItem("hermes:postLoginRedirect", target);
      } catch {
        /* ignore */
      }
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/login`,
      });
      if (result.error) throw result.error;
      if (!("redirected" in result) || !result.redirected) {
        navigate({ to: target } as never);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Google sign-in failed.";
      setErr(msg);
      toast.error(msg);
      setOauthLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative grid place-items-center px-6 py-16 overflow-hidden">
      <div className="absolute inset-0 rune-grid opacity-20" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "var(--gradient-rune)" }}
      />
      <div className="relative w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-3 mb-8">
          <div className="size-10 rounded-lg ember-gradient grid place-items-center shadow-[var(--shadow-ember)]">
            <Flame className="size-4 text-primary-foreground" />
          </div>
          <div className="font-display text-xl">
            Hermes <span className="text-primary">Forge</span>
          </div>
        </Link>

        <div className="rounded-3xl border border-border/60 glass p-8 shadow-[var(--shadow-ember)]">
          <div className="text-center mb-6">
            <h1 className="font-display text-3xl text-glow">
              {tab === "signin" ? "Return to the Forge" : "Ignite your Forge"}
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              {tab === "signin"
                ? "Sign in to continue the ritual."
                : "Create an account to start shipping autonomous PRs."}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full gap-2 mb-5"
            onClick={onGoogle}
            disabled={oauthLoading || loading}
          >
            {oauthLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GoogleGlyph />
            )}
            Continue with Google
          </Button>

          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground mb-5">
            <div className="h-px flex-1 bg-border/60" />
            or
            <div className="h-px flex-1 bg-border/60" />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
            <TabsList className="grid grid-cols-2 w-full mb-5">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-0">
              <EmailForm
                email={email}
                password={password}
                setEmail={setEmail}
                setPassword={setPassword}
                onSubmit={onEmailSubmit}
                loading={loading}
                cta="Sign in"
              />
            </TabsContent>
            <TabsContent value="signup" className="mt-0">
              <EmailForm
                email={email}
                password={password}
                setEmail={setEmail}
                setPassword={setPassword}
                onSubmit={onEmailSubmit}
                loading={loading}
                cta="Create account"
              />
            </TabsContent>
          </Tabs>

          {err && (
            <div className="mt-4 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-3">
              {err}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground mt-6 text-center font-mono">
            By continuing, you accept the cyber-desert covenant.
          </p>
        </div>

        <div className="text-center mt-6 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">← Back to the homepage</Link>
        </div>
      </div>
      <Toaster theme="dark" />
    </div>
  );
}

function EmailForm(props: {
  email: string;
  password: string;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
  cta: string;
}) {
  return (
    <form onSubmit={props.onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={props.email}
          onChange={(e) => props.setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete={props.cta === "Sign in" ? "current-password" : "new-password"}
          required
          minLength={6}
          value={props.password}
          onChange={(e) => props.setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={props.loading}
        className="w-full gap-2 ember-gradient text-primary-foreground border-0 shadow-[var(--shadow-ember)]"
      >
        {props.loading ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
        {props.cta}
      </Button>
    </form>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/>
    </svg>
  );
}