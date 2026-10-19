import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { applyPatch, defaultSettings, SETTINGS_VERSION, type BotSettings } from "./settings";
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

/** Rebuild the anonymous community dataset from every user's trades. */
export function runCollective() {
  execFile(process.env["PYTHON"] ?? "python3", [COLLECTIVE_SCRIPT, DATA_DIR], { timeout: 120_000 }, (err, stdout, stderr) => {
    if (err) logger.warn({ err: String(err), stderr: stderr?.slice(0, 500) }, "Community learning update failed");
    else logger.info({ result: stdout.trim().slice(0, 300) }, "Community learning updated");
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
        if (Number(saved["paperTradeAmountUsdt"] ?? 1) <= 1) upgrade.paperTradeAmountUsdt = 1.5;
        if (Number(saved["predictionBetUsdt"] ?? 1) <= 1) upgrade.predictionBetUsdt = 1.5;
        this.settings = applyPatch(this.settings, upgrade);
        logger.info({ userId, from: version, to: SETTINGS_VERSION }, "Upgraded user settings");
      }
    }
    this.settings.settingsVersion = SETTINGS_VERSION;
    writeJson(this.settingsFile, this.settings);
    this.credentials = readJson<Credentials>(this.credentialsFile);
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
      if (this.stopped) return; // shut down on purpose (account deleted)
      logger.error({ userId: this.userId, code }, "Python engine exited — restarting in 3s");
      this.buffer = "";
      if (this.state) (this.state["status"] as Record<string, unknown>)["running"] = false;
      this.broadcast("state", this.publicState());
      this.restartTimer ??= setTimeout(() => {
        this.restartTimer = null;
        this.start();
        if (this.wasRunning) this.send({ cmd: "start" });
      }, 3000);
    });
    this.send({ cmd: "init", dataDir: this.dataDir, settings: this.settings, credentials: this.credentials ?? {} });
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

  command(msg: Record<string, unknown>) {
    this.send(msg);
    if (msg["cmd"] === "start") writeJson(this.runtimeFile, { running: true });
    if (msg["cmd"] === "stop") writeJson(this.runtimeFile, { running: false });
  }

  private onEvent(ev: { type: string; data: unknown; reqId?: string }) {
    switch (ev.type) {
      case "state": {
        const s = ev.data as Record<string, unknown>;
        delete s["settings"]; // Node owns settings
        this.state = s;
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
        this.settings = applyPatch(this.settings, ev.data);
        writeJson(this.settingsFile, this.settings);
        this.broadcast("settings", this.settings);
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
    this.proc?.kill();
    this.proc = null;
  }

  publicState() {
    return { ...(this.state ?? {}), engineOnline: this.proc !== null, logs: this.logs.slice(0, 60) };
  }

  updateSettings(patch: unknown) {
    this.settings = applyPatch(this.settings, patch);
    writeJson(this.settingsFile, this.settings);
    this.send({ cmd: "settings", settings: this.settings });
    this.broadcast("settings", this.settings);
    return this.settings;
  }

  resetSettings() {
    this.settings = defaultSettings();
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

/** On server boot, resume bots that were running (paper only — live trading always needs a fresh confirmation). */
export function resumeEngines(userIds: string[]) {
  for (const id of userIds) {
    const dir = userDataDir(id);
    if (!existsSync(path.join(dir, "runtime.json"))) continue;
    const e = getEngine(id);
    if (e.wasRunning) e.command({ cmd: "start" });
  }
}
