import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar } from "@/components/forge/Sidebar";
import { Topbar } from "@/components/forge/Topbar";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/", search: { redirect: location.href } as never });
    }
  },
  component: DashboardLayout,
  head: () => ({ meta: [{ title: "Forge · Hermes" }] }),
});

function DashboardLayout() {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 md:p-8 overflow-auto">
          <Outlet />
        </main>
      </div>
      <Toaster theme="dark" />
    </div>
  );
}
