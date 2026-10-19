import { useState } from "react";
import { useGetAnalysis, useGetBotStatus, type AnalysisResult } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, RefreshCw, BarChart2, LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

type TopMarket = NonNullable<AnalysisResult["topMarkets"]>[number];

function ScoreBar({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return null;
  // value is already in ±100 range from Python bot
  const pct = Math.min(Math.round(Math.abs(value)), 100);
  const isPositive = value >= 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 text-[10px] text-slate-500 text-right">{label}</div>
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full", isPositive ? "bg-emerald-500" : "bg-red-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={cn("text-[10px] tabular-nums w-8", isPositive ? "text-emerald-400" : "text-red-400")}>
        {isPositive ? "+" : ""}
        {value.toFixed(1)}
      </div>
    </div>
  );
}

function StrengthBar({ strength }: { strength: number | null | undefined }) {
  // strength is already 0-100 from Python bot
  const pct = Math.min(Math.round(strength ?? 0), 100);
  return (
    <div className="w-16">
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-yellow-500" : "bg-orange-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SignalCard({ signal, idx }: { signal: TopMarket; idx: number }) {
  const hasAiScores = signal.finnhubScore != null || signal.twelveDataScore != null ||
    signal.geminiScore != null || signal.alpacaScore != null;

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                idx === 0
                  ? "bg-yellow-600 text-yellow-100"
                  : idx === 1
                  ? "bg-slate-500 text-white"
                  : idx === 2
                  ? "bg-amber-700 text-amber-100"
                  : "bg-slate-700 text-slate-300"
              )}
            >
              {idx + 1}
            </div>
            <div>
              <div className="font-medium text-white text-sm">{signal.name}</div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono text-slate-500">{signal.asset}</span>
                {signal.isOtc && (
                  <Badge
                    className="bg-purple-900/50 text-purple-300 border-purple-700 text-[10px] px-1 py-0 h-4"
                    variant="outline"
                  >
                    OTC
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div
                className={cn(
                  "flex items-center gap-1.5 text-sm font-bold",
                  signal.direction === "buy" ? "text-emerald-400" : "text-red-400"
                )}
              >
                {signal.direction === "buy" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {(signal.direction ?? "").toUpperCase()}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {Math.round(signal.strength ?? 0)}% strength
              </div>
            </div>
            <StrengthBar strength={signal.strength} />
          </div>
        </div>

        {/* Technical score breakdown */}
        <div className="space-y-1.5 pl-10">
          <ScoreBar label="RSI" value={signal.rsiScore} />
          <ScoreBar label="MACD" value={signal.macdScore} />
          <ScoreBar label="BB" value={signal.bollingerScore} />
          <ScoreBar label="EMA" value={signal.emaScore} />
          <ScoreBar label="Vol" value={signal.volumeScore} />
          {hasAiScores && (
            <div className="border-t border-slate-800 pt-1.5 mt-1.5">
              <ScoreBar label="Finnhub" value={signal.finnhubScore} />
              <ScoreBar label="12Data" value={signal.twelveDataScore} />
              <ScoreBar label="Gemini" value={signal.geminiScore} />
              <ScoreBar label="Alpaca" value={signal.alpacaScore} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SignalRow({ signal, idx }: { signal: TopMarket; idx: number }) {
  const pct = Math.min(Math.round(signal.strength ?? 0), 100);
  return (
    <tr className="hover:bg-slate-800/40 transition-colors">
      <td className="px-4 py-3 text-center">
        <span
          className={cn(
            "inline-flex w-6 h-6 rounded-full items-center justify-center text-xs font-bold",
            idx === 0 ? "bg-yellow-600 text-yellow-100" :
            idx === 1 ? "bg-slate-500 text-white" :
            idx === 2 ? "bg-amber-700 text-amber-100" : "bg-slate-700 text-slate-300"
          )}
        >
          {idx + 1}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-white text-sm">{signal.name}</div>
        <div className="text-xs font-mono text-slate-500">{signal.asset}</div>
      </td>
      <td className="px-4 py-3">
        <span className={cn("flex items-center gap-1 text-sm font-medium",
          signal.direction === "buy" ? "text-emerald-400" : "text-red-400"
        )}>
          {signal.direction === "buy" ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {signal.direction?.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full", pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-yellow-500" : "bg-orange-500")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-slate-400">{pct}%</span>
        </div>
      </td>
      <td className="px-4 py-3">
        {[
          { l: "RSI", v: signal.rsiScore },
          { l: "MACD", v: signal.macdScore },
          { l: "BB", v: signal.bollingerScore },
          { l: "EMA", v: signal.emaScore },
          { l: "Vol", v: signal.volumeScore },
        ].map(({ l, v }) =>
          v != null ? (
            <span
              key={l}
              className={cn("inline-block mr-2 text-[10px]", v >= 0 ? "text-emerald-400" : "text-red-400")}
            >
              {l}:{v > 0 ? "+" : ""}{Math.round(v)}
            </span>
          ) : null
        )}
      </td>
    </tr>
  );
}

export default function Analysis() {
  const [view, setView] = useState<"card" | "list">("card");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qOpts = (ms: number) => ({ query: { refetchInterval: ms } as any });
  const { data: analysis, isLoading } = useGetAnalysis(qOpts(5000));
  const { data: status } = useGetBotStatus(qOpts(3000));

  const isAnalysing = status?.phase === "analysing";
  // progress is already 0-100 from Python bot
  const progressPct = Math.round(analysis?.progress ?? 0);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Analysis</h1>
          <p className="text-sm text-slate-400 mt-0.5">Top-ranked signals for trading</p>
        </div>
        <div className="flex items-center gap-3">
          {isAnalysing && (
            <div className="flex items-center gap-2 text-sm text-blue-400">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="hidden sm:inline">Analysing...</span>
            </div>
          )}
          {analysis?.lastUpdated && (
            <span className="text-slate-600 text-xs hidden sm:inline">
              {new Date(analysis.lastUpdated).toLocaleTimeString()}
            </span>
          )}
          {/* View toggle */}
          <div className="flex rounded-md border border-slate-700 overflow-hidden">
            <button
              onClick={() => setView("card")}
              className={cn("px-2.5 py-1.5 transition-colors", view === "card" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300")}
              title="Card view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView("list")}
              className={cn("px-2.5 py-1.5 transition-colors", view === "list" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300")}
              title="List view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Progress bar while analysing */}
      {isAnalysing && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Scanning markets...</span>
            <span>{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-1.5 bg-slate-700 [&>div]:bg-blue-500" />
        </div>
      )}

      {/* Methods used */}
      {analysis?.methodsUsed && analysis.methodsUsed.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">Methods:</span>
          {analysis.methodsUsed.map((m) => (
            <Badge key={m} className="bg-slate-800 text-slate-300 border-slate-600 text-xs capitalize" variant="outline">
              {m}
            </Badge>
          ))}
        </div>
      )}

      {/* Top signals */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-500">Loading analysis...</div>
      ) : !analysis?.topMarkets?.length ? (
        <div className="py-16 text-center">
          <BarChart2 className="h-10 w-10 text-slate-700 mx-auto mb-3" />
          <div className="text-slate-500 text-sm">No analysis yet</div>
          <div className="text-slate-600 text-xs mt-1">Start the bot to begin market analysis</div>
        </div>
      ) : view === "card" ? (
        <div className="space-y-3">
          {analysis.topMarkets.map((signal: TopMarket, idx: number) => (
            <SignalCard key={signal.asset} signal={signal} idx={idx} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/60">
                <th className="text-center px-4 py-2.5 text-xs text-slate-400 font-medium w-10">#</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Market</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Signal</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Strength</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">Scores</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {analysis.topMarkets.map((signal: TopMarket, idx: number) => (
                <SignalRow key={signal.asset} signal={signal} idx={idx} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
