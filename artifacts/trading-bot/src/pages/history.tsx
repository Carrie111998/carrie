import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useBot } from "@/hooks/useBot";
import { api, authHeaders, tradesCsvUrl, type Trade } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Empty, ModeBadge, SideBadge, Stat, fmtDateTime, fmtPct, fmtPrice, fmtSigned, fmtUsd, pnlClass } from "@/components/bits";
import { cn } from "@/lib/utils";

type Filter = "all" | "paper" | "live" | "bets";

export default function History() {
  const { state, run } = useBot();
  const [filter, setFilter] = useState<Filter>("all");
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const closedCount = (state?.paper?.trades ?? 0) + (state?.live?.trades ?? 0);

  useEffect(() => {
    if (filter === "bets") return;
    const q = filter === "all" ? "" : `&mode=${filter}`;
    const load = () => api<Trade[]>(`/trades?limit=500${q}`).then(setTrades).catch(() => setTrades((t) => t ?? []));
    load();
    // keep refreshing too (the closed-trade count stops changing once history is full)
    const timer = setInterval(load, 15_000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [filter, closedCount]);
  const bets = state?.prediction?.bets ?? [];

  const stats = filter === "live" ? state?.live : filter === "paper" ? state?.paper : null;

  async function downloadCsv() {
    await run("Export failed", async () => {
      const res = await fetch(tradesCsvUrl(), { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "trades.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Trade history</h1>
          <p className="text-xs text-muted-foreground">All trades are saved on the server and survive restarts.</p>
        </div>
        <div className="flex gap-2">
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(["all", "paper", "live", "bets"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn("px-3 py-1.5 text-xs rounded capitalize", filter === f ? "bg-secondary text-foreground" : "text-muted-foreground")}
              >
                {f === "bets" ? "live bets" : f}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={downloadCsv}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Trades" value={stats.trades} sub={`${stats.wins}W / ${stats.losses}L`} />
          <Stat label="Win rate" value={fmtPct(stats.winRate)} />
          <Stat label="Total P&L" value={fmtSigned(stats.pnl)} valueClass={pnlClass(stats.pnl)} sub="USDT" />
          <Stat label="Profit factor" value={stats.profitFactor ?? "—"} />
        </div>
      )}

      {filter === "bets" ? (
        bets.length === 0 ? (
          <Empty>No Binance Prediction Market attempts yet. They appear here once live betting is on (including dry runs and skipped slots).</Empty>
        ) : (
          <div className="rounded-lg border border-card-border bg-card divide-y divide-border">
            {bets.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-sm font-semibold">{b.symbol}</span>
                    <SideBadge side={b.direction} />
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase">{b.status.replace("_", " ")}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground truncate">
                    {fmtDateTime(b.slotStart)} · {fmtUsd(b.amount)}
                    {b.outcome ? ` on “${b.outcome}”` : ""}
                    {b.shares != null ? ` → ${b.shares.toFixed(3)} shares` : ""} · conf {b.confidence.toFixed(0)}%
                    {b.reason ? ` · ${b.reason}` : ""}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 text-xs">
                  {b.result ? (
                    <span className={b.result === "win" ? "text-emerald-400" : "text-red-400"}>
                      {b.result}
                      {b.pnl != null && b.status === "placed" ? ` ${fmtSigned(b.pnl)}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{b.status === "placed" || b.status === "dry_run" ? "open" : "—"}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : trades == null ? (
        <Empty>Loading…</Empty>
      ) : trades.length === 0 ? (
        <Empty>No closed trades yet.</Empty>
      ) : (
        <div className="rounded-lg border border-card-border bg-card divide-y divide-border">
          {trades.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-sm font-semibold">{t.symbol}</span>
                  {t.kind === "prediction" || t.exitReason === "slot_settled" ? (
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${t.side === "long" ? "border-emerald-500/30 text-emerald-300" : "border-red-500/30 text-red-300"}`}>
                      {t.side === "long" ? "UP" : "DOWN"}
                    </span>
                  ) : (
                    <SideBadge side={t.side} />
                  )}
                  <ModeBadge mode={t.mode} />
                  <span className="text-[11px] text-muted-foreground">{t.exitReason.replace("_", " ")}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground font-mono truncate">
                  {fmtDateTime(t.openTime)} · bet {fmtUsd(t.quote)} · {fmtPrice(t.entryPrice)} → {fmtPrice(t.exitPrice)} · conf {t.confidence.toFixed(0)}% · {t.regime}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className={cn("font-mono text-sm font-semibold", pnlClass(t.pnl))}>{fmtSigned(t.pnl)}</div>
                <div className={cn("font-mono text-xs", pnlClass(t.pnlPct))}>{fmtSigned(t.pnlPct, "%")}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
