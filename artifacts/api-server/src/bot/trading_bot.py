#!/usr/bin/env python3
"""
PocketOption Trading Bot
Communicates with Node.js parent process via stdin/stdout JSON lines.

Commands (stdin):
  {"command": "connect", "ssid": "...", "balance_type": "demo"}
  {"command": "start", "settings": {...}}
  {"command": "stop"}
  {"command": "disconnect"}
  {"command": "update_settings", "settings": {...}}

Events (stdout):
  {"type": "status", "data": {...}}
  {"type": "trade_placed", "data": {...}}
  {"type": "trade_closed", "data": {...}}
  {"type": "balance_update", "data": {"balance": 100.0}}
  {"type": "analysis_update", "data": {...}}
  {"type": "market_update", "data": [...]}
  {"type": "error", "data": {"message": "..."}}
  {"type": "ready"}
"""

import asyncio
import json
import sys
import os
import logging
import uuid
import math
import re
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

import numpy as np

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
logger = logging.getLogger(__name__)

# ─── API Keys (from env) ──────────────────────────────────────────────────────

FINNHUB_KEY = os.environ.get("FINNHUB_API_KEY", "")
TWELVE_DATA_KEY = os.environ.get("TWELVE_DATA_API_KEY", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
ALPACA_KEY = os.environ.get("ALPACA_API_KEY", "")
ALPACA_SECRET = os.environ.get("ALPACA_SECRET_KEY", "")

# ─── Technical Analysis Helpers ───────────────────────────────────────────────

def calc_rsi(closes: List[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def calc_ema(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    k = 2.0 / (period + 1)
    ema = float(np.mean(closes[:period]))
    for c in closes[period:]:
        ema = c * k + ema * (1 - k)
    return ema


def calc_macd(closes: List[float], fast: int = 12, slow: int = 26, signal: int = 9):
    if len(closes) < slow + signal:
        return None, None, None
    ema_fast = calc_ema(closes, fast)
    ema_slow = calc_ema(closes, slow)
    if ema_fast is None or ema_slow is None:
        return None, None, None
    macd_val = ema_fast - ema_slow
    macd_series = []
    for i in range(slow, len(closes)):
        ef = calc_ema(closes[:i], fast)
        es = calc_ema(closes[:i], slow)
        if ef and es:
            macd_series.append(ef - es)
    if len(macd_series) < signal:
        return macd_val, None, None
    signal_val = calc_ema(macd_series, signal)
    histogram = macd_val - signal_val if signal_val else None
    return macd_val, signal_val, histogram


def calc_bollinger(closes: List[float], period: int = 20, num_std: float = 2.0):
    if len(closes) < period:
        return None, None, None
    arr = np.array(closes[-period:])
    middle = float(np.mean(arr))
    std = float(np.std(arr))
    upper = middle + num_std * std
    lower = middle - num_std * std
    return upper, middle, lower


def analyze_market(candles: List[Dict], params: Optional[Dict] = None) -> Dict:
    """Compute all indicators from a candle list. Returns signals dict with 0-100 strength."""
    p = params or {}
    rsi_period = int(p.get("rsiPeriod", 14))
    rsi_oversold = float(p.get("rsiOversold", 30))
    rsi_overbought = float(p.get("rsiOverbought", 70))
    macd_fast = int(p.get("macdFast", 12))
    macd_slow = int(p.get("macdSlow", 26))
    macd_signal = int(p.get("macdSignal", 9))
    bb_period = int(p.get("bollingerPeriod", 20))
    bb_std = float(p.get("bollingerStdDev", 2.0))
    ema_fast = int(p.get("emaFast", 9))
    ema_slow = int(p.get("emaSlow", 21))

    if len(candles) < 30:
        return {"direction": None, "strength": 0.0, "rsi": None, "macd": None,
                "bollinger": None, "ema": None, "volume": None}

    closes = [float(c.get("close", 0)) for c in candles]
    volumes = [float(c.get("volume", 0)) for c in candles if c.get("volume")]
    last_close = closes[-1]

    scores = []  # each +1 = buy signal, -1 = sell signal

    # RSI — score is ±0-80 (already capped at ±80)
    rsi = calc_rsi(closes, rsi_period)
    rsi_score = None
    if rsi is not None:
        mid_low = rsi_oversold + (50 - rsi_oversold) / 2  # midpoint between oversold and 50
        mid_high = 50 + (rsi_overbought - 50) / 2
        if rsi < rsi_oversold:
            rsi_score = 80.0
            scores.append(1)
        elif rsi < mid_low:
            rsi_score = 60.0
            scores.append(0.5)
        elif rsi > rsi_overbought:
            rsi_score = -80.0
            scores.append(-1)
        elif rsi > mid_high:
            rsi_score = -60.0
            scores.append(-0.5)
        else:
            rsi_score = 0.0

    # MACD — score capped at ±100
    macd_val, signal_val, histogram = calc_macd(closes, macd_fast, macd_slow, macd_signal)
    macd_score = None
    if histogram is not None:
        if histogram > 0 and macd_val > signal_val:
            macd_score = min(abs(histogram) * 1000, 100.0)
            scores.append(1)
        elif histogram < 0 and macd_val < signal_val:
            macd_score = -min(abs(histogram) * 1000, 100.0)
            scores.append(-1)
        else:
            macd_score = 0.0

    # Bollinger Bands — score ±0-75
    upper, middle, lower = calc_bollinger(closes, bb_period, bb_std)
    bollinger_score = None
    if upper and lower and middle:
        band_width = upper - lower
        if band_width > 0:
            pos = (last_close - lower) / band_width
            if pos < 0.2:
                bollinger_score = 75.0
                scores.append(1)
            elif pos > 0.8:
                bollinger_score = -75.0
                scores.append(-1)
            elif pos < 0.35:
                bollinger_score = 40.0
                scores.append(0.5)
            elif pos > 0.65:
                bollinger_score = -40.0
                scores.append(-0.5)
            else:
                bollinger_score = 0.0

    # EMA crossover (fast vs slow) — score capped at ±100
    ema9 = calc_ema(closes, ema_fast)
    ema21 = calc_ema(closes, ema_slow)
    ema_score = None
    if ema9 and ema21:
        diff_pct = (ema9 - ema21) / ema21 * 100
        if diff_pct > 0.05:
            ema_score = min(diff_pct * 20, 100.0)
            scores.append(1)
        elif diff_pct < -0.05:
            ema_score = max(diff_pct * 20, -100.0)
            scores.append(-1)
        else:
            ema_score = 0.0

    # Volume signal — capped at ±100
    volume_score = None
    if volumes and len(volumes) >= 10:
        avg_vol = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else float(np.mean(volumes))
        last_vol = volumes[-1]
        if avg_vol > 0:
            rel = last_vol / avg_vol
            volume_score = min((rel - 1) * 100, 100.0)

    # Aggregate direction from vote scores
    if not scores:
        return {"direction": None, "strength": 0.0, "rsi": rsi, "macd": macd_score,
                "bollinger": bollinger_score, "ema": ema_score, "volume": volume_score}

    avg_score = sum(scores) / len(scores)
    direction = "buy" if avg_score > 0 else "sell"
    agreeing = sum(1 for s in scores if (s > 0 and avg_score > 0) or (s < 0 and avg_score < 0))
    # strength is 0-100
    strength = (agreeing / len(scores)) * 100.0

    return {
        "direction": direction,
        "strength": round(strength, 1),
        "rsi": round(rsi, 2) if rsi else None,
        "macd": round(macd_score, 2) if macd_score is not None else None,
        "bollinger": round(bollinger_score, 2) if bollinger_score is not None else None,
        "ema": round(ema_score, 2) if ema_score is not None else None,
        "volume": round(volume_score, 2) if volume_score is not None else None,
    }


def compute_risk_score(signals: Dict, risk_level: str) -> float:
    strength = signals.get("strength", 0.0)
    base_risk = 100.0 - strength
    if risk_level == "low":
        return base_risk * 1.2
    elif risk_level == "high":
        return base_risk * 0.7
    return base_risk


# ─── AI signal helpers ────────────────────────────────────────────────────────

def _finnhub_symbol(asset: str) -> Optional[str]:
    base = asset.replace("_otc", "").replace("#", "").upper()
    if len(base) == 6 and base.isalpha():
        return f"OANDA:{base[:3]}_{base[3:]}"
    return None


def _twelve_data_symbol(asset: str) -> Optional[str]:
    base = asset.replace("_otc", "").replace("#", "").upper()
    if len(base) == 6 and base.isalpha():
        return f"{base[:3]}/{base[3:]}"
    if base.startswith("BTC") or base.startswith("ETH") or base.startswith("LTC") or base.startswith("DOGE"):
        return f"{base[:3]}/USD"
    return None


def _alpaca_symbol(asset: str) -> Optional[str]:
    base = asset.replace("_otc", "").replace("#", "").upper()
    stock_map = {"AAPL": "AAPL", "MSFT": "MSFT", "TSLA": "TSLA", "AMZN": "AMZN"}
    for k, v in stock_map.items():
        if k in base:
            return v
    return None


async def get_finnhub_signal(asset: str) -> Optional[float]:
    """Returns -100 to +100 signal based on Finnhub news sentiment. Positive = bullish."""
    if not FINNHUB_KEY:
        return None
    sym = _finnhub_symbol(asset)
    if not sym:
        return None
    try:
        import requests
        resp = await asyncio.to_thread(
            requests.get,
            "https://finnhub.io/api/v1/news-sentiment",
            params={"symbol": sym, "token": FINNHUB_KEY},
            timeout=5
        )
        if resp.status_code == 200:
            data = resp.json()
            score = float(data.get("companyNewsScore", 0.5))
            buzz = data.get("buzz", {}).get("articlesInLastWeek", 0)
            if buzz > 0:
                return round((score - 0.5) * 200, 1)  # 0-1 → -100 to +100
    except Exception as e:
        logger.debug(f"Finnhub signal error for {asset}: {e}")
    return None


async def get_twelve_data_signal(asset: str) -> Optional[float]:
    """Returns -100 to +100 signal from Twelve Data RSI."""
    if not TWELVE_DATA_KEY:
        return None
    sym = _twelve_data_symbol(asset)
    if not sym:
        return None
    try:
        import requests
        resp = await asyncio.to_thread(
            requests.get,
            "https://api.twelvedata.com/rsi",
            params={"symbol": sym, "interval": "1min", "apikey": TWELVE_DATA_KEY, "outputsize": 1},
            timeout=5
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == "ok" and data.get("values"):
                rsi = float(data["values"][0]["rsi"])
                if rsi < 30:
                    return 80.0
                elif rsi < 40:
                    return 50.0
                elif rsi > 70:
                    return -80.0
                elif rsi > 60:
                    return -50.0
                else:
                    return round((50.0 - rsi) * 2.0, 1)  # linear between ±50
    except Exception as e:
        logger.debug(f"Twelve Data signal error for {asset}: {e}")
    return None


async def get_gemini_signal(asset: str, closes: List[float], sigs: Optional[Dict] = None) -> Optional[float]:
    """Returns -100 to +100 signal from Gemini AI.

    When technical indicator values (sigs) are supplied, Gemini scores the
    'mathematical confluence' of those indicators rather than raw price action.
    """
    if not GEMINI_KEY:
        return None
    if len(closes) < 10:
        return None
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")

        price_str = ", ".join(f"{p:.5f}" for p in closes[-15:])
        change_pct = ((closes[-1] - closes[-6]) / closes[-6] * 100) if closes[-6] != 0 else 0

        if sigs:
            # Mathematical Confluence — pass the indicator payload as JSON
            payload = {
                "asset": asset,
                "rsi": sigs.get("rsi"),
                "macd_score": sigs.get("macd"),
                "bollinger_score": sigs.get("bollinger"),
                "ema_score": sigs.get("ema"),
                "volume_score": sigs.get("volume"),
                "technical_direction": sigs.get("direction"),
                "5_period_change_pct": round(change_pct, 3),
            }
            prompt = (
                "You are a binary-options analyst. Below is a JSON payload of technical "
                "indicators for one asset. Positive scores lean bullish (buy), negative "
                "lean bearish (sell). Assess the mathematical confluence of these "
                "indicators and rate the probability the next candle moves in the winning "
                "direction.\n\n"
                f"{json.dumps(payload)}\n\n"
                'Respond ONLY with valid JSON: {"direction": "buy" or "sell", "confidence": 0-100}\n'
                "No markdown, no explanation."
            )
        else:
            prompt = (
                f"Binary options price data for {asset}:\n"
                f"Last 15 closes: {price_str}\n"
                f"5-period change: {change_pct:.3f}%\n\n"
                f'Respond ONLY with valid JSON: {{"direction": "buy" or "sell", "confidence": 0-100}}\n'
                f"No markdown, no explanation."
            )

        response = await asyncio.wait_for(
            asyncio.to_thread(model.generate_content, prompt),
            timeout=12.0
        )
        text = response.text.strip()
        match = re.search(r'\{[^}]+\}', text)
        if match:
            result = json.loads(match.group())
            direction = str(result.get("direction", "")).lower().strip()
            confidence = float(result.get("confidence", 50))
            confidence = max(0.0, min(100.0, confidence))
            if direction == "buy":
                return round(confidence, 1)
            elif direction == "sell":
                return round(-confidence, 1)
    except Exception as e:
        logger.debug(f"Gemini signal error for {asset}: {e}")
    return None


async def get_alpaca_signal(asset: str) -> Optional[float]:
    """Returns -100 to +100 signal from Alpaca news sentiment."""
    if not ALPACA_KEY or not ALPACA_SECRET:
        return None
    sym = _alpaca_symbol(asset)
    if not sym:
        return None
    try:
        import requests
        resp = await asyncio.to_thread(
            requests.get,
            "https://data.alpaca.markets/v1beta1/news",
            params={"symbols": sym, "limit": 5},
            headers={
                "APCA-API-KEY-ID": ALPACA_KEY,
                "APCA-API-SECRET-KEY": ALPACA_SECRET,
            },
            timeout=5
        )
        if resp.status_code == 200:
            articles = resp.json().get("news", [])
            if not articles:
                return None
            pos_words = ["rise", "gain", "up", "bull", "surge", "high", "strong", "beat", "growth", "record"]
            neg_words = ["fall", "drop", "down", "bear", "loss", "low", "weak", "miss", "decline", "crash"]
            score = 0
            count = 0
            for article in articles[:5]:
                headline = article.get("headline", "").lower()
                for w in pos_words:
                    if w in headline:
                        score += 1
                for w in neg_words:
                    if w in headline:
                        score -= 1
                count += 1
            if count > 0:
                return round(max(-100.0, min(100.0, score * 20.0)), 1)
    except Exception as e:
        logger.debug(f"Alpaca signal error for {asset}: {e}")
    return None


# ─── Known markets ────────────────────────────────────────────────────────────

OTC_ASSETS = [
    "EURUSD_otc", "GBPUSD_otc", "AUDUSD_otc", "USDJPY_otc", "USDCAD_otc",
    "EURGBP_otc", "AUDCAD_otc", "AUDJPY_otc", "EURCHF_otc", "EURJPY_otc",
    "GBPJPY_otc", "NZDUSD_otc", "USDCHF_otc", "CADCHF_otc", "GBPAUD_otc",
    "BTCUSD_otc", "ETHUSD_otc", "LTCUSD_otc", "DOGE_otc",
    "#AAPL_otc", "#MSFT_otc", "#TSLA_otc", "#AMZN_otc",
    "DJI30_otc", "JPN225_otc", "AUS200_otc",
]

NORMAL_ASSETS = [
    "EURUSD", "GBPUSD", "AUDUSD", "USDJPY", "USDCAD", "USDCHF",
    "EURGBP", "EURJPY", "GBPJPY", "NZDUSD",
    "BTCUSD", "ETHUSD", "LTCUSD",
]

ASSET_NAMES = {
    "EURUSD_otc": "EUR/USD OTC", "GBPUSD_otc": "GBP/USD OTC",
    "AUDUSD_otc": "AUD/USD OTC", "USDJPY_otc": "USD/JPY OTC",
    "USDCAD_otc": "USD/CAD OTC", "EURGBP_otc": "EUR/GBP OTC",
    "AUDCAD_otc": "AUD/CAD OTC", "AUDJPY_otc": "AUD/JPY OTC",
    "EURCHF_otc": "EUR/CHF OTC", "EURJPY_otc": "EUR/JPY OTC",
    "GBPJPY_otc": "GBP/JPY OTC", "NZDUSD_otc": "NZD/USD OTC",
    "USDCHF_otc": "USD/CHF OTC", "CADCHF_otc": "CAD/CHF OTC",
    "GBPAUD_otc": "GBP/AUD OTC", "BTCUSD_otc": "BTC/USD OTC",
    "ETHUSD_otc": "ETH/USD OTC", "LTCUSD_otc": "LTC/USD OTC",
    "DOGE_otc": "DOGE/USD OTC", "#AAPL_otc": "Apple OTC",
    "#MSFT_otc": "Microsoft OTC", "#TSLA_otc": "Tesla OTC",
    "#AMZN_otc": "Amazon OTC", "DJI30_otc": "Dow Jones OTC",
    "JPN225_otc": "Nikkei 225 OTC", "AUS200_otc": "ASX 200 OTC",
    "EURUSD": "EUR/USD", "GBPUSD": "GBP/USD", "AUDUSD": "AUD/USD",
    "USDJPY": "USD/JPY", "USDCAD": "USD/CAD", "USDCHF": "USD/CHF",
    "EURGBP": "EUR/GBP", "EURJPY": "EUR/JPY", "GBPJPY": "GBP/JPY",
    "NZDUSD": "NZD/USD", "BTCUSD": "BTC/USD", "ETHUSD": "ETH/USD",
    "LTCUSD": "LTC/USD",
}


def get_category(asset: str) -> str:
    if "_otc" in asset:
        return "otc"
    if asset.startswith("#"):
        return "stocks"
    if any(c in asset for c in ["BTC", "ETH", "LTC", "DOGE", "XRP", "BNB", "ADA"]):
        return "crypto"
    if any(i in asset for i in ["DJI", "JPN", "AUS", "E35", "E50", "F40", "D30"]):
        return "indices"
    return "forex"


# ─── Bot State ────────────────────────────────────────────────────────────────

class TradingBot:
    def __init__(self):
        self.client = None
        self.connected = False
        self.running = False
        self.phase = "idle"
        self.balance = None
        self.balance_type = "demo"
        self.ssid = None
        self.active_trades: Dict[str, Dict] = {}
        self.closed_trades: List[Dict] = []
        self.markets: List[Dict] = []
        self.top_signals: List[Dict] = []
        self.analysis_progress = 0
        self.analysis_status = "idle"
        self.settings = {
            "tradeTime": 60,
            "tradeAmount": 1.0,
            "tradeAmountType": "fixed",
            "maxActiveTrades": 5,
            "riskLevel": "mid",
            "marketCategories": ["otc", "forex", "crypto", "stocks", "indices"],
            "tradingMode": "both",
            "enableRsi": True,
            "enableMacd": True,
            "enableBollinger": True,
            "enableEma": True,
            "enableVolume": True,
            "rsiWeight": 20,
            "macdWeight": 20,
            "bollingerWeight": 20,
            "emaWeight": 20,
            "volumeWeight": 20,
            "enableFinnhub": False,
            "finnhubWeight": 20,
            "enableTwelveData": False,
            "twelveDataWeight": 20,
            "enableGemini": False,
            "geminiWeight": 20,
            "enableAlpaca": False,
            "alpacaWeight": 20,
            "rsiPeriod": 14,
            "rsiOversold": 30,
            "rsiOverbought": 70,
            "macdFast": 12,
            "macdSlow": 26,
            "macdSignal": 9,
            "bollingerPeriod": 20,
            "bollingerStdDev": 2.0,
            "emaFast": 9,
            "emaSlow": 21,
            "balanceType": "demo",
        }
        self._stop_event = asyncio.Event()
        self._trade_tasks: List[asyncio.Task] = []

    def emit(self, event_type: str, data: Any):
        msg = json.dumps({"type": event_type, "data": data})
        sys.stdout.write(msg + "\n")
        sys.stdout.flush()

    def emit_status(self):
        self.emit("status", {
            "connected": self.connected,
            "running": self.running,
            "phase": self.phase,
            "balance": self.balance,
            "balanceType": self.balance_type,
            "activeTradeCount": len(self.active_trades),
            "analysisProgress": self.analysis_progress if self.analysis_status == "running" else None,
            "lastError": None,
            "connectedAt": None,
        })

    async def connect(self, ssid: str, balance_type: str = "demo"):
        from BinaryOptionsToolsV2 import PocketOptionAsync
        self.ssid = ssid
        self.balance_type = balance_type
        self.phase = "connecting"
        self.emit_status()
        try:
            self.client = PocketOptionAsync(ssid=ssid)
            await self.client.__aenter__()
            self.connected = True
            self.balance = await self.client.balance()
            self.phase = "idle"
            self.emit_status()
            self.emit("ready", {"balance": self.balance})
        except Exception as e:
            self.connected = False
            self.phase = "idle"
            self.emit("error", {"message": f"Connection failed: {str(e)}"})
            self.emit_status()

    async def disconnect(self):
        self.running = False
        self._stop_event.set()
        if self.client:
            try:
                await self.client.__aexit__(None, None, None)
            except Exception:
                pass
        self.connected = False
        self.client = None
        self.phase = "idle"
        self.emit_status()

    def _compute_weighted_score(self, sigs: Dict, candles_closes: List[float]) -> float:
        """Compute a weighted combined score (0-100) from technical signals only (sync)."""
        s = self.settings
        weighted_sum = 0.0
        total_weight = 0.0

        def add(enabled_key: str, weight_key: str, raw_val, max_val: float = 100.0):
            nonlocal weighted_sum, total_weight
            if s.get(enabled_key) and raw_val is not None:
                w = float(s.get(weight_key, 20))
                # Normalize raw_val from ±max_val to 0-1 (distance from neutral)
                normalized = min(abs(raw_val) / max_val, 1.0)
                weighted_sum += normalized * w
                total_weight += w

        add("enableRsi", "rsiWeight", sigs.get("rsi"), 80.0)
        add("enableMacd", "macdWeight", sigs.get("macd"), 100.0)
        add("enableBollinger", "bollingerWeight", sigs.get("bollinger"), 75.0)
        add("enableEma", "emaWeight", sigs.get("ema"), 100.0)
        add("enableVolume", "volumeWeight", sigs.get("volume"), 100.0)

        if total_weight == 0:
            return sigs.get("strength", 0.0)
        return round((weighted_sum / total_weight) * 100.0, 1)

    async def _get_ai_scores(self, asset: str, closes: List[float], sigs: Optional[Dict] = None) -> Dict:
        """Run enabled AI methods and return a score dict."""
        s = self.settings
        tasks = {}
        if s.get("enableFinnhub"):
            tasks["finnhub"] = asyncio.create_task(get_finnhub_signal(asset))
        if s.get("enableTwelveData"):
            tasks["twelveData"] = asyncio.create_task(get_twelve_data_signal(asset))
        if s.get("enableGemini"):
            tasks["gemini"] = asyncio.create_task(get_gemini_signal(asset, closes, sigs))
        if s.get("enableAlpaca"):
            tasks["alpaca"] = asyncio.create_task(get_alpaca_signal(asset))

        results = {}
        if tasks:
            done = await asyncio.gather(*tasks.values(), return_exceptions=True)
            for key, result in zip(tasks.keys(), done):
                results[key] = result if not isinstance(result, Exception) else None
        return results

    def _blend_ai_scores(self, tech_score: float, direction: str, ai_scores: Dict) -> float:
        """Blend technical score with AI scores using weights. Returns 0-100."""
        s = self.settings
        weighted_sum = tech_score * 1.0  # start with tech score (will be rescaled)
        total_weight = 1.0  # base weight for technical

        def add_ai(key: str, weight_key: str):
            nonlocal weighted_sum, total_weight
            raw = ai_scores.get(key)
            if raw is None:
                return
            w = float(s.get(weight_key, 20)) / 20.0  # normalize weight relative to base
            # Convert AI score: positive = buy, negative = sell
            # If direction is buy, positive AI score confirms; negative reduces
            agree = raw if direction == "buy" else -raw
            normalized = min(max(agree / 100.0, 0.0), 1.0) * 100.0
            weighted_sum += normalized * w
            total_weight += w

        add_ai("finnhub", "finnhubWeight")
        add_ai("twelveData", "twelveDataWeight")
        add_ai("gemini", "geminiWeight")
        add_ai("alpaca", "alpacaWeight")

        return round(min(weighted_sum / total_weight, 100.0), 1)

    def _ai_only_score(self, direction: str, ai_scores: Dict) -> Optional[float]:
        """Weighted AI-only probability (0-100) in the given direction. None if no AI data."""
        s = self.settings
        weighted_sum = 0.0
        total_weight = 0.0
        for key, weight_key in [
            ("finnhub", "finnhubWeight"),
            ("twelveData", "twelveDataWeight"),
            ("gemini", "geminiWeight"),
            ("alpaca", "alpacaWeight"),
        ]:
            raw = ai_scores.get(key)
            if raw is None:
                continue
            w = float(s.get(weight_key, 20))
            agree = raw if direction == "buy" else -raw
            normalized = min(max(agree / 100.0, 0.0), 1.0) * 100.0
            weighted_sum += normalized * w
            total_weight += w
        if total_weight == 0:
            return None
        return round(min(weighted_sum / total_weight, 100.0), 1)

    def _combine_scores(self, tech_score: float, direction: str, ai_scores: Dict) -> float:
        """Combine technical and AI scores according to the configured trading mode."""
        mode = self.settings.get("tradingMode", "both")
        if mode == "technical":
            return tech_score
        if mode == "ai":
            ai_score = self._ai_only_score(direction, ai_scores)
            return ai_score if ai_score is not None else tech_score
        return self._blend_ai_scores(tech_score, direction, ai_scores)

    async def _resolve_from_closed_deals(self, trade_id: str):
        """Look up a trade's real outcome in PocketOption closed deals. Returns (outcome, profit) or (None, None)."""
        try:
            deals = await asyncio.wait_for(self.client.closed_deals(), timeout=10.0)
            for d in (deals or []):
                if str(d.get("id")) == str(trade_id):
                    profit = float(d.get("profit", 0) or 0)
                    if profit > 0:
                        return "win", profit
                    elif profit < 0:
                        return "loss", profit
                    return "draw", 0.0
        except Exception as e:
            logger.debug(f"closed_deals lookup failed for {trade_id}: {e}")
        return None, None

    def _get_trade_amount(self) -> float:
        """Get actual trade amount based on type (fixed or % of balance)."""
        amount = float(self.settings.get("tradeAmount", 1.0))
        if self.settings.get("tradeAmountType") == "percentage" and self.balance:
            amount = float(self.balance) * amount / 100.0
        return max(1.0, round(amount, 2))

    async def run_analysis(self) -> List[Dict]:
        """Run market analysis across filtered categories."""
        # Filter assets by selected categories
        categories = self.settings.get("marketCategories", ["otc", "forex", "crypto", "stocks", "indices"])
        if not categories:
            categories = ["otc", "forex", "crypto", "stocks", "indices"]

        all_assets = [a for a in (OTC_ASSETS + NORMAL_ASSETS) if get_category(a) in categories]
        if not all_assets:
            all_assets = OTC_ASSETS + NORMAL_ASSETS

        self.phase = "analysing"
        self.analysis_status = "running"
        self.analysis_progress = 0
        self.emit_status()

        indicator_params = {
            "rsiPeriod": self.settings.get("rsiPeriod", 14),
            "rsiOversold": self.settings.get("rsiOversold", 30),
            "rsiOverbought": self.settings.get("rsiOverbought", 70),
            "macdFast": self.settings.get("macdFast", 12),
            "macdSlow": self.settings.get("macdSlow", 26),
            "macdSignal": self.settings.get("macdSignal", 9),
            "bollingerPeriod": self.settings.get("bollingerPeriod", 20),
            "bollingerStdDev": self.settings.get("bollingerStdDev", 2.0),
            "emaFast": self.settings.get("emaFast", 9),
            "emaSlow": self.settings.get("emaSlow", 21),
        }

        mode = self.settings.get("tradingMode", "both")
        signals = []
        candles_cache: Dict[str, List[float]] = {}
        sigs_cache: Dict[str, Dict] = {}
        total = len(all_assets)
        methods_used = []
        if self.settings.get("enableRsi"): methods_used.append("RSI")
        if self.settings.get("enableMacd"): methods_used.append("MACD")
        if self.settings.get("enableBollinger"): methods_used.append("Bollinger")
        if self.settings.get("enableEma"): methods_used.append("EMA")
        if self.settings.get("enableVolume"): methods_used.append("Volume")
        if self.settings.get("enableFinnhub") and FINNHUB_KEY: methods_used.append("Finnhub")
        if self.settings.get("enableTwelveData") and TWELVE_DATA_KEY: methods_used.append("12Data")
        if self.settings.get("enableGemini") and GEMINI_KEY: methods_used.append("Gemini")
        if self.settings.get("enableAlpaca") and ALPACA_KEY and ALPACA_SECRET: methods_used.append("Alpaca")

        self.markets = []

        for i, asset in enumerate(all_assets):
            if self._stop_event.is_set():
                break
            try:
                candles = await asyncio.wait_for(
                    self.client.history(asset, 60), timeout=8.0
                )
                if candles and len(candles) >= 30:
                    sigs = analyze_market(candles, indicator_params)
                    closes = [float(c.get("close", 0)) for c in candles]
                    candles_cache[asset] = closes
                    sigs_cache[asset] = sigs

                    # In AI mode, admit any directional candidate so AI scoring
                    # can rank them independently of technical strength. In
                    # technical/both modes, pre-filter weak technical signals.
                    admit = bool(sigs["direction"]) and (mode == "ai" or sigs["strength"] > 40)
                    if admit:
                        tech_score = self._compute_weighted_score(sigs, closes)
                        risk = compute_risk_score(sigs, self.settings["riskLevel"])
                        is_otc = "_otc" in asset.lower()
                        signals.append({
                            "asset": asset,
                            "name": ASSET_NAMES.get(asset, asset),
                            "direction": sigs["direction"],
                            "strength": tech_score,
                            "riskScore": round(risk, 1),
                            "rsiScore": sigs["rsi"],
                            "macdScore": sigs["macd"],
                            "bollingerScore": sigs["bollinger"],
                            "emaScore": sigs["ema"],
                            "volumeScore": sigs["volume"],
                            "finnhubScore": None,
                            "twelveDataScore": None,
                            "geminiScore": None,
                            "alpacaScore": None,
                            "isOtc": is_otc,
                        })

                    market_info = {
                        "asset": asset,
                        "name": ASSET_NAMES.get(asset, asset),
                        "isOtc": "_otc" in asset.lower(),
                        "isActive": True,
                        "payout": 80.0,
                        "signalDirection": sigs.get("direction"),
                        "signalStrength": sigs.get("strength"),
                        "rsi": sigs.get("rsi"),
                        "macd": sigs.get("macd"),
                        "bollingerSignal": "buy" if (sigs.get("bollinger") or 0) > 0 else ("sell" if (sigs.get("bollinger") or 0) < 0 else None),
                        "emaSignal": "buy" if (sigs.get("ema") or 0) > 0 else ("sell" if (sigs.get("ema") or 0) < 0 else None),
                        "volume": sigs.get("volume"),
                        "category": get_category(asset),
                    }
                    self.markets.append(market_info)

            except Exception as e:
                logger.debug(f"Analysis failed for {asset}: {e}")

            self.analysis_progress = int((i + 1) / total * 100)
            if i % 5 == 0:
                self.emit("analysis_update", {
                    "status": "running",
                    "progress": self.analysis_progress,
                    "topMarkets": signals[:10],
                    "lastUpdated": datetime.now(timezone.utc).isoformat(),
                    "methodsUsed": methods_used,
                })
                self.emit_status()
            await asyncio.sleep(0.05)

        # Filter and sort by strength
        risk_filter = {"low": 60, "mid": 80, "high": 100}
        max_risk = risk_filter.get(self.settings["riskLevel"], 80)
        filtered = [s for s in signals if s["riskScore"] <= max_risk]
        filtered.sort(key=lambda x: x["strength"], reverse=True)
        top = filtered[:10]

        # Enhance top signals with AI scores (only top 10 to save API quota).
        # In "technical" mode AI is skipped entirely.
        has_ai = mode != "technical" and any([
            self.settings.get("enableFinnhub") and FINNHUB_KEY,
            self.settings.get("enableTwelveData") and TWELVE_DATA_KEY,
            self.settings.get("enableGemini") and GEMINI_KEY,
            self.settings.get("enableAlpaca") and ALPACA_KEY and ALPACA_SECRET,
        ])

        if has_ai and top:
            self.emit("analysis_update", {
                "status": "running",
                "progress": 95,
                "topMarkets": top,
                "lastUpdated": datetime.now(timezone.utc).isoformat(),
                "methodsUsed": methods_used,
            })
            for signal in top:
                if self._stop_event.is_set():
                    break
                closes = candles_cache.get(signal["asset"], [])
                sigs = sigs_cache.get(signal["asset"])
                ai = await self._get_ai_scores(signal["asset"], closes, sigs)
                signal["finnhubScore"] = ai.get("finnhub")
                signal["twelveDataScore"] = ai.get("twelveData")
                signal["geminiScore"] = ai.get("gemini")
                signal["alpacaScore"] = ai.get("alpaca")
                # Combine technical + AI according to trading mode
                signal["strength"] = self._combine_scores(
                    signal["strength"], signal["direction"], ai
                )
                await asyncio.sleep(0.1)

            # Re-sort after AI scoring
            top.sort(key=lambda x: x["strength"], reverse=True)

        self.top_signals = top
        self.analysis_status = "complete"
        self.analysis_progress = 100

        self.emit("analysis_update", {
            "status": "complete",
            "progress": 100,
            "topMarkets": top,
            "lastUpdated": datetime.now(timezone.utc).isoformat(),
            "methodsUsed": methods_used,
        })
        self.emit("market_update", self.markets)
        return top

    async def monitor_trade(self, trade_id: str, trade_info: Dict):
        """Wait for a trade to close and report result."""
        # Cap the wait at the trade duration plus a grace window so a hung
        # check_win can never hold an active-trade slot indefinitely.
        duration = int(trade_info.get("duration", 60))
        timeout = duration + 90.0
        outcome = None
        profit = 0.0

        try:
            result = await asyncio.wait_for(
                self.client.check_win(trade_id), timeout=timeout
            )
            # Normalize outcome — BinaryOptionsTools may return "Win", "Loss", "Draw"
            if isinstance(result, dict):
                outcome = str(result.get("result", "")).lower().strip()
                profit = float(result.get("profit", 0) or 0)
            else:
                outcome = str(result).lower().strip()
        except asyncio.TimeoutError:
            logger.debug(f"check_win timed out for {trade_id}; falling back to closed_deals")
        except Exception as e:
            logger.debug(f"Trade monitor error for {trade_id}: {e}")

        # If check_win didn't return a clean outcome, look it up in closed deals.
        if outcome not in ("win", "loss", "draw"):
            resolved, resolved_profit = await self._resolve_from_closed_deals(trade_id)
            if resolved:
                outcome, profit = resolved, resolved_profit

        # Final normalization of profit based on outcome.
        if outcome == "win":
            profit = abs(profit) if profit != 0 else self._get_trade_amount() * 0.8
        elif outcome == "draw":
            profit = 0.0
        else:
            # Unknown or loss → treat as loss
            outcome = "loss"
            profit = -abs(profit) if profit != 0 else -abs(self._get_trade_amount())

        # Idempotency: if another path (e.g. the stale reaper) already closed
        # this trade during our awaits, don't double-record it.
        if self.active_trades.pop(trade_id, None) is None:
            return

        trade_info.update({
            "status": outcome,
            "profit": round(profit, 2),
            "closeTime": datetime.now(timezone.utc).isoformat(),
        })

        self.closed_trades.insert(0, trade_info)
        if len(self.closed_trades) > 500:
            self.closed_trades = self.closed_trades[:500]

        self.emit("trade_closed", trade_info)
        try:
            bal = await self.client.balance()
            self.balance = bal
            self.emit("balance_update", {"balance": bal})
        except Exception:
            pass
        self.emit_status()

    async def place_trade(self, signal: Dict) -> bool:
        """Place a single trade based on signal."""
        asset = signal["asset"]
        direction = signal["direction"]
        amount = self._get_trade_amount()
        duration = int(self.settings["tradeTime"])

        is_otc = signal.get("isOtc", "_otc" in asset)
        if not is_otc and duration < 60:
            duration = 60

        try:
            if direction == "buy":
                trade_id, deal = await asyncio.wait_for(
                    self.client.buy(asset, amount, duration), timeout=15.0
                )
            else:
                trade_id, deal = await asyncio.wait_for(
                    self.client.sell(asset, amount, duration), timeout=15.0
                )

            # Build prediction method string from enabled methods
            methods = []
            if self.settings.get("enableRsi"): methods.append("RSI")
            if self.settings.get("enableMacd"): methods.append("MACD")
            if self.settings.get("enableBollinger"): methods.append("BB")
            if self.settings.get("enableEma"): methods.append("EMA")
            if self.settings.get("enableFinnhub") and signal.get("finnhubScore") is not None: methods.append("Finnhub")
            if self.settings.get("enableGemini") and signal.get("geminiScore") is not None: methods.append("Gemini")
            if self.settings.get("enableTwelveData") and signal.get("twelveDataScore") is not None: methods.append("12Data")
            if self.settings.get("enableAlpaca") and signal.get("alpacaScore") is not None: methods.append("Alpaca")

            trade_info = {
                "id": str(trade_id),
                "asset": asset,
                "direction": direction,
                "amount": amount,
                "duration": duration,
                "openTime": datetime.now(timezone.utc).isoformat(),
                "closeTime": None,
                "openPrice": float(deal.get("openPrice", 0)) if isinstance(deal, dict) else None,
                "closePrice": None,
                "profit": None,
                "status": "open",
                "predictionMethod": "+".join(methods) if methods else "Technical",
                "signalStrength": signal.get("strength"),
            }

            self.active_trades[str(trade_id)] = trade_info
            self.emit("trade_placed", trade_info)
            self.emit_status()

            task = asyncio.create_task(self.monitor_trade(str(trade_id), trade_info))
            self._trade_tasks.append(task)
            return True

        except Exception as e:
            logger.error(f"Failed to place trade on {asset}: {e}")
            return False

    async def _reap_stale_trades(self):
        """Force-close any active trade that is well past its expected close time."""
        now = datetime.now(timezone.utc)
        stale = []
        for tid, info in list(self.active_trades.items()):
            try:
                open_time = datetime.fromisoformat(info["openTime"])
                dur = int(info.get("duration", 60))
                if (now - open_time).total_seconds() > dur + 120:
                    stale.append((tid, info))
            except Exception:
                continue

        closed_any = False
        for tid, info in stale:
            outcome, profit = await self._resolve_from_closed_deals(tid)

            # Idempotency: if monitor_trade resolved it during our await, skip.
            if self.active_trades.pop(tid, None) is None:
                continue

            if outcome == "win":
                profit = abs(profit) if profit else self._get_trade_amount() * 0.8
            elif outcome == "draw":
                profit = 0.0
            else:
                outcome = "loss"
                profit = -abs(profit) if profit else -abs(self._get_trade_amount())

            info.update({
                "status": outcome,
                "profit": round(profit, 2),
                "closeTime": datetime.now(timezone.utc).isoformat(),
            })
            self.closed_trades.insert(0, info)
            self.emit("trade_closed", info)
            closed_any = True

        if closed_any:
            if len(self.closed_trades) > 500:
                self.closed_trades = self.closed_trades[:500]
            self.emit_status()

    async def trading_loop(self):
        """Main trading loop — maintains max active trades."""
        self.phase = "trading"
        signal_idx = 0

        while self.running and not self._stop_event.is_set():
            try:
                self.balance = await self.client.balance()
                self.emit("balance_update", {"balance": self.balance})
            except Exception:
                pass

            # Safety net: free up any slot held by a trade that should already
            # have closed (e.g. a hung check_win), so the bot never gets stuck.
            await self._reap_stale_trades()

            active_count = len(self.active_trades)
            max_trades = int(self.settings["maxActiveTrades"])
            slots = max_trades - active_count

            if slots > 0 and self.top_signals:
                for _ in range(slots):
                    if not self.running or self._stop_event.is_set():
                        break
                    if not self.top_signals:
                        break
                    signal = self.top_signals[signal_idx % len(self.top_signals)]
                    signal_idx += 1
                    await self.place_trade(signal)
                    await asyncio.sleep(0.5)

            self.emit_status()
            await asyncio.sleep(3.0)

            if signal_idx > 0 and signal_idx % 40 == 0:
                self.markets = []
                await self.run_analysis()
                signal_idx = 0

        self.phase = "idle"
        self.emit_status()

    async def start(self):
        if not self.connected or self.running:
            return
        self.running = True
        self._stop_event.clear()
        self.markets = []
        self.top_signals = []

        signals = await self.run_analysis()
        if not signals:
            self.emit("error", {"message": "No viable signals found during analysis. Check SSID and connection."})
            self.running = False
            self.phase = "idle"
            self.emit_status()
            return

        await self.trading_loop()

    async def stop(self):
        self.running = False
        self._stop_event.set()
        self.phase = "stopping"
        self.emit_status()
        for t in self._trade_tasks:
            if not t.done():
                t.cancel()
        self._trade_tasks = []
        self.phase = "idle"
        self.emit_status()


# ─── Main loop: read commands from stdin ──────────────────────────────────────

async def main():
    bot = TradingBot()
    bot.emit("ready", {"message": "Bot process started"})

    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    async def read_commands():
        while True:
            try:
                line = await reader.readline()
                if not line:
                    break
                line = line.decode().strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    cmd = msg.get("command")
                    if cmd == "connect":
                        asyncio.create_task(bot.connect(
                            msg.get("ssid", ""),
                            msg.get("balance_type", "demo")
                        ))
                    elif cmd == "start":
                        settings = msg.get("settings", {})
                        bot.settings.update(settings)
                        asyncio.create_task(bot.start())
                    elif cmd == "stop":
                        asyncio.create_task(bot.stop())
                    elif cmd == "disconnect":
                        asyncio.create_task(bot.disconnect())
                    elif cmd == "update_settings":
                        bot.settings.update(msg.get("settings", {}))
                    elif cmd == "get_status":
                        bot.emit_status()
                    elif cmd == "get_markets":
                        bot.emit("market_update", bot.markets)
                    elif cmd == "get_analysis":
                        bot.emit("analysis_update", {
                            "status": bot.analysis_status,
                            "progress": bot.analysis_progress,
                            "topMarkets": bot.top_signals,
                            "lastUpdated": datetime.now(timezone.utc).isoformat(),
                            "methodsUsed": [],
                        })
                except json.JSONDecodeError:
                    pass
            except Exception as e:
                logger.error(f"Command read error: {e}")
                break

    await read_commands()


if __name__ == "__main__":
    asyncio.run(main())
