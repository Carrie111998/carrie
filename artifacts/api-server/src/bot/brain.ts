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
  return brain;
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
