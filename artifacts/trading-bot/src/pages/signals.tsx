import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useBot } from "@/hooks/useBot";
import type { Signal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, Meter, SideBadge, VoteBar, fmtPrice, fmtTime } from "@/components/bits";
import LiveMarket from "@/components/LiveMarket";

function SignalCard({ s, labels, weights, minConfidence }: { s: Signal; labels: Record<string, string>; weights: Record<string, number>; minConfidence: number }) {
  const [open, setOpen] = useState(false);
  const tradable = s.reasons.length === 0 && s.direction !== "neutral";
  const votes = Object.entries(s.votes).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const bulls = votes.filter(([, v]) => v > 0.15).length;
  const bears = votes.filter(([, v]) => v < -0.15).length;
  return (
    <div className={cn("rounded-lg border bg-card", tradable ? "border-primary/50" : "border-card-border")}>
      <button className="w-full text-left p-4" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-semibold">{s.symbol}</span>
            <SideBadge side={s.direction} />
            {s.blocked && <span className="text-[10px] uppercase text-red-700">blocked</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{fmtPrice(s.price)}</span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Confidence (min {minConfidence}%)</span>
            <span className="font-mono">{s.confidence.toFixed(0)}%</span>
          </div>
          <div className="relative">
            <Meter value={s.confidence} />
            <div className="absolute -top-0.5 h-3 w-0.5 bg-amber-400" style={{ left: `${minConfidence}%` }} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>RSI {s.rsi.toFixed(0)}</span>
          <span>ADX {s.adx.toFixed(0)}</span>
          <span className="capitalize">{s.regime}</span>
          <span className="text-emerald-700">{bulls} bullish</span>
          <span className="text-red-700">{bears} bearish</span>
          <span>{fmtTime(s.time)}</span>
        </div>
        <div className={cn("mt-2 text-xs", tradable ? "text-primary" : "text-muted-foreground")}>
          {tradable ? "✓ Passes all filters — trade signal" : `Not traded: ${s.reasons.join(", ")}`}
        </div>
      </button>
      {open && (
        <div className="border-t border-card-border px-4 py-3 space-y-2">
          {votes.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[1fr_5rem_3rem] sm:grid-cols-[12rem_1fr_3rem] items-center gap-2 text-xs">
              <span className="truncate">
                {labels[k] ?? k} <span className="text-muted-foreground">×{(weights[k] ?? 1).toFixed(2)}</span>
              </span>
              <VoteBar value={v} />
              <span className={cn("text-right font-mono", v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-muted-foreground")}>
                {v > 0 ? "+" : ""}{v.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Signals() {
  const { state, settings } = useBot();
  const signals = state?.signals ?? [];
  const labels = Object.fromEntries((state?.learning?.indicators ?? []).map((i) => [i.key, i.label]));
  const weights = Object.fromEntries(Object.entries(settings?.indicators ?? {}).map(([k, v]) => [k, v.weight]));
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold">Signals</h1>
        <p className="text-xs text-muted-foreground">
          Every pair is scored by {Object.values(settings?.indicators ?? {}).filter((i) => i.enabled).length} indicators and prediction tools. Votes are
          combined by their learned weights into one prediction. Tap a card to see every vote.
        </p>
      </div>
      <LiveMarket />
      {signals.length === 0 ? (
        <Empty>No signals yet — start the bot to scan the market.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {signals.map((s) => (
            <SignalCard key={s.symbol} s={s} labels={labels} weights={weights} minConfidence={settings?.minConfidence ?? 60} />
          ))}
        </div>
      )}
    </div>
  );
}
