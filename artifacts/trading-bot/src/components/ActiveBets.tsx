import { useEffect, useState } from "react";
import { useBot } from "@/hooks/useBot";
import { Empty, fmtPrice, fmtUsd } from "@/components/bits";
import { cn } from "@/lib/utils";

/** One open Binance Prediction bet (real, test-mode or practice), with what is needed to follow it live. */
export interface ActiveBet {
  id: string;
  symbol: string;
  up: boolean;
  kind: "LIVE" | "TEST" | "PAPER";
  stake: number;
  /** what a win pays back in total (stake included), when known */
  returns: number | null;
  slotStart: number;
  slotEnd: number;
  priceToBeat: number | null;
  market: string | null;
}

/** Every bet still waiting for its round to end: real and test bets on Binance, then practice bets. */
export function useActiveBets(): ActiveBet[] {
  const { state } = useBot();
  const now = Date.now();
  const slotOpen = (sym: string, start: number) =>
    state?.slots?.bySymbol[sym]?.slots.find((s) => s.slotStart === start)?.open ?? null;
  const live: ActiveBet[] = (state?.prediction?.bets ?? [])
    .filter((b) => (b.status === "placed" || b.status === "dry_run") && b.result == null && b.slotEnd > now - 10 * 60_000)
    .map((b) => ({
      id: b.id,
      symbol: b.symbol,
      up: b.direction === "long",
      kind: b.status === "placed" ? "LIVE" : "TEST",
      stake: b.amount,
      returns: b.shares,
      slotStart: b.slotStart,
      slotEnd: b.slotEnd,
      priceToBeat: slotOpen(b.symbol, b.slotStart),
      market: b.marketTitle,
    }));
  const paper: ActiveBet[] = (state?.positions ?? [])
    .filter((p) => p.kind === "prediction" && p.slotEnd)
    .map((p) => ({
      id: p.id,
      symbol: p.symbol,
      up: p.side === "long",
      kind: "PAPER",
      stake: p.quote,
      returns: p.qty,
      slotStart: p.slotStart ?? p.slotEnd! - 300_000,
      slotEnd: p.slotEnd!,
      priceToBeat: p.entryPrice,
      market: null,
    }));
  return [...live, ...paper];
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const KIND_STYLE = {
  LIVE: "bg-amber-500/15 text-amber-800",
  TEST: "bg-secondary text-muted-foreground",
  PAPER: "bg-sky-500/10 text-sky-800",
} as const;

/** A bet followed live: the coin's price right now against the price to beat, and what it pays if the round ended now. */
export function ActiveBetRow({ bet }: { bet: ActiveBet }) {
  const { prices, state } = useBot();
  const now = useNow();
  const tick = prices[bet.symbol];
  const price = tick?.price ?? state?.signals?.find((s) => s.symbol === bet.symbol)?.price ?? null;
  const diff = price != null && bet.priceToBeat != null ? price - bet.priceToBeat : null;
  const winning = diff == null || diff === 0 ? null : bet.up ? diff > 0 : diff < 0;
  const left = Math.max(0, Math.round((bet.slotEnd - now) / 1000));
  const total = Math.max(1, (bet.slotEnd - bet.slotStart) / 1000);
  const profit = bet.returns != null ? bet.returns - bet.stake : null;

  return (
    <div className="py-3 border-b border-border last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-semibold">{bet.symbol.replace("USDT", "")}</span>
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[11px] font-semibold",
                bet.up ? "border-emerald-500/30 text-emerald-700" : "border-red-500/30 text-red-700",
              )}
            >
              {bet.up ? "▲ UP" : "▼ DOWN"}
            </span>
            <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", KIND_STYLE[bet.kind])}>{bet.kind}</span>
            <span className="text-xs text-muted-foreground">
              {fmtUsd(bet.stake)}
              {bet.returns != null && ` · ${(bet.returns / bet.stake).toFixed(2)}×`}
            </span>
          </div>
          <div className="mt-1 text-xs font-mono text-muted-foreground break-words">
            beat {fmtPrice(bet.priceToBeat)} · now{" "}
            <span className={winning == null ? "text-foreground" : winning ? "text-emerald-700" : "text-red-700"}>{fmtPrice(price)}</span>
            {diff != null && ` (${diff >= 0 ? "+" : ""}${fmtPrice(diff)})`}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {left === 0 ? (
            <div className="text-xs font-semibold text-muted-foreground">settling…</div>
          ) : winning == null ? (
            <div className="text-xs font-semibold text-muted-foreground">even</div>
          ) : winning ? (
            <div className="text-sm font-mono font-bold text-emerald-700">{profit != null ? `+${fmtUsd(profit)}` : "winning"}</div>
          ) : (
            <div className="text-sm font-mono font-bold text-red-700">−{fmtUsd(bet.stake)}</div>
          )}
          <div className="text-[11px] text-muted-foreground">
            {left === 0 ? "round ended" : winning == null ? "price on the line" : winning ? "winning now" : "losing now"}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn("h-full rounded-full transition-all", winning == null ? "bg-slate-400" : winning ? "bg-emerald-500" : "bg-red-500")}
            style={{ width: `${Math.min(100, 100 * (1 - left / total))}%` }}
          />
        </div>
        <span className="w-12 text-right font-mono text-[11px] text-muted-foreground">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

export function ActiveBets({ empty = "No open bets right now." }: { empty?: string }) {
  const bets = useActiveBets();
  return bets.length ? <>{bets.map((b) => <ActiveBetRow key={b.id} bet={b} />)}</> : <Empty>{empty}</Empty>;
}
