// The one shared "brain": strategy settings every user's bot runs with.
// Only the admin edits it; auto-tune updates it from all users' pooled trades.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { logger } from "../lib/logger";
import { applyPatch, defaultSettings, pickBrain, type BotSettings } from "./settings";
import { DATA_DIR } from "./paths";

export interface TuneEntry {
  time: number;
  source: "admin" | "auto-tune";
  by?: string;
  changes: { param: string; from: unknown; to: unknown; reason?: string }[];
}

interface BrainFile {
  settings: Partial<BotSettings>;
  updatedAt: number;
  updatedBy: string;
  /** pooled trade count at the last auto-tune, so it only re-tunes on new evidence */
  lastTuneTrades: number;
  log: TuneEntry[];
  /** one-time repairs already applied */
  fixes?: string[];
  /** auto-tune only learns from trades opened after this (older ones came from the Up-biased bot) */
  tuneSince?: number;
}

const FILE = path.join(DATA_DIR, "global", "brain.json");
let brain: BrainFile | null = null;
const listeners = new Set<() => void>();

function save() {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(brain, null, 2));
  renameSync(`${FILE}.tmp`, FILE);
}

/** Load the brain, creating it from `seed` (the admin's old settings) the first time. */
export function loadBrain(seed?: () => BotSettings | null): BrainFile {
  if (brain) return brain;
  try {
    if (existsSync(FILE)) brain = JSON.parse(readFileSync(FILE, "utf8")) as BrainFile;
  } catch (err) {
    logger.warn({ err }, "Could not read brain.json — recreating");
  }
  if (!brain) {
    const base = seed?.() ?? defaultSettings();
    brain = { settings: pickBrain(base), updatedAt: Date.now(), updatedBy: "setup", lastTuneTrades: 0, log: [] };
    save();
    logger.info("Created the shared bot brain");
  }
  // validate through the normal settings rules
  brain.settings = pickBrain(applyPatch(defaultSettings(), brain.settings));
  // v3.0.1: old auto-tune could switch Down bets off for good (bot then bet Up only) — turn them back on once
  brain.fixes ??= [];
  if (!brain.fixes.includes("allow-down-bets")) {
    brain.fixes.push("allow-down-bets");
    if (brain.settings.allowShort === false) {
      brain.settings.allowShort = true;
      brain.log.unshift({
        time: Date.now(), source: "admin", by: "v3.0.1 update",
        changes: [{ param: "allowShort", from: "false", to: "true", reason: "Down bets were switched off by old auto-tune and could never come back on" }],
      });
      logger.info("Brain: Down bets switched back on");
    }
    save();
  }
  // v3.0.5: the trades before the direction fixes were all Up bets from a biased bot — tune only on
  // newer trades, and drop the coin/hour blocks auto-tune learned from them
  if (!brain.fixes.includes("fresh-tune-v305")) {
    brain.fixes.push("fresh-tune-v305");
    brain.tuneSince = Date.now();
    const blocked = { symbols: brain.settings.blockedSymbols ?? [], hours: brain.settings.blockedHours ?? [] };
    brain.settings.blockedSymbols = [];
    brain.settings.blockedHours = [];
    brain.lastTuneTrades = 0;
    brain.log.unshift({
      time: Date.now(), source: "admin", by: "v3.0.5 update",
      changes: [
        { param: "blockedSymbols", from: JSON.stringify(blocked.symbols), to: "[]", reason: "learned from old Up-only trades" },
        { param: "blockedHours", from: JSON.stringify(blocked.hours), to: "[]", reason: "learned from old Up-only trades" },
        { param: "tuneSince", from: "all trades", to: new Date(brain.tuneSince).toISOString(), reason: "auto-tune now learns only from new, balanced trades" },
      ],
    });
    save();
  }
  // v3.0.6 (admin's choice): every bet needs at least 60% confidence; auto-tune keeps the
  // threshold there and tunes the rest
  if (!brain.fixes.includes("min-confidence-60")) {
    brain.fixes.push("min-confidence-60");
    const from = brain.settings.minConfidence;
    brain.settings.minConfidence = 60;
    brain.settings.tuneThreshold = false;
    brain.log.unshift({
      time: Date.now(), source: "admin", by: "v3.0.6 update",
      changes: [
        { param: "minConfidence", from: String(from), to: "60", reason: "admin: bet at 60% confidence or more" },
        { param: "tuneThreshold", from: "true", to: "false", reason: "keep the 60% minimum fixed" },
      ],
    });
    save();
  }
  // v3.0.7: weights from the analysis of all settled trades (5-minute slots reward "snap-back"
  // indicators and punish trend followers). Auto-tune keeps refining them from new trades.
  if (!brain.fixes.includes("weights-v307")) {
    brain.fixes.push("weights-v307");
    const w: Record<string, number> = {
      bollinger: 1.8, stochastic: 1.6, williams: 1.4, ai: 1.4, supertrend: 1.2, rsi: 1.0, candles: 1.0, mfi: 1.0,
      adx: 0.8, volume: 0.8, ichimoku: 0.7, ema: 0.6, linreg: 0.6, vwap: 0.6, macd: 0.5, momentum: 0.5, cci: 0.5, obv: 0.3, trend: 0.5,
    };
    const inds = (brain.settings.indicators ?? {}) as Record<string, { enabled: boolean; weight: number }>;
    const changes: TuneEntry["changes"] = [];
    for (const [k, v] of Object.entries(w)) {
      const cur = inds[k] ?? { enabled: true, weight: 1 };
      if (cur.weight !== v) changes.push({ param: `weight.${k}`, from: String(cur.weight), to: String(v), reason: "trade analysis v3.0.7" });
      inds[k] = { ...cur, enabled: true, weight: v };
    }
    brain.settings.indicators = inds as BotSettings["indicators"];
    brain.log.unshift({ time: Date.now(), source: "admin", by: "v3.0.7 trade analysis", changes });
    save();
  }
  // v3.1.0 (research): honest confidence scale (50 = coin flip), new order-flow indicator, and an
  // edge rule — bet only when the win estimate beats the share price by 5 points
  if (!brain.fixes.includes("edge-v310")) {
    brain.fixes.push("edge-v310");
    const inds = (brain.settings.indicators ?? {}) as Record<string, { enabled: boolean; weight: number }>;
    inds["flow"] = { enabled: true, weight: 1.5 };
    brain.settings.indicators = inds as BotSettings["indicators"];
    brain.settings.minConfidence = 60;
    brain.settings.minEdge = 0.05;
    brain.settings.minPayout = brain.settings.minPayout ?? 1.65;
    brain.log.unshift({
      time: Date.now(), source: "admin", by: "v3.1.0 research update",
      changes: [
        { param: "weight.flow", from: "-", to: "1.5", reason: "new order-flow indicator (taker buy/sell imbalance)" },
        { param: "minConfidence", from: "-", to: "60", reason: "confidence now 50 = coin flip, so 60 = a real lean" },
        { param: "minEdge", from: "-", to: "0.05", reason: "bet only when the win estimate beats the share price by 5 points" },
      ],
    });
    save();
  }
  // v3.1.1: hour blocks were learned from too few (double-counted) bets — clear them; auto-tune now
  // needs 30+ distinct bets to block an hour and never blocks coins
  if (!brain.fixes.includes("unblock-v311")) {
    brain.fixes.push("unblock-v311");
    const was = { hours: brain.settings.blockedHours ?? [], coins: brain.settings.blockedSymbols ?? [] };
    brain.settings.blockedHours = [];
    brain.settings.blockedSymbols = [];
    brain.log.unshift({
      time: Date.now(), source: "admin", by: "v3.1.1 update",
      changes: [
        { param: "blockedHours", from: JSON.stringify(was.hours), to: "[]", reason: "blocked on too few bets (each bet was counted once per user)" },
        { param: "blockedSymbols", from: JSON.stringify(was.coins), to: "[]", reason: "coins are no longer blocked automatically" },
      ],
    });
    save();
  }
  // v3.1.3 (admin's choice): 60% minimum confidence fixed (auto-tune had pushed it to 84% on ~50
  // bets, so nothing was bet) and Down bets back on
  if (!brain.fixes.includes("settings-v313")) {
    brain.fixes.push("settings-v313");
    const was = { conf: brain.settings.minConfidence, tune: brain.settings.tuneThreshold, down: brain.settings.allowShort };
    brain.settings.minConfidence = 60;
    brain.settings.tuneThreshold = false;
    brain.settings.allowShort = true;
    brain.log.unshift({
      time: Date.now(), source: "admin", by: "v3.1.3 update",
      changes: [
        { param: "minConfidence", from: String(was.conf), to: "60", reason: "admin: bet at 60%+ (84% blocked every bet)" },
        { param: "tuneThreshold", from: String(was.tune), to: "false", reason: "keep the minimum fixed until there is much more data" },
        { param: "allowShort", from: String(was.down), to: "true", reason: "admin: bet both Up and Down" },
      ],
    });
    save();
  }
  // v3.3.1 (admin's choice): bet when a win pays +0.40 or more per 1 USDT (1.40x), 60% confidence fixed
  // (auto-tune had raised it to 82%, so no bet was placed)
  if (!brain.fixes.includes("settings-v331")) {
    brain.fixes.push("settings-v331");
    const was = { conf: brain.settings.minConfidence, tune: brain.settings.tuneThreshold, pay: brain.settings.minPayout };
    brain.settings.minConfidence = 60;
    brain.settings.tuneThreshold = false;
    brain.settings.minPayout = 1.4;
    brain.log.unshift({
      time: Date.now(), source: "admin", by: "v3.3.1 update",
      changes: [
        { param: "minPayout", from: String(was.pay), to: "1.4", reason: "admin: bet when the win is +0.40 or more" },
        { param: "minConfidence", from: String(was.conf), to: "60", reason: "admin: bet at 60%+ (auto-tune had raised it to 82%)" },
        { param: "tuneThreshold", from: String(was.tune), to: "false", reason: "keep the 60% minimum fixed" },
      ],
    });
    save();
  }
  return brain;
}

/** Fresh start: clear the change log and tune only on trades from now on (settings are kept). */
export function resetBrainHistory() {
  const b = loadBrain();
  b.log = [{ time: Date.now(), source: "admin", by: "fresh start", changes: [{ param: "data", from: "old trades", to: "deleted", reason: "admin: start from new" }] }];
  b.tuneSince = Date.now();
  b.lastTuneTrades = 0;
  save();
}

/** Record a one-time repair as done. */
export function markBrainFix(name: string) {
  const b = loadBrain();
  b.fixes ??= [];
  if (!b.fixes.includes(name)) b.fixes.push(name);
  save();
}

export const brainSettings = (): Partial<BotSettings> => loadBrain().settings;

export function onBrainChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function flat(s: Partial<BotSettings>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "indicators") for (const [ik, c] of Object.entries(v as Record<string, { enabled: boolean; weight: number }>)) {
      out[`${ik}.enabled`] = c.enabled;
      out[`${ik}.weight`] = c.weight;
    }
    else if (k === "indicatorParams") for (const [ik, p] of Object.entries(v as Record<string, number>)) out[`param.${ik}`] = p;
    else out[k] = JSON.stringify(v);
  }
  return out;
}

/** Apply a patch to the brain (admin edit or auto-tune) and push it to every bot. */
export function updateBrain(patch: unknown, source: TuneEntry["source"], by?: string, reasons: TuneEntry["changes"] = []) {
  const b = loadBrain();
  const before = b.settings;
  const merged = applyPatch({ ...defaultSettings(), ...before } as BotSettings, patch);
  const after = pickBrain(merged);
  const fa = flat(before), fb = flat(after);
  const changes = reasons.length
    ? reasons
    : Object.keys(fb).filter((k) => fa[k] !== fb[k]).map((k) => ({ param: k, from: fa[k], to: fb[k] }));
  b.settings = after;
  if (changes.length) {
    b.updatedAt = Date.now();
    b.updatedBy = by ?? source;
    b.log.unshift({ time: Date.now(), source, by, changes: changes.slice(0, 50) });
    b.log.length = Math.min(b.log.length, 100);
  }
  save();
  if (changes.length) for (const fn of listeners) fn();
  return b;
}

export function setLastTuneTrades(n: number) {
  loadBrain().lastTuneTrades = n;
  save();
}
