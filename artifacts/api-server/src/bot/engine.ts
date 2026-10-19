import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { applyPatch, defaultSettings, type BotSettings } from "./settings";

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

export const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

export const DATA_DIR = path.resolve(process.env["BOT_DATA_DIR"] ?? path.join(workspaceRoot, "data"));
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const CREDENTIALS_FILE = path.join(DATA_DIR, "credentials.json");
const BOT_SCRIPT = path.join(workspaceRoot, "artifacts/api-server/src/bot/binance_bot.py");

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch (err) {
    logger.warn({ err, file }, "Could not read JSON file");
    return null;
  }
}

function writeJson(file: string, data: unknown, secret = false) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: secret ? 0o600 : 0o644 });
  renameSync(tmp, file);
  if (secret) chmodSync(file, 0o600);
}

type Listener = (type: string, data: unknown) => void;

/** Owns the Python engine process, settings and API credentials. */
class Engine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private listeners = new Set<Listener>();
  private pending = new Map<string, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }>();
  private restartTimer: NodeJS.Timeout | null = null;

  settings: BotSettings = applyPatch(defaultSettings(), readJson(SETTINGS_FILE) ?? {});
  private credentials: Credentials | null = readJson<Credentials>(CREDENTIALS_FILE);
  state: Record<string, unknown> | null = null;
  logs: LogEntry[] = [];

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

  start() {
    if (this.proc) return;
    logger.info({ script: BOT_SCRIPT, dataDir: DATA_DIR }, "Starting Python bot engine");
    const proc = spawn(process.env["PYTHON"] ?? "python3", [BOT_SCRIPT], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
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
    proc.stderr.on("data", (chunk: Buffer) => logger.warn({ stderr: chunk.toString().trim() }, "Engine stderr"));
    proc.on("exit", (code) => {
      logger.error({ code }, "Python engine exited — restarting in 3s");
      this.proc = null;
      this.buffer = "";
      if (this.state) (this.state["status"] as Record<string, unknown>)["running"] = false;
      this.broadcast("state", this.publicState());
      this.restartTimer ??= setTimeout(() => {
        this.restartTimer = null;
        this.start();
      }, 3000);
    });
    this.send({ cmd: "init", dataDir: DATA_DIR, settings: this.settings, credentials: this.credentials ?? {} });
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
        writeJson(SETTINGS_FILE, this.settings);
        this.broadcast("settings", this.settings);
        break;
      case "log": {
        const entry = ev.data as LogEntry;
        this.logs.unshift(entry);
        this.logs.length = Math.min(this.logs.length, 200);
        this.broadcast("log", entry);
        break;
      }
      case "trade_closed":
        this.broadcast("trade_closed", ev.data);
        break;
      case "ready":
        logger.info({ data: ev.data }, "Python engine ready");
        break;
    }
  }

  publicState() {
    return { ...(this.state ?? {}), engineOnline: this.proc !== null, logs: this.logs.slice(0, 60) };
  }

  updateSettings(patch: unknown) {
    this.settings = applyPatch(this.settings, patch);
    writeJson(SETTINGS_FILE, this.settings);
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
    writeJson(CREDENTIALS_FILE, c ?? {}, true);
    this.send({ cmd: "credentials", credentials: c ?? {} });
  }
}

export const engine = new Engine();
