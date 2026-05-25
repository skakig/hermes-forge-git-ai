import { createFileRoute } from "@tanstack/react-router";
import { advanceDueLoops } from "@/lib/hermes.server";

// Public cron endpoint. Auth is via the Supabase anon key in the `apikey`
// header (set by pg_cron). The endpoint only triggers background advancement
// of loops already in the queue — no PII is returned, no user input accepted.
export const Route = createFileRoute("/api/public/hermes-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const res = await advanceDueLoops(10);
        return Response.json({ ok: true, ...res });
      },
    },
  },
});