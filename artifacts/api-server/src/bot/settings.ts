// Bot settings: defaults, validation and the list of indicators.
// Must stay in sync with DEFAULT_SETTINGS in binance_bot.py.

export const INDICATOR_KEYS = [
  "rsi", "macd", "bollinger", "ema", "stochastic", "adx", "cci", "williams", "mfi",
  "obv", "vwap", "supertrend", "ichimoku", "momentum", "linreg", "candles", "volume", "flow", "trend", "ai",
] as const;

export const INTERVALS = ["5m"] as const; // v3.3.3: 5-minute rounds only
/** Coins with Binance Prediction markets the bot trades. */
export const COINS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"] as const;
/** How long a started bot keeps running (minutes); 0 = until stopped. */
export const RUN_DURATIONS = [0, 15, 30, 60, 180, 360, 720] as const;

export interface IndicatorConfig {
  enabled: boolean;
  weight: number;
}

export interface BotSettings {
  symbols: string[];
  interval: (typeof INTERVALS)[number];
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
  /** how Prediction bets reach Binance: Agentic Wallet (QR) or the Prediction Trading API (API key) */
  predictionAuth: "wallet" | "apikey";
  /** API key mode: pay bets from the Prediction wallet (MPC) or the Binance Spot balance (CEX) */
  predictionFunding: "MPC" | "CEX";
  predictionSymbol: string;
  predictionQuery: string;
  predictionBetUsdt: number;
  predictionMaxExposureUsdt: number;
  predictionDryRun: boolean;
  predictionAutoRedeem: boolean;
  useCommunityLearning: boolean;
  runDurationMin: number;
  /** only bet when a winning bet pays at least this many times the stake (e.g. 1.65×) */
  minPayout: number;
  /** only bet when confidence beats the share price by this much (0.05 = 5 points) */
  minEdge: number;
  /** schema version of this settings file; bumped when defaults change for everyone */
  settingsVersion: number;
}

export const SETTINGS_VERSION = 3;

/**
 * "One brain": these strategy settings are shared by every user and only the admin
 * (or auto-tune, learning from everyone's trades) changes them. Everything else is
 * each user's own basic setup (coins, slot time, amounts, limits, paper/live).
 */
export const BRAIN_KEYS = [
  "scanIntervalSec", "predictionHorizon", "minConfidence", "maxOpenPositions", "paperPredictionPrice", "minPayout", "minEdge",
  "allowShort", "slAtrMult", "tpAtrMult", "maxHoldCandles", "minAdx", "feePct", "indicators", "indicatorParams",
  "autoTune", "autoTuneEvery", "tuneWeights", "tuneThreshold", "tuneRisk", "tuneFilters", "blockedSymbols", "blockedHours",
] as const satisfies readonly (keyof BotSettings)[];

export function pickBrain(s: BotSettings): Partial<BotSettings> {
  return Object.fromEntries(BRAIN_KEYS.map((k) => [k, structuredClone(s[k])])) as Partial<BotSettings>;
}

export function withoutBrain(patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== "object") return {};
  const out = { ...(patch as Record<string, unknown>) };
  for (const k of BRAIN_KEYS) delete out[k];
  return out;
}

export function defaultSettings(): BotSettings {
  return {
    symbols: ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
    interval: "5m",
    scanIntervalSec: 30,
    predictionHorizon: 3,
    minConfidence: 62,
    maxOpenPositions: 5,
    paperStartBalance: 100,
    paperTradeMode: "fixed",
    paperTradeAmountUsdt: 1.5,
    paperTradeSizePct: 5,
    paperMode: "prediction",
    paperPredictionPrice: 0.5,
    allowShort: true,
    slAtrMult: 1.5,
    tpAtrMult: 2.0,
    maxHoldCandles: 12,
    minAdx: 0,
    feePct: 0.1,
    indicators: Object.fromEntries(INDICATOR_KEYS.map((k) => [k, { enabled: true, weight: 1 }])),
    indicatorParams: {
      rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
      macdFast: 12, macdSlow: 26, macdSignal: 9,
      bbPeriod: 20, bbStd: 2, emaFast: 9, emaSlow: 21,
      stochPeriod: 14, adxPeriod: 14, atrPeriod: 14,
    },
    autoTune: true,
    autoTuneEvery: 5,
    tuneWeights: true,
    tuneThreshold: true,
    tuneRisk: true,
    tuneFilters: true,
    blockedSymbols: [],
    blockedHours: [],
    liveTradeAmountUsdt: 5,
    liveMaxOpenPositions: 3,
    liveDailyLossLimitUsdt: 50,
    liveVenue: "prediction",
    predictionAuth: "wallet",
    predictionFunding: "MPC",
    predictionSymbol: "BTCUSDT",
    predictionQuery: "BTC",
    predictionBetUsdt: 1.5,
    predictionMaxExposureUsdt: 20,
    predictionDryRun: true,
    predictionAutoRedeem: true,
    useCommunityLearning: true,
    runDurationMin: 0,
    minPayout: 1.4,
    minEdge: 0.05,
    settingsVersion: SETTINGS_VERSION,
  };
}

// [min, max] for every numeric setting
const BOUNDS: Record<string, [number, number]> = {
  scanIntervalSec: [10, 3600],
  predictionHorizon: [1, 50],
  minConfidence: [50, 95],
  maxOpenPositions: [1, 30],
  paperStartBalance: [100, 10_000_000],
  paperTradeAmountUsdt: [1, 1_000_000],
  paperTradeSizePct: [0.5, 100],
  paperPredictionPrice: [0.05, 0.95],
  slAtrMult: [0.3, 10],
  tpAtrMult: [0.3, 20],
  maxHoldCandles: [1, 500],
  minAdx: [0, 60],
  feePct: [0, 1],
  autoTuneEvery: [1, 200],
  liveTradeAmountUsdt: [1, 100_000],
  liveMaxOpenPositions: [1, 20],
  liveDailyLossLimitUsdt: [1, 1_000_000],
  predictionBetUsdt: [1, 100_000],
  predictionMaxExposureUsdt: [1, 1_000_000],
  minPayout: [1.05, 10],
  minEdge: [0, 0.5],
};

const PARAM_BOUNDS: Record<string, [number, number]> = {
  rsiPeriod: [2, 100], rsiOversold: [5, 50], rsiOverbought: [50, 95],
  macdFast: [2, 100], macdSlow: [3, 200], macdSignal: [2, 100],
  bbPeriod: [5, 100], bbStd: [0.5, 5], emaFast: [2, 100], emaSlow: [3, 300],
  stochPeriod: [3, 100], adxPeriod: [3, 100], atrPeriod: [3, 100],
};

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
const INT_KEYS = new Set(["scanIntervalSec", "predictionHorizon", "maxOpenPositions", "maxHoldCandles", "autoTuneEvery", "liveMaxOpenPositions"]);
const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

/** Merge an untrusted patch into current settings, dropping anything invalid. */
export function applyPatch(current: BotSettings, patch: unknown): BotSettings {
  const next: BotSettings = structuredClone(current);
  if (!patch || typeof patch !== "object") return next;
  const p = patch as Record<string, unknown>;
  const n = next as unknown as Record<string, unknown>;

  for (const [key, range] of Object.entries(BOUNDS)) {
    const v = Number(p[key]);
    if (p[key] !== undefined && Number.isFinite(v)) {
      n[key] = INT_KEYS.has(key) ? Math.round(clamp(v, range)) : clamp(v, range);
    }
  }
  for (const key of ["allowShort", "autoTune", "tuneWeights", "tuneThreshold", "tuneRisk", "tuneFilters", "predictionDryRun", "predictionAutoRedeem", "useCommunityLearning"]) {
    if (typeof p[key] === "boolean") n[key] = p[key];
  }
  if (p.paperTradeMode === "fixed" || p.paperTradeMode === "percent") next.paperTradeMode = p.paperTradeMode;
  if (p.liveVenue === "prediction" || p.liveVenue === "spot") next.liveVenue = p.liveVenue;
  if (p.predictionAuth === "wallet" || p.predictionAuth === "apikey") next.predictionAuth = p.predictionAuth;
  if (p.predictionFunding === "MPC" || p.predictionFunding === "CEX") next.predictionFunding = p.predictionFunding;
  if (p.paperMode === "prediction" || p.paperMode === "spot") next.paperMode = p.paperMode;
  // Fixed bet size only: never scale bets with balance or after losses.
  next.paperTradeMode = "fixed";
  if (typeof p.predictionSymbol === "string" && SYMBOL_RE.test(p.predictionSymbol.trim().toUpperCase())) {
    next.predictionSymbol = p.predictionSymbol.trim().toUpperCase();
  }
  if (typeof p.predictionQuery === "string" && p.predictionQuery.trim()) next.predictionQuery = p.predictionQuery.trim().slice(0, 200);
  if (typeof p.interval === "string" && (INTERVALS as readonly string[]).includes(p.interval)) {
    next.interval = p.interval as BotSettings["interval"];
  }
  const symbolList = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.map((s) => String(s).trim().toUpperCase()).filter((s) => SYMBOL_RE.test(s)))]
      : null;
  const symbols = symbolList(p.symbols)?.filter((x) => (COINS as readonly string[]).includes(x));
  if (symbols && symbols.length > 0) next.symbols = symbols;
  const dur = Number(p.runDurationMin);
  if (p.runDurationMin !== undefined && (RUN_DURATIONS as readonly number[]).includes(dur)) next.runDurationMin = dur;
  const blocked = symbolList(p.blockedSymbols);
  if (blocked) next.blockedSymbols = blocked;
  if (Array.isArray(p.blockedHours)) {
    next.blockedHours = [...new Set(p.blockedHours.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b);
  }
  if (p.indicators && typeof p.indicators === "object") {
    for (const [k, cfg] of Object.entries(p.indicators as Record<string, unknown>)) {
      if (!(INDICATOR_KEYS as readonly string[]).includes(k) || !cfg || typeof cfg !== "object") continue;
      const c = cfg as Record<string, unknown>;
      const cur = next.indicators[k] ?? { enabled: true, weight: 1 };
      if (typeof c.enabled === "boolean") cur.enabled = c.enabled;
      const w = Number(c.weight);
      if (c.weight !== undefined && Number.isFinite(w)) cur.weight = Math.round(clamp(w, [0, 5]) * 100) / 100;
      next.indicators[k] = cur;
    }
  }
  if (p.indicatorParams && typeof p.indicatorParams === "object") {
    for (const [k, v] of Object.entries(p.indicatorParams as Record<string, unknown>)) {
      const range = PARAM_BOUNDS[k];
      const num = Number(v);
      if (range && Number.isFinite(num)) next.indicatorParams[k] = k === "bbStd" ? clamp(num, range) : Math.round(clamp(num, range));
    }
  }
  // only BTC / ETH / BNB, at 5m / 15m slots
  next.symbols = next.symbols.filter((x) => (COINS as readonly string[]).includes(x));
  if (next.symbols.length === 0) next.symbols = ["BTCUSDT"];
  if (!(INTERVALS as readonly string[]).includes(next.interval)) next.interval = "5m";
  if (!next.symbols.includes(next.predictionSymbol)) next.predictionSymbol = next.symbols[0]!;
  next.predictionQuery = next.predictionSymbol.replace("USDT", "");
  return next;
}
