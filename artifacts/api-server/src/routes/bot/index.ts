import { Router, type IRouter } from "express";
import { botState } from "../../bot/state";
import {
  ConnectBotBody,
  GetBotStatusResponse,
  ConnectBotResponse,
  DisconnectBotResponse,
  StartBotResponse,
  StopBotResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/bot/status", async (_req, res): Promise<void> => {
  const status = {
    connected: botState.status.connected,
    running: botState.status.running,
    phase: botState.status.phase,
    balance: botState.status.balance,
    balanceType: botState.status.balanceType,
    activeTradeCount: botState.activeTrades.size,
    analysisProgress: botState.status.analysisProgress,
    lastError: botState.status.lastError,
    connectedAt: botState.status.connectedAt,
  };
  res.json(GetBotStatusResponse.parse(status));
});

router.post("/bot/connect", async (req, res): Promise<void> => {
  const parsed = ConnectBotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { ssid } = parsed.data;
  const balanceType = (req.body.balanceType === "real" ? "real" : "demo") as "demo" | "real";

  botState.ensureProcess();
  await botState.connect(ssid, balanceType);

  // Give brief moment for process to initialize
  await new Promise((r) => setTimeout(r, 500));

  const status = {
    connected: botState.status.connected,
    running: botState.status.running,
    phase: botState.status.phase as "idle" | "connecting" | "analysing" | "trading" | "stopping",
    balance: botState.status.balance,
    balanceType: botState.status.balanceType,
    activeTradeCount: botState.activeTrades.size,
    analysisProgress: botState.status.analysisProgress,
    lastError: botState.status.lastError,
    connectedAt: botState.status.connectedAt,
  };
  res.json(ConnectBotResponse.parse(status));
});

router.post("/bot/disconnect", async (_req, res): Promise<void> => {
  await botState.disconnect();
  const status = {
    connected: false,
    running: false,
    phase: "idle" as const,
    balance: null,
    balanceType: null,
    activeTradeCount: 0,
    analysisProgress: null,
    lastError: null,
    connectedAt: null,
  };
  res.json(DisconnectBotResponse.parse(status));
});

router.post("/bot/start", async (_req, res): Promise<void> => {
  if (!botState.status.connected) {
    res.status(400).json({ error: "Not connected. Please connect with your SSID first." });
    return;
  }
  if (botState.status.running) {
    res.status(400).json({ error: "Bot is already running." });
    return;
  }
  botState.start();
  await new Promise((r) => setTimeout(r, 200));
  const status = {
    connected: botState.status.connected,
    running: true,
    phase: botState.status.phase as "idle" | "connecting" | "analysing" | "trading" | "stopping",
    balance: botState.status.balance,
    balanceType: botState.status.balanceType,
    activeTradeCount: botState.activeTrades.size,
    analysisProgress: botState.status.analysisProgress,
    lastError: botState.status.lastError,
    connectedAt: botState.status.connectedAt,
  };
  res.json(StartBotResponse.parse(status));
});

router.post("/bot/stop", async (_req, res): Promise<void> => {
  await botState.stop();
  await new Promise((r) => setTimeout(r, 200));
  const status = {
    connected: botState.status.connected,
    running: false,
    phase: "idle" as const,
    balance: botState.status.balance,
    balanceType: botState.status.balanceType,
    activeTradeCount: botState.activeTrades.size,
    analysisProgress: null,
    lastError: null,
    connectedAt: botState.status.connectedAt,
  };
  res.json(StopBotResponse.parse(status));
});

export default router;
