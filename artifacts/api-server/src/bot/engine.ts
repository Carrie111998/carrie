import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { applyPatch, defaultSettings, SETTINGS_VERSION, withoutBrain, type BotSettings } from "./settings";
import { loadBrain, brainSettings, markBrainFix, resetBrainHistory, onBrainChange, setLastTuneTrades, updateBrain } from "./brain";
import { DATA_DIR, workspaceRoot } from "./paths";
import { BAW_BIN } from "../prediction";

export { DATA_DIR, workspaceRoot };

export interface Credentials {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

export interface LogEntry {
  time: number;
  level: string;
  message: string;
}

const BOT_SCRIPT = path.join(workspaceRoot, "artifacts/api-server/src/bot/binance_bot.py");
const COLLECTIVE_SCRIPT = path.join(workspaceRoot, "artifacts/api-server/src/bot/collective.py");
export const GLOBAL_DIR = path.join(DATA_DIR, "global");

/** Settings the community's pooled trades recommend (indicator weights, confidence, filters). */
function communityRecommended(): Partial<BotSettings> {
  return readJson<{ recommended?: Partial<BotSettings> }>(path.join(GLOBAL_DIR, "collective.json"))?.recommended ?? {};
}

/** Coins, slot time and practice mode copied from the admin to every user (once, v3.0.6). */
const SYNC_KEYS = ["symbols", "interval", "paperMode", "predictionSymbol"] as const;

function syncUsersToAdmin(adminIds: string[]) {
  const b = loadBrain();
  if (b.fixes?.includes("sync-users-v306")) return;
  const admin = adminIds.map((id) => readJson<Record<string, unknown>>(path.join(userDataDir(id), "settings.json"))).find(Boolean);
  if (admin) {
    const patch = Object.fromEntries(SYNC_KEYS.filter((k) => admin[k] !== undefined).map((k) => [k, admin[k]]));
    const usersDir = path.join(DATA_DIR, "users");
    for (const id of existsSync(usersDir) ? readdirSync(usersDir) : []) {
      if (adminIds.includes(id)) continue;
      const file = path.join(userDataDir(id), "settings.json");
      const saved = readJson<Record<string, unknown>>(file);
      if (!saved) continue;
      writeJson(file, applyPatch(applyPatch(defaultSettings(), saved), patch));
    }
    logger.info({ patch }, "Copied the admin's coins, slot time and practice mode to every user");
  }
  markBrainFix("sync-users-v306");
}

/**
 * One-time fresh start (v3.1.2, admin's request): delete every user's practice trades, practice
 * balance, learning data and slot history, plus the pooled community dataset. Accounts, settings,
 * API keys, wallet sessions and anything involving real money (live trades, open live positions,
 * unsettled real bets) are kept.
 */
function freshStart() {
  const b = loadBrain();
  if (b.fixes?.includes("fresh-start-v312")) return;
  const usersDir = path.join(DATA_DIR, "users");
  let users = 0;
  for (const id of existsSync(usersDir) ? readdirSync(usersDir) : []) {
    const file = path.join(userDataDir(id), "bot_data.json");
    const d = readJson<Record<string, any>>(file);
    if (!d) continue;
    writeJson(file, {
      positions: (d.positions ?? []).filter((p: any) => p.mode === "live"),
      trades: (d.trades ?? []).filter((t: any) => t.mode === "live"),
      predictionBets: (d.predictionBets ?? []).filter((x: any) => x.status === "placed" && x.result == null),
      liveDaily: d.liveDaily ?? {},
    });
    users++;
  }
  rmSync(path.join(GLOBAL_DIR, "collective.json"), { force: true });
  resetBrainHistory();
  markBrainFix("fresh-start-v312");
  logger.info({ users }, "Fresh start: deleted old practice trades, learning data and community dataset");
}

/** Create the shared brain from the first admin's settings (only the first time). */
export function initBrain(adminIds: string[]) {
  loadBrain(() => {
    for (const id of adminIds) {
      const saved = readJson<Record<string, unknown>>(path.join(userDataDir(id), "settings.json"));
      if (saved) return applyPatch(defaultSettings(), saved);
    }
    return applyPatch(defaultSettings(), communityRecommended());
  });
  syncUsersToAdmin(adminIds);
  freshStart();
}

/**
 * Rebuild the anonymous dataset from every user's trades, then (if auto-tune is on)
 * tune the shared brain once enough new trades have settled.
 */
export function runCollective(force = false): Promise<{ applied: number; trades: number; message: string }> {
  return new Promise((resolve) => {
    execFile(process.env["PYTHON"] ?? "python3", [COLLECTIVE_SCRIPT, DATA_DIR], { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        logger.warn({ err: String(err), stderr: stderr?.slice(0, 500) }, "Community learning update failed");
        resolve({ applied: 0, trades: 0, message: "Learning update failed" });
        return;
      }
      let result: unknown = stdout.trim().slice(0, 300);
      try {
        result = JSON.parse(stdout.trim().split("\n").pop() ?? "{}"); // includes the trade analysis
      } catch {
        /* keep the raw text */
      }
      logger.info({ result }, "Community learning updated");
      const col = readJson<{ recommended?: Partial<BotSettings>; changes?: { param: string; from: unknown; to: unknown; reason?: string }[]; summary?: { trades?: number } }>(
        path.join(GLOBAL_DIR, "collective.json"),
      );
      const b = loadBrain();
      const trades = col?.summary?.trades ?? 0;
      const due = force || (b.settings.autoTune && trades - b.lastTuneTrades >= (b.settings.autoTuneEvery ?? 5));
      const rec = col?.recommended ?? {};
      if (!due) {
        resolve({ applied: 0, trades, message: b.settings.autoTune ? "Waiting for more settled trades" : "Auto-tune is off" });
        return;
      }
      setLastTuneTrades(trades);
      if (Object.keys(rec).length === 0) {
        resolve({ applied: 0, trades, message: trades < 15 ? "Need at least 15 settled trades from all users" : "No changes needed" });
        return;
      }
      updateBrain(rec, "auto-tune", undefined, col?.changes ?? []);
      const n = col?.changes?.length ?? Object.keys(rec).length;
      logger.info({ trades, changes: n }, "Auto-tune updated the shared brain");
      resolve({ applied: n, trades, message: `Applied ${n} change(s) from ${trades} trades` });
    });
  });
}

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch (err) {
    logger.warn({ err, file }, "Could not read JSON file");
    return null;
  }
}

function writeJson(file: string, data: unknown, secret = false) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: secret ? 0o600 : 0o644 });
  renameSync(tmp, file);
  if (secret) chmodSync(file, 0o600);
}

type Listener = (type: string, data: unknown) => void;

/** One user's bot: owns a Python engine process, that user's settings and API credentials. */
export class Engine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private listeners = new Set<Listener>();
  private pending = new Map<string, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }>();
  private restartTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly settingsFile: string;
  private readonly credentialsFile: string;
  private readonly runtimeFile: string;

  settings: BotSettings;
  private credentials: Credentials | null;
  state: Record<string, unknown> | null = null;
  logs: LogEntry[] = [];

  constructor(readonly userId: string, readonly dataDir: string) {
    this.settingsFile = path.join(dataDir, "settings.json");
    this.credentialsFile = path.join(dataDir, "credentials.json");
    this.runtimeFile = path.join(dataDir, "runtime.json");
    const saved = readJson<Record<string, unknown>>(this.settingsFile);
    if (!saved) {
      // new account: start from what the community's trades have taught the bot so far
      this.settings = applyPatch(defaultSettings(), communityRecommended());
    } else {
      this.settings = applyPatch(defaultSettings(), saved);
      const version = Number(saved["settingsVersion"] ?? 1);
      if (version < SETTINGS_VERSION) {
        // v2 defaults for everyone: fixed 1.50 bets (only replaces the old 1.00 default),
        // dummy Binance Prediction paper trading, community learning on
        const upgrade: Partial<BotSettings> = { paperMode: "prediction", useCommunityLearning: true };
        if (version < 2 && Number(saved["paperTradeAmountUsdt"] ?? 1) <= 1) upgrade.paperTradeAmountUsdt = 1.5;
        if (version < 2 && Number(saved["predictionBetUsdt"] ?? 1) <= 1) upgrade.predictionBetUsdt = 1.5;
        this.settings = applyPatch(this.settings, upgrade);
        // v3: BTC/ETH/BNB only at 5m/15m/1h (applyPatch already normalised), run until stopped
        this.settings.runDurationMin = Number(saved["runDurationMin"] ?? 0) || 0;
        logger.info({ userId, from: version, to: SETTINGS_VERSION }, "Upgraded user settings");
      }
    }
    this.settings.settingsVersion = SETTINGS_VERSION;
    writeJson(this.settingsFile, this.settings);
    this.credentials = readJson<Credentials>(this.credentialsFile);
  }

  /** What this user's bot runs with: their basic setup + the shared brain. */
  effectiveSettings(): BotSettings {
    return { ...this.settings, ...brainSettings() } as BotSettings;
  }

  /** Per-user auto-tune is off: the shared brain is tuned centrally from everyone's trades. */
  private engineSettings(): BotSettings {
    return { ...this.effectiveSettings(), autoTune: false, useCommunityLearning: true };
  }

  pushSettings() {
    try {
      this.send({ cmd: "settings", settings: this.engineSettings() });
    } catch {
      /* engine restarting — it gets settings on init */
    }
    this.broadcast("settings", this.effectiveSettings());
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(type: string, data: unknown) {
    for (const fn of this.listeners) {
      try {
        fn(type, data);
      } catch {
        /* ignore broken listener */
      }
    }
  }

  /** Was the bot running before the server restarted? */
  get wasRunning() {
    return readJson<{ running: boolean }>(this.runtimeFile)?.running === true;
  }

  /** Was live betting on before the server restarted? Saved whenever the engine reports a change. */
  get wasLive() {
    const rt = readJson<{ running?: boolean; live?: boolean }>(this.runtimeFile);
    return rt?.running === true && rt.live === true;
  }

  // while live betting is being restored after a restart, the engine's first "live off" state must not
  // overwrite the saved choice
  private restoringLive = false;
  private savedLive: boolean | null = null;

  private saveLive(live: boolean) {
    if (this.restoringLive || this.savedLive === live) return;
    this.savedLive = live;
    const rt = readJson<Record<string, unknown>>(this.runtimeFile) ?? {};
    writeJson(this.runtimeFile, { ...rt, live });
  }

  /** Switch live betting back on after a server restart or deploy, as the user left it. */
  async restoreLive() {
    this.restoringLive = true;
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const r = await this.request<{ ok?: boolean; error?: string }>({ cmd: "live", enabled: true }, 60_000);
          if (r?.ok !== false) {
            logger.info({ userId: this.userId }, "Live betting restored after server restart");
            return;
          }
          logger.warn({ userId: this.userId, error: r.error, attempt }, "Could not restore live betting");
        } catch (err) {
          logger.warn({ userId: this.userId, err: String(err), attempt }, "Could not restore live betting");
        }
        await new Promise((res) => setTimeout(res, 30_000));
      }
    } finally {
      this.restoringLive = false;
    }
  }

  start() {
    if (this.proc) return;
    logger.info({ userId: this.userId, dataDir: this.dataDir }, "Starting Python bot engine");
    const proc = spawn(process.env["PYTHON"] ?? "python3", [BOT_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      // each user's Binance Agentic Wallet session lives in their own data folder
      env: { ...process.env, BAW_BIN, BINANCE_BAW_DIR: path.join(this.dataDir, "baw"), BOT_GLOBAL_DIR: GLOBAL_DIR },
    });
    this.proc = proc;
    proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.onEvent(JSON.parse(line));
        } catch {
          logger.debug({ line }, "Non-JSON engine output");
        }
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => logger.warn({ userId: this.userId, stderr: chunk.toString().trim() }, "Engine stderr"));
    proc.on("exit", (code) => {
      this.proc = null;
      // live betting the user switched on survives an engine crash (and a server restart, see resumeEngines)
      const wasLive = Boolean((this.state?.["status"] as Record<string, unknown> | undefined)?.["liveEnabled"]);
      if (this.stopped) return; // shut down on purpose (account deleted)
      logger.error({ userId: this.userId, code }, "Python engine exited — restarting in 3s");
      this.buffer = "";
      if (this.state) (this.state["status"] as Record<string, unknown>)["running"] = false;
      this.broadcast("state", this.publicState());
      this.restartTimer ??= setTimeout(() => {
        this.restartTimer = null;
        this.start();
        if (this.wasRunning) this.send({ cmd: "start" });
        if (wasLive) void this.restoreLive();
      }, 3000);
    });
    this.send({ cmd: "init", dataDir: this.dataDir, settings: this.engineSettings(), credentials: this.credentials ?? {} });
  }

  private send(msg: object) {
    if (!this.proc) throw new Error("Bot engine is not running");
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  /** Send a command and wait for the engine's reply. */
  request<T = unknown>(msg: Record<string, unknown>, timeoutMs = 20000): Promise<T> {
    const reqId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error("Bot engine did not respond in time"));
      }, timeoutMs);
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, timer });
      try {
        this.send({ ...msg, reqId });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(err);
      }
    });
  }

  private stopTimer: NodeJS.Timeout | null = null;
  /** When the current run ends (ms), or null when it runs until stopped. */
  stopAt: number | null = null;

  command(msg: Record<string, unknown>, opts: { stopAt?: number | null } = {}) {
    this.send(msg);
    if (msg["cmd"] === "start") {
      const mins = this.settings.runDurationMin;
      this.stopAt = opts.stopAt !== undefined ? opts.stopAt : mins > 0 ? Date.now() + mins * 60_000 : null;
      this.armStopTimer();
      writeJson(this.runtimeFile, { ...(readJson<Record<string, unknown>>(this.runtimeFile) ?? {}), running: true, stopAt: this.stopAt });
    }
    if (msg["cmd"] === "stop") {
      this.stopAt = null;
      this.armStopTimer();
      writeJson(this.runtimeFile, { running: false, stopAt: null, live: false });
      this.savedLive = false;
    }
    this.broadcast("state", this.publicState());
  }

  private armStopTimer() {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.stopAt == null) return;
    // setTimeout can't wait longer than ~24 days; runs are at most 12 h
    this.stopTimer = setTimeout(() => {
      logger.info({ userId: this.userId }, "Run time finished — stopping bot");
      try {
        this.command({ cmd: "live", enabled: false });
        this.command({ cmd: "stop" });
      } catch {
        /* engine down */
      }
    }, Math.max(0, this.stopAt - Date.now()));
  }

  get savedStopAt(): number | null {
    return readJson<{ stopAt?: number | null }>(this.runtimeFile)?.stopAt ?? null;
  }

  private onEvent(ev: { type: string; data: unknown; reqId?: string }) {
    switch (ev.type) {
      case "state": {
        const s = ev.data as Record<string, unknown>;
        delete s["settings"]; // Node owns settings
        this.state = s;
        const status = s["status"] as Record<string, unknown> | undefined;
        if (status && typeof status["liveEnabled"] === "boolean") this.saveLive(status["liveEnabled"]);
        this.broadcast("state", this.publicState());
        break;
      }
      case "response": {
        const p = ev.reqId ? this.pending.get(ev.reqId) : undefined;
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(ev.reqId!);
          p.resolve(ev.data);
        }
        break;
      }
      case "settings_tuned":
        // only the shared brain is tuned (centrally); ignore per-user tuning
        break;
      case "log": {
        const entry = ev.data as LogEntry;
        // trades, tuning and errors also go to the server log for troubleshooting (Hostinger → Docker logs)
        logger.info({ userId: this.userId, level: entry.level, message: entry.message }, "bot");
        this.logs.unshift(entry);
        this.logs.length = Math.min(this.logs.length, 200);
        this.broadcast("log", entry);
        break;
      }
      case "trade_closed":
        this.broadcast("trade_closed", ev.data);
        break;
      case "ready":
        logger.info({ userId: this.userId, data: ev.data }, "Python engine ready");
        break;
    }
  }

  /** Stop the engine for good (account deleted). */
  shutdown() {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.proc?.kill();
    this.proc = null;
  }

  publicState() {
    return { ...(this.state ?? {}), engineOnline: this.proc !== null, stopAt: this.stopAt, logs: this.logs.slice(0, 60) };
  }

  updateSettings(patch: unknown) {
    this.settings = applyPatch(this.settings, withoutBrain(patch));
    writeJson(this.settingsFile, this.settings);
    this.pushSettings();
    return this.effectiveSettings();
  }

  /** Back to the default amounts and limits — how the user connects to Binance is kept. */
  resetSettings() {
    const { liveVenue, predictionAuth, predictionFunding, settingsVersion } = this.settings;
    this.settings = { ...defaultSettings(), liveVenue, predictionAuth, predictionFunding, settingsVersion };
    return this.updateSettings({});
  }

  credentialInfo() {
    const c = this.credentials;
    if (!c?.apiKey) return { hasCredentials: false, keyPreview: null, testnet: c?.testnet ?? true };
    return { hasCredentials: true, keyPreview: `${c.apiKey.slice(0, 4)}…${c.apiKey.slice(-4)}`, testnet: c.testnet };
  }

  setCredentials(c: Credentials | null) {
    this.credentials = c;
    writeJson(this.credentialsFile, c ?? {}, true);
    this.send({ cmd: "credentials", credentials: c ?? {} });
  }
}

// ─── One engine per user ─────────────────────────────────────────────────────

const engines = new Map<string, Engine>();
onBrainChange(() => engines.forEach((e) => e.pushSettings()));
const LEGACY_FILES = ["bot_data.json", "settings.json", "credentials.json"];

export const userDataDir = (userId: string) => path.join(DATA_DIR, "users", userId);

export function getEngine(userId: string): Engine {
  let e = engines.get(userId);
  if (!e) {
    const dir = userDataDir(userId);
    // Data from the single-user version (data/*.json) is handed to the first account created.
    const usersDir = path.join(DATA_DIR, "users");
    const firstAccount = !existsSync(usersDir) || readdirSync(usersDir).length === 0;
    if (firstAccount && LEGACY_FILES.some((f) => existsSync(path.join(DATA_DIR, f)))) {
      mkdirSync(dir, { recursive: true });
      for (const f of LEGACY_FILES) {
        if (existsSync(path.join(DATA_DIR, f))) renameSync(path.join(DATA_DIR, f), path.join(dir, f));
      }
      logger.info({ userId }, "Moved single-user bot data into the first account");
    }
    mkdirSync(dir, { recursive: true });
    e = new Engine(userId, dir);
    engines.set(userId, e);
    e.start();
  }
  return e;
}

export const peekEngine = (userId: string) => engines.get(userId);

/** Stop a user's bot process; optionally delete all their data (trades, keys, wallet session). */
export function removeEngine(userId: string, deleteData: boolean) {
  engines.get(userId)?.shutdown();
  engines.delete(userId);
  if (deleteData) rmSync(userDataDir(userId), { recursive: true, force: true });
}

/** On server boot, resume bots that were running — with live betting back on if the user had it on. */
export function resumeEngines(userIds: string[]) {
  for (const id of userIds) {
    const dir = userDataDir(id);
    if (!existsSync(path.join(dir, "runtime.json"))) continue;
    const e = getEngine(id);
    if (!e.wasRunning) continue;
    const stopAt = e.savedStopAt;
    if (stopAt != null && stopAt <= Date.now()) {
      e.command({ cmd: "stop" }); // run time ended while the server was down
      continue;
    }
    const live = e.wasLive;
    e.command({ cmd: "start" }, { stopAt });
    if (live) void e.restoreLive();
  }
}
