import { Router, type IRouter } from "express";
import { botState } from "../../bot/state";
import { GetMarketsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/markets", (_req, res): void => {
  if (botState.markets.length === 0) {
    // Return placeholder list when no analysis run yet
    const placeholders = [
      { asset: "EURUSD_otc", name: "EUR/USD OTC", isOtc: true, isActive: true, payout: 80, signalDirection: null, signalStrength: null, rsi: null, macd: null, bollingerSignal: null, emaSignal: null, volume: null, category: "otc" as const },
      { asset: "GBPUSD_otc", name: "GBP/USD OTC", isOtc: true, isActive: true, payout: 80, signalDirection: null, signalStrength: null, rsi: null, macd: null, bollingerSignal: null, emaSignal: null, volume: null, category: "otc" as const },
      { asset: "AUDUSD_otc", name: "AUD/USD OTC", isOtc: true, isActive: true, payout: 80, signalDirection: null, signalStrength: null, rsi: null, macd: null, bollingerSignal: null, emaSignal: null, volume: null, category: "otc" as const },
      { asset: "USDJPY_otc", name: "USD/JPY OTC", isOtc: true, isActive: true, payout: 80, signalDirection: null, signalStrength: null, rsi: null, macd: null, bollingerSignal: null, emaSignal: null, volume: null, category: "otc" as const },
      { asset: "BTCUSD_otc", name: "BTC/USD OTC", isOtc: true, isActive: true, payout: 80, signalDirection: null, signalStrength: null, rsi: null, macd: null, bollingerSignal: null, emaSignal: null, volume: null, category: "otc" as const },
      { asset: "ETHUSD_otc", name: "ETH/USD OTC", isOtc: true, isActive: true, payout: 80, signalDirection: null, signalStrength: null, rsi: null, macd: null, bollingerSignal: null, emaSignal: null, volume: null, category: "otc" as const },
      { asset: "EURUSD", name: "EUR/USD", isOtc: false, isActive: true, payout: 75, signalDirection: null, signalStrength: null, rsi: null, macd: null, bollingerSignal: null, emaSignal: null, volume: null, category: "forex" as const },
      { asset: "GBPUSD", name: "GBP/USD", isOtc: false, isActive: true, payout: 75, signalDirection: null, signalStrength: null, rsi: null, macd: null, bollingerSignal: null, emaSignal: null, volume: null, category: "forex" as const },
      { asset: "BTCUSD", name: "BTC/USD", isOtc: false, isActive: true, payout: 75, signalDirection: null, signalStrength: null, rsi: null, macd: null, bollingerSignal: null, emaSignal: null, volume: null, category: "crypto" as const },
    ];
    res.json(GetMarketsResponse.parse(placeholders));
    return;
  }
  res.json(GetMarketsResponse.parse(botState.markets));
});

export default router;
