// Typed client for the bot API (/api) — mirrors artifacts/api-server.

import { isStandalone } from "./device";
export type Side = "long" | "short";
export type Mode = "paper" | "live";

export interface IndicatorConfig {
  enabled: boolean;
  weight: number;
}

export interface BotSettings {
  symbols: string[];
  interval: "5m";
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
  runDurationMin: number;
  minPayout: number;
  predictionAuth: "wallet" | "apikey";
  predictionFunding: "MPC" | "CEX";
  minEdge: number;
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
    byDirection?: Record<string, { trades: number; wins: number }>;
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
  /** when the current run stops by itself (ms), null = until stopped */
  stopAt?: number | null;
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

export interface MarketOutcome {
  tokenId: string;
  label: string;
  price?: number | null;
}

export interface SlotMarketRow {
  symbol: string;
  ok: boolean;
  error?: string;
  marketTopicId?: string;
  title?: string;
  startTime?: number | null;
  endTime?: number | null;
  up?: MarketOutcome | null;
  down?: MarketOutcome | null;
}

export interface MarketSearch {
  ok: boolean;
  error?: string;
  slotEnd?: number;
  interval?: string;
  rows?: SlotMarketRow[];
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
  isAdmin: boolean;
  held: boolean;
  mustChangePassword: boolean;
}

export interface AdminUser extends User {
  createdAt: number;
  heldAt: number | null;
  running: boolean;
  liveEnabled: boolean;
  paperTrades: number | null;
  paperWinRate: number | null;
  paperBalance: number | null;
  liveTrades: number | null;
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
let onAccountBlocked: (() => void) | null = null;
/** Called when the server says the account was put on hold or needs a new password. */
export const setAccountBlockedHandler = (fn: (() => void) | null) => {
  onAccountBlocked = fn;
};
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
    headers: { "content-type": "application/json", "x-app-mode": isStandalone() ? "standalone" : "browser", ...authHeaders() },
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
    const code = (data as { code?: string } | null)?.code;
    if (code === "ACCOUNT_HELD" || code === "PASSWORD_CHANGE_REQUIRED") onAccountBlocked?.();
    throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?token=${encodeURIComponent(getToken())}`;
}

export const tradesCsvUrl = () => `${BASE}/trades.csv`;
