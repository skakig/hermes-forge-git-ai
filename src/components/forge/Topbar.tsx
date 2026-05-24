import { Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionStatusPill } from "./ConnectionStatus";

export function Topbar() {
  return (
    <header className="h-16 border-b border-border/60 px-6 flex items-center justify-between glass">
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        <Search className="size-4 text-muted-foreground" />
        <input
          placeholder="Search repos, PRs, runes…"
          className="bg-transparent outline-none text-sm flex-1 placeholder:text-muted-foreground"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon"><Bell className="size-4" /></Button>
        <ConnectionStatusPill />
        <div className="size-9 rounded-full ember-gradient grid place-items-center text-sm font-semibold text-primary-foreground">H</div>
      </div>
    </header>
  );
}
