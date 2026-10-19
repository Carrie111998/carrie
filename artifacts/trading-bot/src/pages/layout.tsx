import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LayoutDashboard, BarChart2, TrendingUp, History, Settings, Activity, Wifi, WifiOff, Menu, X } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useGetBotStatus } from "@workspace/api-client-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/markets", label: "Markets", icon: BarChart2 },
  { href: "/analysis", label: "Analysis", icon: TrendingUp },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

function PhaseIndicator({ phase }: { phase: string | undefined }) {
  const colors: Record<string, string> = {
    idle: "text-slate-400",
    connecting: "text-yellow-400",
    analysing: "text-blue-400",
    trading: "text-emerald-400",
    stopping: "text-orange-400",
  };
  return (
    <span className={cn("text-xs font-mono capitalize", colors[phase ?? "idle"] ?? "text-slate-400")}>
      {phase ?? "idle"}
    </span>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { connected: wsConnected } = useWebSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 5000 } as any });

  const sidebar = (
    <aside className="w-56 flex-shrink-0 flex flex-col border-r border-slate-800 bg-slate-900 h-full">
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-sm font-bold text-white leading-tight">PocketBot</div>
            <div className="text-xs text-slate-500">Trading Dashboard</div>
          </div>
        </div>
        {/* Close button on mobile */}
        <button
          className="md:hidden text-slate-400 hover:text-white"
          onClick={() => setSidebarOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Bot Status */}
      <div className="mx-3 mt-3 mb-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-400">Status</span>
          {wsConnected ? <Wifi className="h-3 w-3 text-emerald-400" /> : <WifiOff className="h-3 w-3 text-slate-500" />}
        </div>
        <PhaseIndicator phase={status?.phase} />
        {status?.balance != null && (
          <div className="mt-1 text-xs font-mono text-white">
            ${status.balance.toFixed(2)}
            <span className="ml-1 text-slate-500 text-[10px]">{status.balanceType}</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active ? "bg-slate-700 text-white font-medium" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-slate-800 text-xs text-slate-600">BinaryOptionsTools v2</div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:flex">{sidebar}</div>

      {/* Mobile sidebar (slide-in) */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex md:hidden transition-transform duration-200",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebar}
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-400 hover:text-white"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-bold text-white">PocketBot</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {wsConnected ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-slate-500" />}
            <PhaseIndicator phase={status?.phase} />
          </div>
        </div>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
