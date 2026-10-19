import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Activity, Brain, History, LayoutDashboard, Lock, Radar, Settings, Wifi, WifiOff } from "lucide-react";
import { useBot } from "@/hooks/useBot";
import { setPassword } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/signals", label: "Signals", icon: Radar },
  { href: "/learning", label: "Learning", icon: Brain },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

function StatusPill() {
  const { state, wsConnected } = useBot();
  const st = state?.status;
  const label = !state?.engineOnline ? "offline" : st?.running ? (st.liveEnabled ? "live" : st.phase) : "stopped";
  const color = !state?.engineOnline
    ? "bg-red-500/20 text-red-300"
    : st?.liveEnabled
      ? "bg-amber-500/20 text-amber-300"
      : st?.running
        ? "bg-emerald-500/20 text-emerald-300"
        : "bg-slate-500/20 text-slate-300";
  return (
    <div className="flex items-center gap-2">
      {wsConnected ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold uppercase", color)}>{label}</span>
    </div>
  );
}

function PasswordGate() {
  const { retryAuth } = useBot();
  const [pw, setPw] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-lg border border-card-border bg-card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setPassword(pw);
          retryAuth();
        }}
      >
        <div className="flex items-center gap-2 text-foreground">
          <Lock className="h-5 w-5 text-primary" />
          <h1 className="font-semibold">Enter app password</h1>
        </div>
        <Input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="APP_PASSWORD" />
        <Button type="submit" className="w-full">Unlock</Button>
      </form>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { needsPassword } = useBot();
  if (needsPassword) return <PasswordGate />;

  const isActive = (href: string) => (href === "/" ? location === "/" : location.startsWith(href));

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 flex-col border-r border-border bg-card/40 sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-bold leading-tight">Binance Predict Bot</div>
            <div className="text-xs text-muted-foreground">Self-learning crypto bot</div>
          </div>
        </div>
        <div className="px-4 py-3 border-b border-border">
          <StatusPill />
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive(href) ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-border text-[11px] text-muted-foreground">Not financial advice. Trade at your own risk.</div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Binance Predict Bot</span>
          </div>
          <StatusPill />
        </header>

        <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>

        {/* Mobile bottom navigation */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 border-t border-border bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10px]",
                isActive(href) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
