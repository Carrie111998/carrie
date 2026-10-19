import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Trade {
  id: string;
  asset: string;
  direction: "buy" | "sell";
  amount: number;
  duration: number;
  openTime: string;
  closeTime: string | null;
  openPrice: number | null;
  closePrice: number | null;
  profit: number | null;
  status: "open" | "win" | "loss" | "draw";
  predictionMethod: string | null;
  signalStrength: number | null;
}

export interface Market {
  asset: string;
  name: string;
  isOtc: boolean;
  isActive: boolean;
  payout: number | null;
  signalDirection: "buy" | "sell" | null;
  signalStrength: number | null;
  rsi: number | null;
  macd: number | null;
  bollingerSignal: string | null;
  emaSignal: string | null;
  volume: number | null;
  category: "forex" | "crypto" | "stocks" | "indices" | "otc";
}

export interface MarketSignal {
  asset: string;
  name: string;
  direction: "buy" | "sell";
  strength: number;
  riskScore: number;
  rsiScore: number | null;
  macdScore: number | null;
  bollingerScore: number | null;
  emaScore: number | null;
  volumeScore: number | null;
  finnhubScore: number | null;
  twelveDataScore: number | null;
  geminiScore: number | null;
  alpacaScore: number | null;
  isOtc: boolean;
}

export interface BotSettings {
  tradeTime: 3 | 5 | 10 | 60 | 120;
  tradeAmount: number;
  tradeAmountType: "fixed" | "percentage";
  maxActiveTrades: number;
  riskLevel: "low" | "mid" | "high";
  marketCategories: string[];
  tradingMode: "technical" | "ai" | "both";
  enableRsi: boolean;
  enableMacd: boolean;
  enableBollinger: boolean;
  enableEma: boolean;
  enableVolume: boolean;
  rsiWeight: number;
  macdWeight: number;
  bollingerWeight: number;
  emaWeight: number;
  volumeWeight: number;
  enableFinnhub: boolean;
  finnhubWeight: number;
  enableTwelveData: boolean;
  twelveDataWeight: number;
  enableGemini: boolean;
  geminiWeight: number;
  enableAlpaca: boolean;
  alpacaWeight: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bollingerPeriod: number;
  bollingerStdDev: number;
  emaFast: number;
  emaSlow: number;
  balanceType: "demo" | "real";
}

export interface BotStatus {
  connected: boolean;
  running: boolean;
  phase: "idle" | "connecting" | "analysing" | "trading" | "stopping";
  balance: number | null;
  balanceType: "demo" | "real" | null;
  activeTradeCount: number;
  analysisProgress: number | null;
  lastError: string | null;
  connectedAt: string | null;
}

export interface AnalysisState {
  status: "idle" | "running" | "complete";
  progress: number | null;
  topMarkets: MarketSignal[];
  lastUpdated: string | null;
  methodsUsed: string[];
}

// ─── Bot State Singleton ──────────────────────────────────────────────────────

class BotStateManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private lineBuffer = "";
  private wsClients: Set<(msg: string) => void> = new Set();

  status: BotStatus = {
    connected: false,
    running: false,
    phase: "idle",
    balance: null,
    balanceType: null,
    activeTradeCount: 0,
    analysisProgress: null,
    lastError: null,
    connectedAt: null,
  };

  settings: BotSettings = {
    tradeTime: 60,
    tradeAmount: 1.0,
    tradeAmountType: "fixed",
    maxActiveTrades: 5,
    riskLevel: "mid",
    marketCategories: ["otc", "forex", "crypto", "stocks", "indices"],
    tradingMode: "both",
    enableRsi: true,
    enableMacd: true,
    enableBollinger: true,
    enableEma: true,
    enableVolume: true,
    rsiWeight: 20,
    macdWeight: 20,
    bollingerWeight: 20,
    emaWeight: 20,
    volumeWeight: 20,
    enableFinnhub: false,
    finnhubWeight: 20,
    enableTwelveData: false,
    twelveDataWeight: 20,
    enableGemini: false,
    geminiWeight: 20,
    enableAlpaca: false,
    alpacaWeight: 20,
    rsiPeriod: 14,
    rsiOversold: 30,
    rsiOverbought: 70,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    bollingerPeriod: 20,
    bollingerStdDev: 2,
    emaFast: 9,
    emaSlow: 21,
    balanceType: "demo",
  };

  activeTrades: Map<string, Trade> = new Map();
  closedTrades: Trade[] = [];
  markets: Market[] = [];
  analysis: AnalysisState = {
    status: "idle",
    progress: null,
    topMarkets: [],
    lastUpdated: null,
    methodsUsed: [],
  };

  registerWsClient(send: (msg: string) => void) {
    this.wsClients.add(send);
  }

  unregisterWsClient(send: (msg: string) => void) {
    this.wsClients.delete(send);
  }

  broadcastWs(event: string, data: unknown) {
    const msg = JSON.stringify({ type: event, data });
    for (const send of this.wsClients) {
      try {
        send(msg);
      } catch (_) {}
    }
  }

  private sendToBot(cmd: object) {
    if (!this.proc || this.proc.killed) return;
    try {
      this.proc.stdin.write(JSON.stringify(cmd) + "\n");
    } catch (e) {
      logger.warn({ err: e }, "Failed to send command to bot");
    }
  }

  private handleBotEvent(event: { type: string; data: unknown }) {
    const { type, data } = event;

    if (type === "status") {
      const s = data as Partial<BotStatus>;
      this.status = { ...this.status, ...s };
      this.broadcastWs("status", this.status);
    } else if (type === "trade_placed") {
      const t = data as Trade;
      this.activeTrades.set(t.id, t);
      this.status.activeTradeCount = this.activeTrades.size;
      this.broadcastWs("trade_placed", t);
    } else if (type === "trade_closed") {
      const t = data as Trade;
      this.activeTrades.delete(t.id);
      this.closedTrades.unshift(t);
      if (this.closedTrades.length > 500) this.closedTrades = this.closedTrades.slice(0, 500);
      this.status.activeTradeCount = this.activeTrades.size;
      this.broadcastWs("trade_closed", t);
      // Also broadcast updated stats so dashboard updates immediately
      this.broadcastWs("stats_update", this.getTradeStats());
    } else if (type === "balance_update") {
      const b = data as { balance: number };
      this.status.balance = b.balance;
      this.broadcastWs("balance_update", b);
    } else if (type === "analysis_update") {
      const a = data as AnalysisState;
      this.analysis = a;
      this.broadcastWs("analysis_update", a);
    } else if (type === "market_update") {
      this.markets = data as Market[];
      this.broadcastWs("market_update", this.markets);
    } else if (type === "error") {
      const e = data as { message: string };
      this.status.lastError = e.message;
      logger.error({ botError: e.message }, "Bot error");
      this.broadcastWs("error", e);
    } else if (type === "ready") {
      logger.info("Python bot process ready");
    }
  }

  ensureProcess() {
    if (this.proc && !this.proc.killed) return;

    const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
      ? path.resolve(process.cwd(), "../..")
      : process.cwd();

    const botScript = path.resolve(workspaceRoot, "artifacts/api-server/src/bot/trading_bot.py");

    logger.info({ botScript }, "Spawning Python bot process");
    this.proc = spawn("python3", [botScript], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.lineBuffer += chunk.toString();
      const lines = this.lineBuffer.split("\n");
      this.lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          this.handleBotEvent(event);
        } catch (_) {
          logger.debug({ raw: trimmed }, "Non-JSON bot output");
        }
      }
    });

    this.proc.stderr.on("data", (chunk: Buffer) => {
      logger.debug({ stderr: chunk.toString().trim() }, "Bot stderr");
    });

    this.proc.on("exit", (code) => {
      logger.info({ code }, "Bot process exited");
      this.status.connected = false;
      this.status.running = false;
      this.status.phase = "idle";
      this.broadcastWs("status", this.status);
      this.proc = null;
    });
  }

  async connect(ssid: string, balanceType: "demo" | "real" = "demo"): Promise<void> {
    this.ensureProcess();
    this.status.balanceType = balanceType;
    this.status.connectedAt = new Date().toISOString();
    this.sendToBot({ command: "connect", ssid, balance_type: balanceType });
  }

  async disconnect(): Promise<void> {
    this.sendToBot({ command: "disconnect" });
    this.status.connected = false;
    this.status.running = false;
    this.status.phase = "idle";
    this.status.balance = null;
    this.activeTrades.clear();
  }

  async start(): Promise<void> {
    this.sendToBot({ command: "start", settings: this.settings });
  }

  async stop(): Promise<void> {
    this.sendToBot({ command: "stop" });
  }

  updateSettings(s: Partial<BotSettings>) {
    this.settings = { ...this.settings, ...s };
    this.sendToBot({ command: "update_settings", settings: this.settings });
  }

  getTradeStats() {
    const closed = this.closedTrades;
    const wins = closed.filter((t) => t.status === "win").length;
    const losses = closed.filter((t) => t.status === "loss").length;
    const draws = closed.filter((t) => t.status === "draw").length;
    const total = closed.length;
    const totalProfit = closed.reduce((s, t) => s + (t.profit ?? 0), 0);

    // 24-hour rolling window
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const todayProfit = closed
      .filter((t) => t.closeTime && new Date(t.closeTime).getTime() >= cutoff)
      .reduce((s, t) => s + (t.profit ?? 0), 0);

    const profits = closed.map((t) => t.profit ?? 0);
    return {
      totalTrades: total,
      wins,
      losses,
      draws,
      winRate: total > 0 ? (wins / total) * 100 : 0,
      totalProfit,
      todayProfit,
      avgProfit: total > 0 ? totalProfit / total : 0,
      bestTrade: profits.length > 0 ? Math.max(...profits) : null,
      worstTrade: profits.length > 0 ? Math.min(...profits) : null,
    };
  }
}

export const botState = new BotStateManager();
