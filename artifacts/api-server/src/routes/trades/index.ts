import { Router, type IRouter } from "express";
import { botState } from "../../bot/state";
import {
  GetActiveTradesResponse,
  GetTradeHistoryResponse,
  GetTradeHistoryQueryParams,
  GetTradeStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trades/active", (_req, res): void => {
  const trades = Array.from(botState.activeTrades.values());
  res.json(GetActiveTradesResponse.parse(trades));
});

router.get("/trades/history", (req, res): void => {
  const params = GetTradeHistoryQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const trades = botState.closedTrades.slice(0, limit);
  res.json(GetTradeHistoryResponse.parse(trades));
});

router.get("/trades/stats", (_req, res): void => {
  const stats = botState.getTradeStats();
  res.json(GetTradeStatsResponse.parse(stats));
});

export default router;
