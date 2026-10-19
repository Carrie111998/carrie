// Live Binance market data for the dashboard chart: one shared trade stream
// (relayed to browsers over our own WebSocket) and a cached klines proxy.
import WebSocket from "ws";
import { logger } from "./lib/logger";

const REST_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
const STREAM_HOSTS = ["wss://data-stream.binance.vision/stream", "wss://stream.binance.com:9443/stream"];
const SIMULATE = process.env["BOT_SIMULATE"] === "1";

export const KLINE_INTERVALS = ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "4h"] as const;
export const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

export interface Tick {
  symbol: string;
  price: number;
  time: number;
}
export type Kline = [time: number, open: number, high: number, low: number, close: number];

type TickListener = (t: Tick) => void;

const INTERVAL_MS: Record<string, number> = {
  "1s": 1000, "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000,
};

// ─── Offline simulation (BOT_SIMULATE=1): per-second random walk ─────────────

const simPrice = new Map<string, number>();
function simNext(symbol: string) {
  const p = simPrice.get(symbol) ?? (symbol.startsWith("BTC") ? 82_000 : 100 + Math.random() * 900);
  const next = p * (1 + (Math.random() - 0.5) * 0.0006);
  simPrice.set(symbol, next);
  return next;
}

function simKlines(symbol: string, interval: string, limit: number): Kline[] {
  const step = INTERVAL_MS[interval] ?? 1000;
  const now = Date.now();
  const last = Math.floor(now / step) * step;
  let p = simPrice.get(symbol) ?? simNext(symbol);
  const out: Kline[] = [];
  for (let i = 0; i < limit; i++) {
    const t = last - i * step;
    const o = p * (1 + (Math.random() - 0.5) * 0.002);
    out.unshift([t, o, Math.max(o, p), Math.min(o, p), p]);
    p = o;
  }
  return out;
}

// ─── Klines (REST, cached) ───────────────────────────────────────────────────

const cache = new Map<string, { at: number; data: Kline[] }>();

export async function getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  if (SIMULATE) return simKlines(symbol, interval, limit);
  const key = `${symbol}:${interval}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 1000) return hit.data;
  let lastErr: unknown;
  for (const host of REST_HOSTS) {
    try {
      const res = await fetch(`${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        lastErr = new Error(`Binance HTTP ${res.status}`);
        if (res.status === 400) break; // bad symbol — other hosts will say the same
        continue;
      }
      const rows = (await res.json()) as unknown[][];
      const data = rows.map((r) => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])] as Kline);
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Binance market data unavailable");
}

// ─── Live trades (one upstream socket, ref-counted subscriptions) ────────────

class LiveStream {
  private ws: WebSocket | null = null;
  private hostIdx = 0;
  private retry = 1000;
  private listeners = new Map<string, Set<TickListener>>();
  private lastSent = new Map<string, number>();
  private latest = new Map<string, Tick>();
  private msgId = 1;
  private simTimer: NodeJS.Timeout | null = null;

  subscribe(symbol: string, fn: TickListener): () => void {
    let set = this.listeners.get(symbol);
    if (!set) {
      set = new Set();
      this.listeners.set(symbol, set);
      this.sendSub("SUBSCRIBE", [symbol]);
    }
    set.add(fn);
    const last = this.latest.get(symbol);
    if (last) fn(last);
    this.ensure();
    return () => {
      const s = this.listeners.get(symbol);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.listeners.delete(symbol);
        this.sendSub("UNSUBSCRIBE", [symbol]);
      }
    };
  }

  private emit(t: Tick) {
    this.latest.set(t.symbol, t);
    // at most ~4 updates per second per symbol is plenty for a chart
    const prev = this.lastSent.get(t.symbol) ?? 0;
    if (t.time - prev < 250) return;
    this.lastSent.set(t.symbol, t.time);
    for (const fn of this.listeners.get(t.symbol) ?? []) fn(t);
  }

  private sendSub(method: "SUBSCRIBE" | "UNSUBSCRIBE", symbols: string[]) {
    if (this.ws?.readyState !== WebSocket.OPEN || symbols.length === 0) return;
    this.ws.send(JSON.stringify({ method, params: symbols.map((s) => `${s.toLowerCase()}@aggTrade`), id: this.msgId++ }));
  }

  private ensure() {
    if (SIMULATE) {
      this.simTimer ??= setInterval(() => {
        for (const sym of this.listeners.keys()) this.emit({ symbol: sym, price: simNext(sym), time: Date.now() });
      }, 300);
      return;
    }
    if (this.ws || this.listeners.size === 0) return;
    const url = STREAM_HOSTS[this.hostIdx % STREAM_HOSTS.length]!;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on("open", () => {
      this.retry = 1000;
      logger.info({ url }, "Binance live stream connected");
      this.sendSub("SUBSCRIBE", [...this.listeners.keys()]);
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { data?: { s?: string; p?: string; T?: number } };
        const d = msg.data;
        if (d?.s && d.p) this.emit({ symbol: d.s, price: Number(d.p), time: d.T ?? Date.now() });
      } catch {
        /* ignore */
      }
    });
    ws.on("error", (err) => logger.warn({ err: String(err), url }, "Binance live stream error"));
    ws.on("close", () => {
      this.ws = null;
      this.hostIdx += 1; // try the other host next time
      if (this.listeners.size === 0) return;
      setTimeout(() => this.ensure(), this.retry);
      this.retry = Math.min(30_000, this.retry * 2);
    });
  }
}

export const liveStream = new LiveStream();
