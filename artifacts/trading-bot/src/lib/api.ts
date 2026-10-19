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
  paperTradeMode: "fixed" | "percent";
  paperTradeAmountUsdt: number;
  paperTradeSizePct: number;
  paperMode: "prediction" | "spot";
  paperPredictionPrice: number;
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
  liveVenue: "prediction" | "spot";
  predictionSymbol: string;
  predictionQuery: string;
  predictionBetUsdt: number;
  predictionMaxExposureUsdt: number;
  predictionDryRun: boolean;
  predictionAutoRedeem: boolean;
  useCommunityLearning: boolean;
  settingsVersion: number;
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
  kind: "position" | "prediction";
  slotEnd: number | null;
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
  kind?: "prediction";
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
  community?: {
    enabled: boolean;
    users: number;
    trades: number;
    winRate?: number | null;
    updatedAt?: number;
    byMode?: Record<string, { trades: number; wins: number; pnl: number }>;
    recommended?: Record<string, unknown>;
    insights?: string[];
  };
}

export interface LiveAccount {
  ok: boolean;
  venue?: "prediction" | "spot";
  status?: string;
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
    venue?: "prediction" | "spot";
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
  slots?: SlotsView;
  prediction?: {
    venue: "prediction" | "spot";
    dryRun: boolean;
    symbol: string;
    exposure: number;
    bets: PredictionBet[];
  };
}

export interface PredictionBet {
  id: string;
  symbol: string;
  slotStart: number;
  slotEnd: number;
  direction: Side | "neutral";
  confidence: number;
  amount: number;
  dryRun: boolean;
  status: "placed" | "dry_run" | "skipped" | "failed";
  reason: string | null;
  createdAt: number;
  marketTitle: string | null;
  outcome: string | null;
  shares: number | null;
  avgPrice: number | null;
  orderId: string | null;
  result: "win" | "loss" | "flat" | null;
  pnl: number | null;
}

export interface PredictionMarket {
  marketTopicId: string;
  title: string;
  endTime: number | null;
  startTime: number | null;
  outcomes: { tokenId: string; label: string }[];
}

export interface MarketSearch {
  ok: boolean;
  error?: string;
  query?: string;
  slotEnd?: number;
  count?: number;
  markets?: PredictionMarket[];
  match?: (PredictionMarket & { up: { label: string } | null; down: { label: string } | null }) | null;
  raw?: string;
}

export interface Slot {
  slotStart: number;
  slotEnd: number;
  open: number;
  direction: Side | "neutral";
  confidence: number;
  predictedAt: number;
  priceAtPrediction: number;
  close: number | null;
  actual: "up" | "down" | "flat" | null;
  hit: boolean | null;
}

export interface SlotsView {
  bySymbol: Record<string, { slots: Slot[]; scored: number; hits: number; accuracy: number | null }>;
  scored: number;
  hits: number;
  accuracy: number | null;
  interval: string;
}

export interface Tick {
  symbol: string;
  price: number;
  time: number;
}

/** Binance kline subset: [openTime, open, high, low, close] */
export type Kline = [number, number, number, number, number];

export interface CredentialInfo {
  hasCredentials: boolean;
  keyPreview: string | null;
  testnet: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

const BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
const TOKEN_KEY = "bot-session";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

export const authHeaders = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let data: { error?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?token=${encodeURIComponent(getToken())}`;
}

export const tradesCsvUrl = () => `${BASE}/trades.csv`;
