import { useState } from "react";
import { useGetTradeHistory, useGetTradeStats, type Trade } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: string | undefined }) {
  const s = status ?? "open";
  const styles: Record<string, string> = {
    win: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
    loss: "bg-red-900/50 text-red-300 border-red-700",
    draw: "bg-slate-800 text-slate-400 border-slate-600",
    open: "bg-blue-900/50 text-blue-300 border-blue-700",
  };
  return (
    <Badge className={cn("text-xs capitalize", styles[s] ?? styles.open)} variant="outline">
      {s}
    </Badge>
  );
}

function PnlCell({ profit }: { profit: number | null | undefined }) {
  if (profit == null) return <span className="text-slate-600">—</span>;
  return (
    <span className={cn("font-mono text-sm", profit > 0 ? "text-emerald-400" : profit < 0 ? "text-red-400" : "text-slate-400")}>
      {profit > 0 ? "+" : ""}{profit.toFixed(2)}
    </span>
  );
}

function TradeCard({ trade }: { trade: Trade }) {
  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-mono text-sm text-white">{trade.asset}</div>
          <StatusBadge status={trade.status} />
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className={cn("flex items-center gap-1 font-medium",
            trade.direction === "buy" ? "text-emerald-400" : "text-red-400"
          )}>
            {trade.direction === "buy" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {(trade.direction ?? "").toUpperCase()}
          </span>
          <span>${(trade.amount ?? 0).toFixed(2)}</span>
          <span>{(trade.duration ?? 0) >= 60 ? `${(trade.duration ?? 0) / 60}m` : `${trade.duration ?? 0}s`}</span>
        </div>
        <div className="flex items-center justify-between">
          <PnlCell profit={trade.profit} />
          <span className="text-xs text-slate-500">
            {trade.closeTime ? new Date(trade.closeTime).toLocaleTimeString() : "—"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function History() {
  const [view, setView] = useState<"list" | "card">("list");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qOpts = (ms: number) => ({ query: { refetchInterval: ms } as any });
  const { data: trades, isLoading } = useGetTradeHistory({ limit: 200 }, qOpts(5000));
  const { data: stats } = useGetTradeStats(qOpts(5000));

  const closedTrades = (trades ?? []).filter((t: Trade) => t.status !== "open");

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">History</h1>
          <p className="text-sm text-slate-400 mt-0.5">Closed trade log</p>
        </div>
        <div className="flex rounded-md border border-slate-700 overflow-hidden">
          <button
            onClick={() => setView("list")}
            className={cn("px-2.5 py-1.5 transition-colors", view === "list" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300")}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setView("card")}
            className={cn("px-2.5 py-1.5 transition-colors", view === "card" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300")}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (stats.totalTrades ?? 0) > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-xs text-slate-400 mb-1">All-time P&L</div>
              <div className={cn("text-lg font-mono font-bold", (stats.totalProfit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                {(stats.totalProfit ?? 0) >= 0 ? "+" : ""}
                {(stats.totalProfit ?? 0).toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-xs text-slate-400 mb-1">24h P&L</div>
              <div className={cn("text-lg font-mono font-bold", (stats.todayProfit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                {(stats.todayProfit ?? 0) >= 0 ? "+" : ""}
                {(stats.todayProfit ?? 0).toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-xs text-slate-400 mb-1">Win Rate</div>
              <div className={cn("text-lg font-mono font-bold",
                (stats.winRate ?? 0) >= 60 ? "text-emerald-400" : (stats.winRate ?? 0) >= 45 ? "text-yellow-400" : "text-red-400"
              )}>
                {(stats.winRate ?? 0).toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                <span className="text-emerald-400">{stats.wins ?? 0}W</span>
                <span className="text-slate-600 mx-1">/</span>
                <span className="text-red-400">{stats.losses ?? 0}L</span>
                <span className="text-slate-600 mx-1">/</span>
                <span className="text-slate-400">{stats.draws ?? 0}D</span>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-xs text-slate-400 mb-1">Best Trade</div>
              <div className="text-lg font-mono font-bold text-emerald-400">
                {stats.bestTrade != null ? `+${stats.bestTrade.toFixed(2)}` : "—"}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{stats.totalTrades ?? 0} total</div>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-slate-500">Loading history...</div>
      ) : !closedTrades.length ? (
        <div className="py-16 text-center text-slate-500">No closed trades yet</div>
      ) : view === "card" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {closedTrades.map((trade: Trade) => <TradeCard key={trade.id} trade={trade} />)}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[550px]">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/60">
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Asset</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Dir</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Amount</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Dur</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Result</th>
                <th className="text-right px-4 py-2.5 text-xs text-slate-400 font-medium">P&L</th>
                <th className="text-right px-4 py-2.5 text-xs text-slate-400 font-medium">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {closedTrades.map((trade: Trade) => (
                <tr key={trade.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-mono text-sm text-white">{trade.asset}</div>
                    {trade.predictionMethod && (
                      <div className="text-[10px] text-slate-500 capitalize">{trade.predictionMethod}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className={cn("flex items-center gap-1 text-sm font-medium",
                      trade.direction === "buy" ? "text-emerald-400" : "text-red-400"
                    )}>
                      {trade.direction === "buy" ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {(trade.direction ?? "").toUpperCase()}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-white">${(trade.amount ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {(trade.duration ?? 0) >= 60 ? `${(trade.duration ?? 0) / 60}m` : `${trade.duration ?? 0}s`}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={trade.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PnlCell profit={trade.profit} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">
                    {trade.closeTime ? new Date(trade.closeTime).toLocaleTimeString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
