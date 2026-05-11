import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Sidebar } from "@/components/forge/Sidebar";
import { Topbar } from "@/components/forge/Topbar";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/dashboard")({
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
