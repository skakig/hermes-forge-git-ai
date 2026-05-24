import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionStatusPill } from "./ConnectionStatus";

export function Topbar() {
  return (
    <header className="h-16 border-b border-border/60 px-6 flex items-center justify-end gap-2 glass">
      <Button variant="ghost" size="icon" aria-label="Notifications">
        <Bell className="size-4" />
      </Button>
      <ConnectionStatusPill />
      <div className="size-9 rounded-full ember-gradient grid place-items-center text-sm font-semibold text-primary-foreground">
        H
      </div>
    </header>
  );
}
