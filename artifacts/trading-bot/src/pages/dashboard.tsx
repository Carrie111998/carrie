import { useState } from "react";
import { Link } from "wouter";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Play, Square, X, Zap } from "lucide-react";
import { useBot } from "@/hooks/useBot";
import { api, type Position } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Empty, Gauge, Meter, ModeBadge, Panel, SideBadge, Stat, fmtDateTime, fmtPct, fmtPrice, fmtSigned, fmtTime, fmtUsd, pnlClass,
} from "@/components/bits";

function LiveConfirm({ open, onOpenChange, testnet, amount }: { open: boolean; onOpenChange: (v: boolean) => void; testnet: boolean; amount: number }) {
  const { run, settings } = useBot();
  const prediction = settings?.liveVenue === "prediction";
  const dryRun = prediction && settings?.predictionDryRun;
  const [typed, setTyped] = useState("");
  return (
    <AlertDialog open={open} onOpenChange={(v) => { onOpenChange(v); setTyped(""); }}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            {prediction
              ? `Start ${dryRun ? "DRY-RUN" : "REAL-MONEY"} prediction betting?`
              : `Start ${testnet ? "TESTNET" : "REAL-MONEY"} auto trading?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {prediction ? (
                <p>
                  At the start of every {settings?.interval} slot the bot will {dryRun ? "get a quote (no money is spent)" : <>bet <b>{fmtUsd(settings?.predictionBetUsdt)}</b> USDT</>}{" "}
                  on Up or Down for <b>{settings?.predictionSymbol}</b> on Binance Prediction Market when its confidence passes your minimum.
                </p>
              ) : (
                <p>
                  The bot will place real Binance Spot market orders of <b>{fmtUsd(amount)}</b> for every long signal that passes your
                  filters, and sell when the stop-loss, take-profit or time limit is hit.
                </p>
              )}
              {((prediction && !dryRun) || (!prediction && !testnet)) && (
                <p className="text-amber-300">This uses real funds. Prediction bets can go to zero and past accuracy does not guarantee profit — only use money you can afford to lose.</p>
              )}
              <p>Type <b>START</b> to confirm.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="START" autoCapitalize="characters" />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={typed.trim().toUpperCase() !== "START"}
            className="bg-amber-500 text-black hover:bg-amber-400"
            onClick={() => run("Could not start live trading", () => api("/bot/live", { method: "POST", body: { enabled: true, confirm: true } }))}
          >
            Start live trading
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PositionRow({ p }: { p: Position }) {
  const { run } = useBot();
  return (
    <div className="flex items-center justify-between gap-2 py-2.5 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm font-semibold">{p.symbol}</span>
          <SideBadge side={p.side} />
          <ModeBadge mode={p.mode} />
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 font-mono">
          bet {fmtUsd(p.quote)} · {fmtPrice(p.entryPrice)} → {fmtPrice(p.lastPrice)} · SL {fmtPrice(p.sl)} · TP {fmtPrice(p.tp)}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="text-right">
          <div className={`text-sm font-mono font-semibold ${pnlClass(p.unrealizedPnl)}`}>{fmtSigned(p.unrealizedPnl)}</div>
          <div className={`text-xs font-mono ${pnlClass(p.unrealizedPct)}`}>{fmtSigned(p.unrealizedPct, "%")}</div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={`Close ${p.symbol}`}
          onClick={() => run("Could not close position", () => api(`/positions/${p.id}/close`, { method: "POST" }))}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { state, settings, run } = useBot();
  const [confirmLive, setConfirmLive] = useState(false);
  const st = state?.status;
  const paper = state?.paper;
  const live = state?.live;
  const learning = state?.learning;
  const running = st?.running ?? false;
  const equity = (state?.equity ?? []).map((e) => ({ t: e.t, v: e.v }));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {st?.lastCycle ? `Last scan ${fmtTime(st.lastCycle)} · ${st.cycleMs ?? 0} ms` : "Not scanned yet"}
            {settings && ` · ${settings.symbols.length} pairs · ${settings.interval}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <Button variant="destructive" onClick={() => run("Could not stop", () => api("/bot/stop", { method: "POST" }))}>
              <Square className="h-4 w-4 mr-1.5" /> Stop bot
            </Button>
          ) : (
            <Button onClick={() => run("Could not start", () => api("/bot/start", { method: "POST" }))} disabled={!state?.engineOnline}>
              <Play className="h-4 w-4 mr-1.5" /> Start paper trading
            </Button>
          )}
          <label className="flex items-center gap-2 rounded-md border border-amber-500/40 px-3 py-2">
            <Zap className="h-4 w-4 text-amber-400" />
            <span className="text-sm">Live trading</span>
            <Switch
              checked={st?.liveEnabled ?? false}
              disabled={!st?.hasCredentials}
              onCheckedChange={(v) =>
                v ? setConfirmLive(true) : run("Could not stop live", () => api("/bot/live", { method: "POST", body: { enabled: false } }))
              }
            />
          </label>
        </div>
      </div>

      {!st?.hasCredentials && (
        <div className="rounded-md border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
          Paper trading needs no account. To trade live, connect your Binance Agentic Wallet (Prediction Market) or add Spot API keys in{" "}
          <Link href="/settings" className="text-primary underline">Settings</Link>.
        </div>
      )}
      {st?.simulated && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          Simulation mode (BOT_SIMULATE=1): prices are generated offline, not from Binance.
        </div>
      )}
      {!state?.engineOnline && state && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200">Bot engine is offline — restarting…</div>
      )}
      {st?.calibrating && (
        <div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs text-sky-200">
          Calibrating on historical data: {st.calibrating.symbol} ({st.calibrating.progress}%)
        </div>
      )}
      {st?.errors?.[0] && Date.now() - st.errors[0].time < 10 * 60_000 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200 break-words">
          {fmtTime(st.errors[0].time)} — {st.errors[0].message}
        </div>
      )}

      {/* Accuracy + key stats */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Bot accuracy" action={<Link href="/learning" className="text-xs text-primary">Details</Link>}>
          <div className="flex flex-col items-center gap-3">
            <Gauge value={state?.accuracyScore} label="Overall accuracy score" />
            <div className="w-full space-y-2 text-xs">
              {[
                ["Prediction accuracy (recent 200)", learning?.predictions.recentAccuracy],
                ["Paper win rate (last 20)", paper?.winRate20],
                ["Paper win rate (last 50)", paper?.winRate50],
              ].map(([label, v]) => (
                <div key={label as string}>
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground">{label as string}</span>
                    <span className="font-mono">{fmtPct(v as number | null)}</span>
                  </div>
                  <Meter value={v as number | null} />
                </div>
              ))}
              <div className="flex justify-between pt-1 text-muted-foreground">
                <span>AI model</span>
                <span className="font-mono">
                  {learning?.aiModel.active ? "active" : "learning"} · {learning?.aiModel.samples ?? 0} samples
                </span>
              </div>
            </div>
          </div>
        </Panel>

        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label="Paper equity" value={fmtUsd(paper?.equity)} sub={`start ${fmtUsd(paper?.startBalance, 0)}`} />
            <Stat label="Return" value={fmtSigned(paper?.returnPct, "%")} valueClass={pnlClass(paper?.returnPct)} />
            <Stat label="P&L 24h" value={fmtSigned(paper?.pnlToday)} valueClass={pnlClass(paper?.pnlToday)} sub="USDT" />
            <Stat label="Win rate" value={fmtPct(paper?.winRate)} sub={`${paper?.wins ?? 0}W / ${paper?.losses ?? 0}L`} />
            <Stat label="Profit factor" value={paper?.profitFactor ?? "—"} sub={`avg ${fmtSigned(paper?.avgWin)} / ${fmtSigned(paper?.avgLoss)}`} />
            <Stat label="Open" value={`${paper?.open ?? 0} / ${settings?.maxOpenPositions ?? "—"}`} sub={`${paper?.trades ?? 0} closed`} />
          </div>
          {st?.hasCredentials && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                label={st.venue === "prediction" ? "Prediction balance" : st.liveAccount?.testnet ? "Testnet USDT" : "Binance USDT"}
                value={st.liveAccount?.ok ? fmtUsd(st.liveAccount.usdt) : "—"}
                sub={st.liveAccount?.ok === false ? "check failed" : st.liveEnabled ? "live ON" : "live off"}
                valueClass="text-amber-300"
              />
              <Stat label="Live P&L" value={fmtSigned(live?.pnl)} valueClass={pnlClass(live?.pnl)} sub={`${live?.trades ?? 0} trades`} />
              <Stat label="Live win rate" value={fmtPct(live?.winRate)} sub={`${live?.open ?? 0} open`} />
              <Stat label="Loss today" value={fmtUsd(live?.lossToday)} sub={`limit ${fmtUsd(settings?.liveDailyLossLimitUsdt, 0)}`} />
            </div>
          )}
          <Panel title="Paper equity">
            {equity.length < 2 ? (
              <Empty>Equity curve appears after the first scans.</Empty>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equity} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="t" tickFormatter={fmtTime} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} minTickGap={40} />
                    <YAxis domain={["auto", "auto"]} width={56} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v.toFixed(0)} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                      labelFormatter={(t) => fmtDateTime(Number(t))}
                      formatter={(v: number) => [fmtUsd(v), "Equity"]}
                    />
                    <Area type="monotone" dataKey="v" stroke="hsl(var(--chart-1))" fill="url(#eq)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Open positions (${state?.positions?.length ?? 0})`}>
          {state?.positions?.length ? state.positions.map((p) => <PositionRow key={p.id} p={p} />) : <Empty>No open positions.</Empty>}
        </Panel>
        <Panel title="Activity" action={<Link href="/history" className="text-xs text-primary">All trades</Link>}>
          <div className="max-h-72 overflow-y-auto space-y-1.5 text-xs font-mono">
            {state?.logs?.length ? (
              state.logs.slice(0, 40).map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground flex-shrink-0">{fmtTime(l.time)}</span>
                  <span
                    className={
                      l.level === "error" ? "text-red-300" : l.level === "trade" ? "text-amber-200" : l.level === "tune" ? "text-sky-300" : "text-foreground/80"
                    }
                  >
                    {l.message}
                  </span>
                </div>
              ))
            ) : (
              <Empty>No activity yet — press Start.</Empty>
            )}
          </div>
        </Panel>
      </div>

      <LiveConfirm
        open={confirmLive}
        onOpenChange={setConfirmLive}
        testnet={st?.liveAccount?.testnet ?? true}
        amount={settings?.liveTradeAmountUsdt ?? 0}
      />
    </div>
  );
}
