// Typed client for the bot API (/api) — mirrors artifacts/api-server.

export type Side = "long" | "short";
export type Mode = "paper" | "live";

export interface IndicatorConfig {
  enabled: boolean;
  weight: number;
}

export interface BotSettings {
  symbols: string[];
  interval: "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h";
  scanIntervalSec: number;
  predictionHorizon: number;
  minConfidence: number;
  maxOpenPositions: number;
  paperStartBalance: number;
  paperTradeSizePct: number;
  allowShort: boolean;
  slAtrMult: number;
  tpAtrMult: number;
  maxHoldCandles: number;
  minAdx: number;
  feePct: number;
  indicators: Record<string, IndicatorConfig>;
  indicatorParams: Record<string, number>;
  autoTune: boolean;
  autoTuneEvery: number;
  tuneWeights: boolean;
  tuneThreshold: boolean;
  tuneRisk: boolean;
  tuneFilters: boolean;
  blockedSymbols: string[];
  blockedHours: number[];
  liveTradeAmountUsdt: number;
  liveMaxOpenPositions: number;
  liveDailyLossLimitUsdt: number;
}

export interface Signal {
  symbol: string;
  price: number;
  time: number;
  direction: Side | "neutral";
  confidence: number;
  score: number;
  votes: Record<string, number>;
  atr: number;
  adx: number;
  rsi: number;
  regime: string;
  blocked: boolean;
  reasons: string[];
}

export interface Position {
  id: string;
  mode: Mode;
  symbol: string;
  side: Side;
  qty: number;
  entryPrice: number;
  quote: number;
  sl: number;
  tp: number;
  openTime: number;
  heldCandles: number;
  lastPrice: number;
  confidence: number;
  unrealizedPnl: number;
  unrealizedPct: number;
}

export interface Trade {
  id: string;
  mode: Mode;
  symbol: string;
  side: Side;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  quote: number;
  pnl: number;
  pnlPct: number;
  fees: number;
  result: "win" | "loss";
  exitReason: string;
  openTime: number;
  closeTime: number;
  confidence: number;
  regime: string;
  heldCandles: number;
  votes: Record<string, number>;
}

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  winRate20: number | null;
  winRate50: number | null;
  pnl: number;
  pnlToday: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  open: number;
}

export interface IndicatorStat {
  key: string;
  label: string;
  kind: string;
  accuracy: number;
  samples: number;
  recentAccuracy: number | null;
  weight: number;
  enabled: boolean;
}

export interface GroupRow {
  key: string;
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
}

export interface LossStudy {
  totalTrades: number;
  totalLosses: number;
  lossRate: number;
  byExitReason: { reason: string; count: number }[];
  bySymbol: GroupRow[];
  byHour: GroupRow[];
  byConfidence: GroupRow[];
  byRegime: GroupRow[];
  byDirection: GroupRow[];
  misleading: { indicator: string; label: string; lossBacking: number; winBacking: number; lift: number }[];
  insights: string[];
}

export interface TuneChange {
  param: string;
  from: unknown;
  to: unknown;
  reason: string;
}

export interface Learning {
  indicators: IndicatorStat[];
  predictions: { total: number; accuracy: number | null; recentAccuracy: number | null };
  aiModel: { samples: number; active: boolean; minSamples: number };
  tuningLog: { time: number; changes: TuneChange[] }[];
  calibration: { time: number; samples: number; symbols: number; interval: string } | null;
  lossStudy: LossStudy;
  pendingPredictions: number;
}

export interface LiveAccount {
  ok: boolean;
  usdt?: number;
  canTrade?: boolean;
  testnet?: boolean;
  error?: string;
  checkedAt?: number;
}

export interface BotState {
  engineOnline: boolean;
  logs: { time: number; level: string; message: string }[];
  status?: {
    running: boolean;
    liveEnabled: boolean;
    phase: string;
    lastCycle: number | null;
    cycleMs: number | null;
    nextCycle: number | null;
    simulated: boolean;
    errors: { time: number; message: string }[];
    calibrating: { symbol: string; progress: number } | null;
    hasCredentials: boolean;
    liveAccount: LiveAccount | null;
  };
  paper?: Stats & { balance: number; equity: number; startBalance: number; returnPct: number };
  live?: Stats & { lossToday: number };
  accuracyScore?: number | null;
  positions?: Position[];
  signals?: Signal[];
  learning?: Learning;
  equity?: { t: number; v: number }[];
  recentTrades?: Trade[];
}

export interface CredentialInfo {
  hasCredentials: boolean;
  keyPreview: string | null;
  testnet: boolean;
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

const BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
const PW_KEY = "bot-password";

export function getPassword(): string {
  try {
    return localStorage.getItem(PW_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPassword(pw: string) {
  try {
    localStorage.setItem(PW_KEY, pw);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "x-app-password": getPassword() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
  return data as T;
}

export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?password=${encodeURIComponent(getPassword())}`;
}

export const tradesCsvUrl = () => `${BASE}/trades.csv`;
