import { useState } from "react";
import {
  useGetBotStatus,
  useGetActiveTrades,
  useGetTradeStats,
  useConnectBot,
  useDisconnectBot,
  useStartBot,
  useStopBot,
  type Trade,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Activity, TrendingUp, TrendingDown, RefreshCw, DollarSign, Zap, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function PhaseColor(phase: string | undefined) {
  const map: Record<string, string> = {
    idle: "bg-slate-600 text-slate-200",
    connecting: "bg-yellow-600 text-yellow-100",
    analysing: "bg-blue-600 text-blue-100",
    trading: "bg-emerald-600 text-emerald-100",
    stopping: "bg-orange-600 text-orange-100",
  };
  return map[phase ?? "idle"] ?? "bg-slate-600 text-slate-200";
}

function TradeRow({ trade }: { trade: Trade }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        {trade.direction === "buy" ? (
          <TrendingUp className="h-4 w-4 text-emerald-400 flex-shrink-0" />
        ) : (
          <TrendingDown className="h-4 w-4 text-red-400 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-mono text-white truncate">{trade.asset}</div>
          <div className="text-xs text-slate-500">{new Date(trade.openTime).toLocaleTimeString()}</div>
        </div>
      </div>
      <div className="flex items-center gap-3 text-right flex-shrink-0">
        <div>
          <div className="text-sm font-mono text-white">${trade.amount.toFixed(2)}</div>
          <div className="text-xs text-slate-500">{trade.duration}s</div>
        </div>
        <Badge
          className={cn(
            "text-xs",
            trade.status === "open"
              ? "bg-blue-900/50 text-blue-300 border-blue-700"
              : trade.status === "win"
              ? "bg-emerald-900/50 text-emerald-300 border-emerald-700"
              : "bg-red-900/50 text-red-300 border-red-700"
          )}
          variant="outline"
        >
          {trade.status}
        </Badge>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [ssid, setSsid] = useState("");
  const [balanceType, setBalanceType] = useState<"demo" | "real">("demo");
  const [connectOpen, setConnectOpen] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qOpts = (ms: number) => ({ query: { refetchInterval: ms } as any });

  const { data: status, isLoading: statusLoading } = useGetBotStatus(qOpts(3000));
  const { data: activeTrades } = useGetActiveTrades(qOpts(3000));
  const { data: stats } = useGetTradeStats(qOpts(5000));

  const connectMut = useConnectBot({
    mutation: {
      onSuccess: () => {
        toast({ title: "Connected!", description: "Bot connected to PocketOption." });
        setConnectOpen(false);
      },
      onError: () =>
        toast({ title: "Connection failed", description: "Check your SSID and try again.", variant: "destructive" }),
    },
  });

  const disconnectMut = useDisconnectBot({
    mutation: {
      onSuccess: () => toast({ title: "Disconnected", description: "Bot disconnected from PocketOption." }),
    },
  });

  const startMut = useStartBot({
    mutation: {
      onSuccess: () => toast({ title: "Bot started", description: "Analysis and trading started." }),
      onError: (e) => toast({ title: "Start failed", description: (e as Error).message, variant: "destructive" }),
    },
  });

  const stopMut = useStopBot({
    mutation: {
      onSuccess: () => toast({ title: "Bot stopped" }),
    },
  });

  const isConnected = status?.connected ?? false;
  const isRunning = status?.running ?? false;
  const winRate = stats?.winRate ?? 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">Real-time trading overview</p>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              {isRunning ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-orange-600 text-orange-400 hover:bg-orange-900/30"
                  onClick={() => stopMut.mutate()}
                  disabled={stopMut.isPending}
                >
                  {stopMut.isPending && <RefreshCw className="h-3 w-3 mr-2 animate-spin" />}
                  Stop Bot
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => startMut.mutate()}
                  disabled={startMut.isPending}
                >
                  {startMut.isPending ? <RefreshCw className="h-3 w-3 mr-2 animate-spin" /> : <Zap className="h-3 w-3 mr-2" />}
                  Start Bot
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="border-slate-600 text-slate-400 hover:bg-slate-800"
                onClick={() => disconnectMut.mutate()}
                disabled={disconnectMut.isPending}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  Connect
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                  <DialogTitle>Connect to PocketOption</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 flex gap-2 text-xs text-amber-300">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>
                      Your SSID is extracted from the PocketOption session cookie in your browser. It is never stored.
                    </span>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ssid" className="text-slate-300">Session SSID</Label>
                    <Input
                      id="ssid"
                      value={ssid}
                      onChange={(e) => setSsid(e.target.value)}
                      placeholder="Paste your PocketOption SSID..."
                      className="bg-slate-800 border-slate-600 text-white font-mono text-xs"
                    />
                    <p className="text-xs text-slate-500">
                      DevTools → Application → Cookies → pocketoption.com → session cookie
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">Account Type</Label>
                    <Select value={balanceType} onValueChange={(v) => setBalanceType(v as "demo" | "real")}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="demo">Demo Account</SelectItem>
                        <SelectItem value="real">Real Account</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {balanceType === "real" && (
                    <div className="rounded-lg border border-red-700/50 bg-red-900/20 px-3 py-2 text-xs text-red-300">
                      ⚠️ Real account selected. Trades will use real funds.
                    </div>
                  )}
                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => connectMut.mutate({ data: { ssid, balanceType } })}
                    disabled={!ssid.trim() || connectMut.isPending}
                  >
                    {connectMut.isPending && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
                    Connect
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Status</span>
              <Activity className="h-4 w-4 text-slate-500" />
            </div>
            <div
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                PhaseColor(status?.phase)
              )}
            >
              {statusLoading ? "..." : (status?.phase ?? "idle")}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Balance</span>
              <DollarSign className="h-4 w-4 text-slate-500" />
            </div>
            <div className="text-xl font-mono font-bold text-white">
              {status?.balance != null ? `$${status.balance.toFixed(2)}` : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 capitalize">{status?.balanceType ?? ""}</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Active Trades</span>
              <Zap className="h-4 w-4 text-slate-500" />
            </div>
            <div className="text-xl font-mono font-bold text-white">{activeTrades?.length ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Win Rate</span>
              <TrendingUp className="h-4 w-4 text-slate-500" />
            </div>
            <div
              className={cn(
                "text-xl font-mono font-bold",
                winRate >= 60 ? "text-emerald-400" : winRate >= 45 ? "text-yellow-400" : "text-red-400"
              )}
            >
              {stats ? `${winRate.toFixed(1)}%` : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{stats?.totalTrades ?? 0} total</div>
          </CardContent>
        </Card>
      </div>

      {/* P&L Row */}
      {stats && (stats.totalTrades ?? 0) > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="text-xs text-slate-400 mb-1">All-time P&L</div>
              <div className={cn("text-lg font-mono font-bold",
                (stats.totalProfit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {(stats.totalProfit ?? 0) >= 0 ? "+" : ""}
                {(stats.totalProfit ?? 0).toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="text-xs text-slate-400 mb-1">24h P&L</div>
              <div className={cn("text-lg font-mono font-bold",
                (stats.todayProfit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {(stats.todayProfit ?? 0) >= 0 ? "+" : ""}
                {(stats.todayProfit ?? 0).toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="text-xs text-slate-400 mb-1">Best Trade</div>
              <div className="text-lg font-mono font-bold text-emerald-400">
                {stats.bestTrade != null ? `+${stats.bestTrade.toFixed(2)}` : "—"}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="text-xs text-slate-400 mb-1">W / L / D</div>
              <div className="text-lg font-mono font-bold text-white">
                <span className="text-emerald-400">{stats.wins ?? 0}</span>
                <span className="text-slate-600 mx-1">/</span>
                <span className="text-red-400">{stats.losses ?? 0}</span>
                <span className="text-slate-600 mx-1">/</span>
                <span className="text-slate-400">{stats.draws ?? 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Trades */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-white flex items-center justify-between">
            Active Trades
            <span className="text-xs font-normal text-slate-500">{activeTrades?.length ?? 0} open</span>
          </CardTitle>
        </CardHeader>
        <Separator className="bg-slate-800" />
        <CardContent className="pt-2 pb-2 px-4">
          {!activeTrades?.length ? (
            <div className="py-8 text-center text-sm text-slate-500">
              {isRunning ? "Waiting for signals..." : "No active trades"}
            </div>
          ) : (
            activeTrades.map((trade) => <TradeRow key={trade.id} trade={trade} />)
          )}
        </CardContent>
      </Card>

      {/* Error */}
      {status?.lastError && (
        <div className="rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-3 flex gap-2 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Error:</strong> {status.lastError}
          </span>
        </div>
      )}
    </div>
  );
}
