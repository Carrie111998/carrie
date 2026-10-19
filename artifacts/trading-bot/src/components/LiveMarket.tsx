import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { useBot } from "@/hooks/useBot";
import { api, type Kline, type PredictionBet, type Slot } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Meter } from "@/components/bits";

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000,
};
const MAX_POINTS = 900; // 15 minutes of 1-second points

const usd = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : `$${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const decimals = (p: number) => (p >= 100 ? 2 : p >= 1 ? 4 : 6);

function Call({ dir, conf }: { dir: string; conf?: number }) {
  if (dir === "neutral") return <span className="inline-flex items-center gap-1 text-muted-foreground"><Minus className="h-4 w-4" /> NO CALL</span>;
  const up = dir === "long";
  return (
    <span className={cn("inline-flex items-center gap-1 font-bold", up ? "text-emerald-400" : "text-red-400")}>
      {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
      {up ? "UP" : "DOWN"}
      {conf != null && <span className="font-mono font-normal text-foreground/80">{conf.toFixed(0)}%</span>}
    </span>
  );
}

function BetLine({ bet }: { bet: PredictionBet | undefined }) {
  if (!bet) return null;
  const label: Record<string, string> = { placed: "BET PLACED", dry_run: "DRY RUN", skipped: "NO BET", failed: "BET FAILED" };
  const color: Record<string, string> = {
    placed: "bg-amber-500/15 text-amber-300", dry_run: "bg-sky-500/15 text-sky-300",
    skipped: "bg-slate-500/15 text-slate-300", failed: "bg-red-500/15 text-red-300",
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className={cn("rounded px-1.5 py-0.5 font-semibold", color[bet.status])}>{label[bet.status]}</span>
      {(bet.status === "placed" || bet.status === "dry_run") && (
        <span className="font-mono">
          {usd(bet.amount)} on “{bet.outcome}” → {bet.shares != null ? bet.shares.toFixed(3) : "?"} shares
          {bet.avgPrice != null && ` @ ${Number(bet.avgPrice).toFixed(3)}`}
        </span>
      )}
      {bet.reason && <span className="text-muted-foreground">{bet.reason}</span>}
      {bet.result && bet.status === "placed" && (
        <span className={bet.result === "win" ? "text-emerald-400" : "text-red-400"}>
          {bet.result} {bet.pnl != null && `${bet.pnl >= 0 ? "+" : ""}${bet.pnl.toFixed(4)} USDT (est.)`}
        </span>
      )}
    </div>
  );
}

function Result({ slot }: { slot: Slot }) {
  if (slot.hit == null) return <span className="text-muted-foreground">{slot.actual === "flat" ? "flat" : "—"}</span>;
  return slot.hit ? (
    <span className="inline-flex items-center gap-0.5 text-emerald-400"><Check className="h-3.5 w-3.5" />won</span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-red-400"><X className="h-3.5 w-3.5" />lost</span>
  );
}

export default function LiveMarket() {
  const { settings, state, watchTicks } = useBot();
  const symbols = settings?.symbols ?? [];
  const interval = settings?.interval ?? "5m";
  const slotMs = INTERVAL_MS[interval] ?? 300_000;
  const [symbol, setSymbol] = useState<string>("");
  const [points, setPoints] = useState<{ t: number; p: number }[]>([]);
  const [slotStart, setSlotStart] = useState<number | null>(null);
  const [priceToBeat, setPriceToBeat] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<"current" | number>("current");
  const [error, setError] = useState("");

  // default to BTC if it's on the list
  useEffect(() => {
    if (!symbols.length) return;
    if (!symbol || !symbols.includes(symbol)) setSymbol(symbols.includes("BTCUSDT") ? "BTCUSDT" : symbols[0]!);
  }, [symbols, symbol]);

  // clock for the countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // history: last 5 minutes of 1-second candles
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setPoints([]);
    setError("");
    api<Kline[]>(`/market/klines?symbol=${symbol}&interval=1s&limit=300`)
      .then((rows) => !cancelled && setPoints(rows.map((r) => ({ t: r[0], p: r[4] }))))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // live trades → 1-second points
  useEffect(() => {
    if (!symbol) return;
    return watchTicks(symbol, (tick) => {
      const sec = Math.floor(tick.time / 1000) * 1000;
      setPoints((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.t === sec) return [...prev.slice(0, -1), { t: sec, p: tick.price }];
        if (last && sec < last.t) return prev;
        const next = [...prev, { t: sec, p: tick.price }];
        return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
      });
    });
  }, [symbol, watchTicks]);

  // price to beat = open of the current slot candle; refresh when a new slot starts
  const currentSlotStart = Math.floor(now / slotMs) * slotMs;
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    api<Kline[]>(`/market/klines?symbol=${symbol}&interval=${interval}&limit=1`)
      .then((rows) => {
        if (cancelled || !rows[0]) return;
        setSlotStart(rows[0][0]);
        setPriceToBeat(rows[0][1]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, currentSlotStart]);

  const price = points.length ? points[points.length - 1]!.p : null;
  const start = slotStart ?? currentSlotStart;
  const slotEnd = start + slotMs;
  const remaining = Math.max(0, slotEnd - now);
  const diff = price != null && priceToBeat != null ? price - priceToBeat : null;
  const dp = price != null ? decimals(price) : 2;

  const symSlots = state?.slots?.bySymbol[symbol];
  const slots = symSlots?.slots ?? [];
  const currentCall = slots.find((s) => s.slotStart === start);
  const past = [...slots].filter((s) => s.close != null).reverse();
  const lean = state?.signals?.find((s) => s.symbol === symbol);
  const betFor = (t: number) => state?.prediction?.bets.find((b) => b.symbol === symbol && b.slotStart === t);
  const upcoming = [1, 2, 3, 4].map((i) => start + i * slotMs);
  const selectedPast = typeof selected === "number" && selected < start ? slots.find((s) => s.slotStart === selected) : undefined;
  const selectedFuture = typeof selected === "number" && selected > start ? selected : undefined;

  // chart: from slot start (at least the last minute, at most 5 minutes)
  const from = Math.max(now - 300_000, Math.min(start, now - 60_000));
  const view = useMemo(() => points.filter((p) => p.t >= from), [points, from]);
  const domain = useMemo(() => {
    const vals = view.map((v) => v.p);
    if (priceToBeat != null) vals.push(priceToBeat);
    if (!vals.length) return ["auto", "auto"] as const;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.15, hi * 0.0002);
    return [lo - pad, hi + pad] as const;
  }, [view, priceToBeat]);

  const onTrack =
    currentCall && currentCall.direction !== "neutral" && diff != null
      ? (currentCall.direction === "long") === diff > 0
      : null;

  if (!symbols.length) return null;

  return (
    <section className="rounded-lg border border-card-border bg-card">
      {/* Header: pair + countdown, then price to beat · current price */}
      <div className="p-4 pb-2 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <select
            aria-label="Trading pair"
            className="h-8 rounded border border-input bg-background px-2 text-xs font-mono"
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value);
              setSelected("current");
            }}
          >
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex gap-3 text-center" aria-label="Time left in this slot">
            {[Math.floor(remaining / 60_000), Math.floor((remaining % 60_000) / 1000)].map((v, i) => (
              <div key={i}>
                <div className="text-2xl sm:text-3xl font-bold font-mono leading-none">{String(v).padStart(2, "0")}</div>
                <div className="text-[10px] text-muted-foreground">{i === 0 ? "m" : "s"}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
          <div>
            <div className="text-xs text-muted-foreground">Price to Beat</div>
            <div className="text-xl sm:text-2xl font-bold font-mono">{usd(priceToBeat, dp)}</div>
          </div>
          <div className="sm:border-l sm:border-border sm:pl-6">
            <div className="text-xs text-muted-foreground">
              Current Price{" "}
              {diff != null && (
                <span className={diff >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {diff >= 0 ? "+" : "-"}{usd(Math.abs(diff), dp)}
                </span>
              )}
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-amber-400">{usd(price, dp)}</div>
          </div>
        </div>
      </div>

      {/* Live chart */}
      <div className="h-52 sm:h-64 px-1">
        {error ? (
          <div className="flex h-full items-center justify-center text-sm text-red-300 px-4 text-center">Live data unavailable: {error}</div>
        ) : view.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Connecting to Binance live data…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={view} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={hhmmss}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                minTickGap={50}
              />
              <YAxis
                orientation="right"
                domain={domain as [number, number]}
                width={64}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => v.toFixed(dp > 2 ? dp : 0)}
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                labelFormatter={(t) => hhmmss(Number(t))}
                formatter={(v: number) => [usd(v, dp), "Price"]}
              />
              {priceToBeat != null && (
                <ReferenceLine
                  y={priceToBeat}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="3 3"
                  label={{ value: "Target", position: "insideTopRight", fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                />
              )}
              <Line type="stepAfter" dataKey="p" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Slots: past · current · upcoming */}
      <div className="flex gap-2 overflow-x-auto border-t border-card-border px-4 py-3">
        <select
          aria-label="Past slots"
          className={cn(
            "h-9 w-24 flex-shrink-0 rounded-md border bg-background px-2 text-sm",
            selectedPast ? "border-primary text-primary" : "border-input",
          )}
          value={selectedPast ? String(selectedPast.slotStart) : ""}
          onChange={(e) => e.target.value && setSelected(Number(e.target.value))}
        >
          <option value="">Past</option>
          {past.map((s) => (
            <option key={s.slotStart} value={s.slotStart}>
              {hhmm(s.slotStart)} · {s.direction === "neutral" ? "no call" : s.direction === "long" ? "UP" : "DOWN"} ·{" "}
              {s.hit == null ? "—" : s.hit ? "✓ won" : "✗ lost"}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSelected("current")}
          className={cn(
            "flex h-9 flex-shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-mono",
            selected === "current" ? "border-emerald-500 text-emerald-400 bg-emerald-500/10" : "border-border",
          )}
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          {hhmm(start)}
        </button>
        {upcoming.map((t) => (
          <button
            key={t}
            onClick={() => setSelected(t)}
            className={cn(
              "h-9 flex-shrink-0 rounded-md border px-3 text-sm font-mono",
              selectedFuture === t ? "border-primary text-primary" : "border-border text-foreground/80",
            )}
          >
            {hhmm(t)}
          </button>
        ))}
      </div>

      {/* Prediction for the selected slot */}
      <div className="border-t border-card-border px-4 py-3 text-sm">
        {selectedPast ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-muted-foreground">Slot {hhmm(selectedPast.slotStart)}–{hhmm(selectedPast.slotEnd)}</span>
            <span>Bot called <Call dir={selectedPast.direction} conf={selectedPast.confidence} /></span>
            <span className="font-mono text-xs">
              {usd(selectedPast.open, dp)} → {usd(selectedPast.close, dp)} ({selectedPast.actual})
            </span>
            <Result slot={selectedPast} />
            <BetLine bet={betFor(selectedPast.slotStart)} />
          </div>
        ) : selectedFuture ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-muted-foreground">The bot makes its call when this slot opens at {hhmm(selectedFuture)}.</span>
            {lean && (
              <span>
                Current lean: <Call dir={lean.direction} conf={lean.confidence} />
              </span>
            )}
          </div>
        ) : currentCall ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Bot predicts <Call dir={currentCall.direction} conf={currentCall.confidence} />
              </span>
              {currentCall.direction !== "neutral" && (
                <span className="text-muted-foreground">
                  closes {currentCall.direction === "long" ? "above" : "below"} {usd(priceToBeat ?? currentCall.open, dp)} at {hhmm(slotEnd)}
                </span>
              )}
              {onTrack != null && (
                <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", onTrack ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300")}>
                  {onTrack ? "on track" : "behind"}
                </span>
              )}
            </div>
            <Meter value={currentCall.confidence} className="max-w-xs" />
            <BetLine bet={betFor(start)} />
            <div className="text-[11px] text-muted-foreground">Called at {hhmmss(currentCall.predictedAt)} using closed candles only.</div>
          </div>
        ) : (
          <div className="text-muted-foreground">
            {state?.status?.running
              ? "Waiting for the bot's call on this slot (it's made on the first scan after the slot opens)."
              : "Start the bot on the Dashboard to get a prediction for every slot."}
            {lean && (
              <span className="ml-2">
                Current lean: <Call dir={lean.direction} conf={lean.confidence} />
              </span>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {symbol} slot accuracy: <b className="text-foreground">{symSlots?.accuracy != null ? `${symSlots.accuracy}%` : "—"}</b>{" "}
            ({symSlots?.hits ?? 0}/{symSlots?.scored ?? 0})
          </span>
          <span>
            All pairs: <b className="text-foreground">{state?.slots?.accuracy != null ? `${state.slots.accuracy}%` : "—"}</b> ({state?.slots?.hits ?? 0}/
            {state?.slots?.scored ?? 0})
          </span>
          <span>Slot length = candle interval ({interval}), set in Settings</span>
        </div>
      </div>
    </section>
  );
}
