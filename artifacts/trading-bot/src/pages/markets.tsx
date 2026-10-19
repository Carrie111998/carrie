import { useState } from "react";
import { useGetMarkets, type Market } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, Search, RefreshCw, LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

function StrengthBar({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-slate-600">—</span>;
  // value is already 0-100 from Python bot
  const pct = Math.min(Math.round(value), 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 tabular-nums w-8">{pct}%</span>
    </div>
  );
}

function RSICell({ rsi }: { rsi: number | null | undefined }) {
  if (rsi == null) return <span className="text-slate-600">—</span>;
  const color = rsi > 70 ? "text-red-400" : rsi < 30 ? "text-emerald-400" : "text-slate-300";
  return <span className={cn("font-mono text-xs", color)}>{rsi.toFixed(1)}</span>;
}

function SignalBadge({ dir }: { dir: "buy" | "sell" | null | undefined }) {
  if (!dir) return <span className="text-slate-600 text-xs">—</span>;
  return (
    <span className={cn("flex items-center gap-1 text-sm font-medium", dir === "buy" ? "text-emerald-400" : "text-red-400")}>
      {dir === "buy" ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {dir.toUpperCase()}
    </span>
  );
}

function MarketCard({ market }: { market: Market }) {
  return (
    <Card className="bg-slate-900 border-slate-700 hover:border-slate-600 transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-medium text-white text-sm">{market.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs font-mono text-slate-500">{market.asset}</span>
              {market.isOtc && (
                <Badge className="bg-purple-900/50 text-purple-300 border-purple-700 text-[10px] px-1 py-0 h-4" variant="outline">
                  OTC
                </Badge>
              )}
            </div>
          </div>
          <Badge className="bg-slate-800 text-slate-400 border-slate-600 text-[10px] px-1.5 capitalize" variant="outline">
            {market.category ?? "—"}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-slate-500 mb-1">Signal</div>
            <SignalBadge dir={market.signalDirection} />
          </div>
          <div>
            <div className="text-slate-500 mb-1">RSI</div>
            <RSICell rsi={market.rsi} />
          </div>
          <div className="col-span-2">
            <div className="text-slate-500 mb-1">Strength</div>
            <StrengthBar value={market.signalStrength} />
          </div>
          <div>
            <div className="text-slate-500 mb-1">Bollinger</div>
            <span className="text-slate-300 capitalize">{market.bollingerSignal ?? "—"}</span>
          </div>
          <div>
            <div className="text-slate-500 mb-1">EMA</div>
            <span className="text-slate-300 capitalize">{market.emaSignal ?? "—"}</span>
          </div>
        </div>

        {market.payout != null && (
          <div className="flex items-center justify-between pt-1 border-t border-slate-800">
            <span className="text-xs text-slate-500">Payout</span>
            <span className="text-sm font-mono text-emerald-400">{market.payout}%</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Markets() {
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<"list" | "card">("list");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: markets, isLoading, refetch, isFetching } = useGetMarkets({ query: { refetchInterval: 10000 } as any });

  const all = markets ?? [];
  const filtered = all.filter((m: Market) => {
    const matchesSearch =
      (m.name ?? "").toLowerCase().includes(filter.toLowerCase()) ||
      (m.asset ?? "").toLowerCase().includes(filter.toLowerCase());
    const matchesCat =
      category === "all" ||
      (category === "otc" && m.isOtc) ||
      (category === "regular" && !m.isOtc) ||
      m.category === category;
    return matchesSearch && matchesCat;
  });

  const withSignals = all.filter((m: Market) => m.signalDirection).length;
  const categories = ["all", "otc", "forex", "crypto", "stocks", "indices"];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Markets</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {all.length} markets — {withSignals} with signals
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-md border border-slate-700 overflow-hidden">
            <button
              onClick={() => setView("list")}
              className={cn("px-2.5 py-1.5 transition-colors", view === "list" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300")}
              title="List view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView("card")}
              className={cn("px-2.5 py-1.5 transition-colors", view === "card" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300")}
              title="Card view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-slate-700 text-slate-400 hover:bg-slate-800"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3 w-3 mr-2", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search markets..."
            className="pl-9 bg-slate-800 border-slate-700 text-white text-sm h-8"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "px-2.5 py-1 rounded text-xs capitalize transition-colors",
                category === c ? "bg-slate-700 text-white font-medium" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-slate-500">Loading markets...</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-500">No markets found</div>
      ) : view === "card" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((market: Market) => (
            <MarketCard key={market.asset} market={market} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/60">
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Market</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Signal</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Strength</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">RSI</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Bollinger</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">EMA</th>
                <th className="text-right px-4 py-2.5 text-xs text-slate-400 font-medium">Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map((market: Market) => (
                <tr key={market.asset} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white text-sm">{market.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs font-mono text-slate-500">{market.asset}</span>
                      {market.isOtc && (
                        <Badge className="bg-purple-900/50 text-purple-300 border-purple-700 text-[10px] px-1 py-0 h-4" variant="outline">
                          OTC
                        </Badge>
                      )}
                      <Badge className="bg-slate-800 text-slate-400 border-slate-600 text-[10px] px-1 py-0 h-4 capitalize" variant="outline">
                        {market.category ?? "—"}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <SignalBadge dir={market.signalDirection} />
                  </td>
                  <td className="px-4 py-3">
                    <StrengthBar value={market.signalStrength} />
                  </td>
                  <td className="px-4 py-3">
                    <RSICell rsi={market.rsi} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-400 capitalize">{market.bollingerSignal ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-400 capitalize">{market.emaSignal ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-emerald-400">
                      {market.payout != null ? `${market.payout}%` : "—"}
                    </span>
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
