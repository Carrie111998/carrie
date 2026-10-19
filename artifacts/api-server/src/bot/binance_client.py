"""
Minimal Binance Spot REST client (stdlib only) plus an offline simulator.

- Market data comes from the public endpoint (no key needed).
- Signed endpoints (account, orders) use HMAC-SHA256 with the user's API key/secret.
- Testnet (https://testnet.binance.vision) is supported for safe live-order testing.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal, ROUND_DOWN
from typing import Dict, List, Optional

import numpy as np

PUBLIC_DATA_URLS = ["https://data-api.binance.vision", "https://api.binance.com"]
LIVE_URL = "https://api.binance.com"
TESTNET_URL = "https://testnet.binance.vision"


class BinanceError(Exception):
    pass


def _http(method: str, url: str, headers: Optional[dict] = None, timeout: float = 10.0):
    req = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            msg = json.loads(body).get("msg", body)
        except Exception:
            msg = body
        if e.code == 401 or "-2015" in body:
            msg += (" — check: (1) the Testnet switch matches the key (testnet.binance.vision keys need Testnet ON),"
                    " (2) the key's IP whitelist includes this server, (3) 'Enable Reading' and 'Enable Spot & Margin"
                    " Trading' are ticked. For Binance Prediction Market no API key is needed — use Settings → Prediction Market.")
        raise BinanceError(f"HTTP {e.code}: {msg}") from None
    except urllib.error.URLError as e:
        raise BinanceError(f"Network error: {e.reason}") from None


def klines_to_arrays(rows: list) -> Dict[str, np.ndarray]:
    a = np.array([[float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[0])] for r in rows])
    return {"open": a[:, 0], "high": a[:, 1], "low": a[:, 2], "close": a[:, 3], "volume": a[:, 4], "time": a[:, 5]}


INTERVAL_SECONDS = {"1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400}


class MarketData:
    """Public market data with automatic fallback between Binance hosts."""

    def __init__(self):
        self.base_idx = 0

    def _get(self, path: str, params: dict):
        last: Optional[Exception] = None
        for i in range(len(PUBLIC_DATA_URLS)):
            base = PUBLIC_DATA_URLS[(self.base_idx + i) % len(PUBLIC_DATA_URLS)]
            try:
                out = _http("GET", f"{base}{path}?{urllib.parse.urlencode(params)}")
                self.base_idx = (self.base_idx + i) % len(PUBLIC_DATA_URLS)
                return out
            except BinanceError as e:
                last = e
                if "HTTP 4" in str(e) and "HTTP 451" not in str(e) and "HTTP 403" not in str(e):
                    raise  # real request error (bad symbol etc.)
        raise last or BinanceError("No market data host reachable")

    def klines(self, symbol: str, interval: str, limit: int = 300) -> Dict[str, np.ndarray]:
        return klines_to_arrays(self._get("/api/v3/klines", {"symbol": symbol, "interval": interval, "limit": limit}))

    def klines_range(self, symbol: str, interval: str, total: int) -> Dict[str, np.ndarray]:
        """Fetch up to `total` candles by paging backwards (max 1000 per request)."""
        rows: list = []
        end: Optional[int] = None
        while len(rows) < total:
            params = {"symbol": symbol, "interval": interval, "limit": min(1000, total - len(rows))}
            if end is not None:
                params["endTime"] = end
            batch = self._get("/api/v3/klines", params)
            if not batch:
                break
            rows = batch + rows
            end = int(batch[0][0]) - 1
            if len(batch) < params["limit"]:
                break
        return klines_to_arrays(rows)


class SimulatedMarket:
    """Offline random-walk market (testing only, BOT_SIMULATE=1). Candles follow the real
    clock, so slots and countdowns behave like live Binance data."""

    def __init__(self, seed: int = 7):
        self.rng = random.Random(seed)
        self.series: Dict[str, Dict[str, list]] = {}
        self.last_price: Dict[str, float] = {}

    def _step(self, interval: str) -> int:
        return INTERVAL_SECONDS.get(interval, 300) * 1000

    def _ensure(self, symbol: str, interval: str, n: int) -> list:
        step = self._step(interval)
        cur = int(time.time() * 1000) // step * step
        s = self.series.setdefault(symbol, {}).setdefault(interval, [])
        if not s:
            price = self.last_price.get(symbol) or (82_000.0 if symbol.startswith("BTC") else 100 + self.rng.random() * 900)
            drift = 0.0
            for i in range(n):
                if self.rng.random() < 0.05:
                    drift = self.rng.choice([-1, 0, 0, 1]) * 0.0008
                o = price
                price = o * (1 + drift + self.rng.gauss(0, 0.003))
                s.append([o, max(o, price) * 1.0005, min(o, price) * 0.9995, price, 500 + self.rng.random() * 1500,
                          cur - (n - 1 - i) * step])
        while s[-1][5] < cur:
            o = s[-1][3]
            s.append([o, o, o, o, 500 + self.rng.random() * 1500, s[-1][5] + step])
        last = s[-1]  # the forming candle keeps moving between scans
        last[3] = last[3] * (1 + self.rng.gauss(0, 0.0008))
        last[1], last[2] = max(last[1], last[3]), min(last[2], last[3])
        self.last_price[symbol] = last[3]
        del s[:-1500]
        return s

    def klines(self, symbol: str, interval: str, limit: int = 300):
        a = np.array(self._ensure(symbol, interval, max(limit, 300))[-limit:])
        return {"open": a[:, 0], "high": a[:, 1], "low": a[:, 2], "close": a[:, 3], "volume": a[:, 4], "time": a[:, 5]}

    def klines_range(self, symbol: str, interval: str, total: int):
        return self.klines(symbol, interval, min(total, 1500)) if total <= 1500 else self.klines(symbol, interval, 1500)


class SpotTrader:
    """Signed Binance Spot API (real or testnet orders)."""

    def __init__(self, api_key: str, api_secret: str, testnet: bool):
        self.key = api_key.strip()
        self.secret = api_secret.strip().encode()
        self.base = TESTNET_URL if testnet else LIVE_URL
        self.testnet = testnet
        self.time_offset = 0
        self.filters: Dict[str, dict] = {}

    def _signed(self, method: str, path: str, params: Optional[dict] = None):
        params = dict(params or {})
        params["timestamp"] = int(time.time() * 1000) + self.time_offset
        params["recvWindow"] = 10000
        qs = urllib.parse.urlencode(params)
        sig = hmac.new(self.secret, qs.encode(), hashlib.sha256).hexdigest()
        return _http(method, f"{self.base}{path}?{qs}&signature={sig}", headers={"X-MBX-APIKEY": self.key})

    def sync_time(self):
        server = _http("GET", f"{self.base}/api/v3/time")["serverTime"]
        self.time_offset = int(server - time.time() * 1000)

    def account(self) -> dict:
        return self._signed("GET", "/api/v3/account", {"omitZeroBalances": "true"})

    def free_balance(self, asset: str = "USDT") -> float:
        for b in self.account().get("balances", []):
            if b["asset"] == asset:
                return float(b["free"])
        return 0.0

    def load_filters(self, symbol: str) -> dict:
        if symbol in self.filters:
            return self.filters[symbol]
        info = _http("GET", f"{self.base}/api/v3/exchangeInfo?symbol={symbol}")
        s = info["symbols"][0]
        f = {"baseAsset": s["baseAsset"], "quoteAsset": s["quoteAsset"], "stepSize": "0.00000001", "minNotional": 5.0, "minQty": 0.0}
        for flt in s["filters"]:
            if flt["filterType"] == "LOT_SIZE":
                f["stepSize"] = flt["stepSize"]
                f["minQty"] = float(flt["minQty"])
            elif flt["filterType"] in ("NOTIONAL", "MIN_NOTIONAL"):
                f["minNotional"] = float(flt.get("minNotional", 5.0))
        self.filters[symbol] = f
        return f

    @staticmethod
    def round_step(qty: float, step: str) -> str:
        d = Decimal(str(qty)).quantize(Decimal(step).normalize(), rounding=ROUND_DOWN)
        return format(d, "f")

    def market_buy(self, symbol: str, quote_amount: float) -> dict:
        f = self.load_filters(symbol)
        if quote_amount < f["minNotional"]:
            raise BinanceError(
                f"live order size {quote_amount:g} USDT is below Binance's minimum of {f['minNotional']:g} USDT for {symbol} "
                f"— raise 'Live order size' in Settings")
        r = self._signed("POST", "/api/v3/order", {
            "symbol": symbol, "side": "BUY", "type": "MARKET",
            "quoteOrderQty": f"{quote_amount:.2f}", "newOrderRespType": "FULL",
        })
        qty = float(r["executedQty"])
        # commission charged in the base asset reduces what we can sell later
        fee_base = sum(float(x["commission"]) for x in r.get("fills", []) if x["commissionAsset"] == f["baseAsset"])
        quote = float(r["cummulativeQuoteQty"])
        return {"orderId": r["orderId"], "qty": max(0.0, qty - fee_base), "price": quote / qty if qty else 0.0, "quote": quote}

    def market_sell(self, symbol: str, qty: float) -> dict:
        f = self.load_filters(symbol)
        q = self.round_step(qty, f["stepSize"])
        if float(q) <= 0 or float(q) < f["minQty"]:
            raise BinanceError(f"Sell quantity {q} too small for {symbol}")
        r = self._signed("POST", "/api/v3/order", {
            "symbol": symbol, "side": "SELL", "type": "MARKET", "quantity": q, "newOrderRespType": "FULL",
        })
        sold = float(r["executedQty"])
        quote = float(r["cummulativeQuoteQty"])
        fee_quote = sum(float(x["commission"]) for x in r.get("fills", []) if x["commissionAsset"] == f["quoteAsset"])
        return {"orderId": r["orderId"], "qty": sold, "price": quote / sold if sold else 0.0, "quote": quote - fee_quote}


class SimulatedTrader:
    """Stands in for SpotTrader when BOT_SIMULATE=1 so the live path can be tested offline."""

    def __init__(self, market: SimulatedMarket):
        self.market = market
        self.testnet = True
        self.usdt = 1000.0

    def sync_time(self):
        pass

    def free_balance(self, asset: str = "USDT") -> float:
        return self.usdt

    def account(self) -> dict:
        return {"canTrade": True, "balances": [{"asset": "USDT", "free": str(self.usdt), "locked": "0"}]}

    def _price(self, symbol):
        return self.market.last_price[symbol]

    def market_buy(self, symbol, quote_amount):
        p = self._price(symbol)
        self.usdt -= quote_amount
        return {"orderId": int(time.time() * 1000), "qty": quote_amount / p * 0.999, "price": p, "quote": quote_amount}

    def market_sell(self, symbol, qty):
        p = self._price(symbol)
        self.usdt += qty * p * 0.999
        return {"orderId": int(time.time() * 1000), "qty": qty, "price": p, "quote": qty * p * 0.999}
