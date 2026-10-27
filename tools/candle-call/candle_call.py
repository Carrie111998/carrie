#!/usr/bin/env python3
"""
Candle Call — local live page for BTC / ETH / BNB 5m and 15m Up-or-Down calls.

Run:   python3 candle_call.py            (Python 3.8+, nothing to install)
Open:  http://localhost:8765             on this computer
       http://<this computer's IP>:8765  on a phone on the same Wi-Fi (the address is printed at start)

Candles come from Binance's free public market data. Binance Prediction odds need a Binance API key with the
"Prediction Trading" permission (Binance only serves them through its signed Prediction API); set them first:
    export BINANCE_API_KEY=...  BINANCE_API_SECRET=...      (Windows PowerShell: $env:BINANCE_API_KEY="...")
Without a key the page still shows both calls; only the odds panel stays empty.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", "8765"))
HERE = Path(__file__).resolve().parent
COINS = ("BTC", "ETH", "BNB")
INTERVALS = {"5m": 300_000, "15m": 900_000}
DATA_HOSTS = ("https://data-api.binance.vision", "https://api.binance.com")
SAPI = "https://api.binance.com/sapi/v1/w3w/wallet/prediction"
KEY = os.environ.get("BINANCE_API_KEY", "").strip()
SECRET = os.environ.get("BINANCE_API_SECRET", "").strip().encode()


def http_json(url: str, headers: dict | None = None, timeout: float = 10):
    req = urllib.request.Request(url, headers={"User-Agent": "candle-call/1.0", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            err = json.loads(body)
        except ValueError:
            err = {"msg": body[:200]}
        raise RuntimeError(f"HTTP {e.code}: {err.get('code', '')} {err.get('msg') or err.get('message') or ''}".strip()) from None


# ─── Candles (public, free) ──────────────────────────────────────────────────

_kcache: dict = {}


def klines(symbol: str, interval: str, limit: int = 1000):
    key = (symbol, interval, limit)
    hit = _kcache.get(key)
    if hit and time.time() - hit[0] < 5:
        return hit[1]
    last = None
    for host in DATA_HOSTS:
        try:
            rows = http_json(f"{host}/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}")
            _kcache[key] = (time.time(), rows)
            return rows
        except Exception as e:  # try the other host
            last = e
    raise RuntimeError(f"Binance market data unavailable: {last}")


# ─── Binance Prediction odds (signed Prediction Trading API) ──────────────────

_time_offset = 0


def sapi(path: str, params: dict, retry: bool = True):
    global _time_offset
    q = dict(params, timestamp=int(time.time() * 1000) + _time_offset, recvWindow=10000)
    payload = urllib.parse.urlencode(q)
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    try:
        data = http_json(f"{SAPI}{path}?{payload}&signature={sig}", {"X-MBX-APIKEY": KEY})
    except RuntimeError as e:
        if "-1021" in str(e) and retry:  # clock drift: sync with Binance once
            t = http_json("https://api.binance.com/api/v3/time")["serverTime"]
            _time_offset = int(t - time.time() * 1000)
            return sapi(path, params, retry=False)
        raise
    # some SAPI answers wrap the payload as {"code": "000000", "data": ...}
    if isinstance(data, dict) and "data" in data and set(data) <= {"code", "message", "msg", "data", "success", "messageDetail"}:
        return data["data"]
    return data


def as_list(v):
    if isinstance(v, list):
        return v
    if isinstance(v, dict):
        for k in ("list", "topics", "items", "data", "rows"):
            if isinstance(v.get(k), list):
                return v[k]
        return [v]
    return []


def num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def to_ms(v):
    n = num(v)
    return None if n is None else int(n if n > 1e12 else n * 1000)


def outcome_prices(topic: dict):
    up = down = None
    for m in topic.get("markets") or []:
        for o in m.get("outcomes") or []:
            name = str(o.get("name", "")).lower()
            if name.startswith("up"):
                up = num(o.get("price") or o.get("chance"))
            elif name.startswith("down"):
                down = num(o.get("price") or o.get("chance"))
    return up, down


def round_for(coin: str, tf: str, topics: list):
    """The round of the "<COIN> Up or Down <tf>" series that is running now (each round is its own market topic)."""
    step = INTERVALS[tf]
    start = int(time.time() * 1000) // step * step
    title = f"{coin} Up or Down {tf}".lower()
    series = [t for t in topics if str(t.get("title", "")).strip().lower() == title]
    if not series:
        return None
    topic = series[0]
    if abs((to_ms(topic.get("endDate")) or 0) - (start + step)) > 90_000:
        detail = sapi("/market/detail", {"marketTopicId": topic["marketTopicId"]})
        rnd = next((r for r in detail.get("timeline") or [] if abs((to_ms(r.get("endDate")) or 0) - (start + step)) <= 90_000), None)
        topic = sapi("/market/detail", {"marketTopicId": rnd["marketTopicId"]}) if rnd else detail
    elif not topic.get("markets"):
        topic = sapi("/market/detail", {"marketTopicId": topic["marketTopicId"]})
    up, down = outcome_prices(topic)
    if up is None or down is None:
        return None
    return {"up": up, "down": down, "beat": num((topic.get("variantData") or {}).get("startPrice")),
            "start": to_ms(topic.get("startDate")), "end": to_ms(topic.get("endDate"))}


_odds = {"at": 0.0, "data": None}
_odds_lock = threading.Lock()


def odds():
    if not KEY or not SECRET:
        return {"markets": {}, "error": "no_key"}
    with _odds_lock:
        if _odds["data"] and time.time() - _odds["at"] < 15:
            return _odds["data"]
        out, err = {}, None
        for coin in COINS:
            try:
                topics = as_list(sapi("/market/search", {"query": coin, "topK": 50}))
                for tf in INTERVALS:
                    r = round_for(coin, tf, topics)
                    if r:
                        out[f"{coin}|{tf}"] = r
            except Exception as e:
                err = str(e)[:200]
        data = {"markets": out, "at": int(time.time() * 1000), **({"error": err} if err and not out else {})}
        _odds.update(at=time.time(), data=data)
        return data


# ─── Web server ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def json(self, obj, code: int = 200):
        self.send(code, json.dumps(obj).encode(), "application/json")

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        try:
            if url.path in ("/", "/index.html"):
                return self.send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
            if url.path == "/api/klines":
                coin = (q.get("coin") or [""])[0].upper()
                tf = (q.get("interval") or [""])[0]
                if coin not in COINS or tf not in INTERVALS:
                    return self.json({"error": "coin must be BTC/ETH/BNB, interval 5m/15m"}, 400)
                return self.json(klines(f"{coin}USDT", tf))
            if url.path == "/favicon.ico":
                return self.send(204, b"", "image/x-icon")
            if url.path == "/api/odds":
                return self.json(odds())
            return self.json({"error": "not found"}, 404)
        except Exception as e:
            return self.json({"error": str(e)[:300]}, 502)


def lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))  # no packet is sent; this only picks the outgoing interface
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Candle Call is running.\n  This computer:     http://localhost:{PORT}\n  Phone (same Wi-Fi): http://{lan_ip()}:{PORT}")
    print("  Binance Prediction odds:", "on (API key found)" if KEY and SECRET else "off — set BINANCE_API_KEY and BINANCE_API_SECRET to show them")
    print("Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
