"""
Binance Prediction Market connector (via Binance Agentic Wallet `baw` CLI).

The wallet is signed in once from the dashboard (pairing code confirmed in the
Binance App). Bets are paid in USDT on BSC. Every command is run with `--json`.

Market listings are parsed defensively: the bot looks for the market whose
end time matches the current slot and for outcome tokens labelled Up/Down.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional, Tuple

BSC_CHAIN_ID = "56"


class PredictionError(Exception):
    pass


def baw_path() -> str:
    return os.environ.get("BAW_BIN") or "baw"


def run_baw(baw_dir: str, args: List[str], timeout: float = 60) -> Any:
    env = dict(os.environ, BINANCE_BAW_DIR=baw_dir)
    os.makedirs(baw_dir, exist_ok=True)
    try:
        # stdin=DEVNULL: the CLI must never touch the bot's own stdin (the command pipe from the server);
        # sharing it let the CLI break the pipe and the bot engine shut down.
        out = subprocess.run([baw_path(), *args, "--json"], capture_output=True, text=True, timeout=timeout, env=env,
                             stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise PredictionError("Binance Agentic Wallet CLI (baw) is not installed on the server") from None
    except subprocess.TimeoutExpired:
        raise PredictionError(f"baw {' '.join(args[:3])} timed out") from None
    text = (out.stdout or "").strip()
    try:
        res = json.loads(text[text.index("{"):]) if "{" in text else None
    except ValueError:
        res = None
    if not isinstance(res, dict):
        raise PredictionError(f"baw {' '.join(args[:3])}: unexpected output {text[:200] or out.stderr[:200]}")
    if not res.get("success"):
        err = res.get("error") or {}
        raise PredictionError(f"{err.get('name', 'ERROR')}: {err.get('message', 'request failed')}")
    return res.get("data")


# ─── Defensive parsing helpers ───────────────────────────────────────────────

TITLE_KEYS = ("title", "question", "marketTitle", "topicTitle", "name", "outcome", "outcomeName", "label")
END_KEYS = ("endDate", "endTime", "closeTime", "resolveTime", "expireTime", "eventEndTime", "endAt", "deadline")
START_KEYS = ("startDate", "startTime", "openTime", "eventStartTime", "startAt")


def _walk(obj: Any, parents: Tuple[dict, ...] = ()) -> Iterator[Tuple[dict, Tuple[dict, ...]]]:
    if isinstance(obj, dict):
        yield obj, parents
        for v in obj.values():
            yield from _walk(v, parents + (obj,))
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v, parents)


def _title(d: dict) -> str:
    for k in TITLE_KEYS:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _to_ms(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) or (isinstance(v, str) and v.isdigit()):
        n = float(v)
        return int(n if n > 1e12 else n * 1000)
    if isinstance(v, str):
        try:
            return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return None
    return None


def _first_time(d: dict, keys) -> Optional[int]:
    for k in keys:
        t = _to_ms(d.get(k))
        if t:
            return t
    return None


def find_markets(data: Any) -> List[dict]:
    """Normalise any market list/search/detail payload into
    [{marketTopicId, title, endTime, startTime, chainId, outcomes:[{tokenId, label, marketId}]}]."""
    topics: Dict[str, dict] = {}
    for d, parents in _walk(data):
        topic_id = d.get("marketTopicId") or d.get("topicId")
        if topic_id is None and "tokenId" in d:
            # outcome without its own topic id: take the nearest parent that has one
            for p in reversed(parents):
                topic_id = p.get("marketTopicId") or p.get("topicId")
                if topic_id is not None:
                    break
        if topic_id is None:
            continue
        key = str(topic_id)
        topic_dict = next((p for p in reversed(parents + (d,)) if str(p.get("marketTopicId") or p.get("topicId") or "") == key), d)
        t = topics.setdefault(key, {
            "marketTopicId": key, "title": _title(topic_dict), "endTime": _first_time(topic_dict, END_KEYS),
            "startTime": _first_time(topic_dict, START_KEYS),
            "chainId": str(topic_dict.get("binanceChainId") or topic_dict.get("chainId") or BSC_CHAIN_ID),
            "outcomes": [],
        })
        t["endTime"] = t["endTime"] or _first_time(d, END_KEYS)
        t["startTime"] = t["startTime"] or _first_time(d, START_KEYS)
        if "tokenId" in d and d.get("tokenId") not in (None, ""):
            label = _title(d)
            if label.lower() in ("yes", "no"):
                # multi-outcome markets: each outcome is a yes/no market, e.g. "Up" → Yes/No
                parent_title = next((_title(p) for p in reversed(parents) if _title(p) and p is not topic_dict), "")
                label = f"{parent_title} {label}".strip()
            market_id = d.get("marketId") or next((p.get("marketId") for p in reversed(parents) if p.get("marketId")), None)
            tok = str(d["tokenId"])
            if not any(o["tokenId"] == tok for o in t["outcomes"]):
                t["outcomes"].append({"tokenId": tok, "label": label, "marketId": str(market_id) if market_id else None})
    return list(topics.values())


UP_RE = re.compile(r"\b(up|higher|above|rise|increase)\b", re.I)
DOWN_RE = re.compile(r"\b(down|lower|below|fall|decrease)\b", re.I)


def pick_outcome(market: dict, direction: str) -> Optional[dict]:
    want, avoid = (UP_RE, DOWN_RE) if direction == "long" else (DOWN_RE, UP_RE)
    cands = [o for o in market["outcomes"] if want.search(o["label"]) and not avoid.search(o["label"])]
    # in yes/no style prefer the "Yes" share of the matching outcome
    yes = [o for o in cands if re.search(r"\byes\b", o["label"], re.I)]
    no_free = [o for o in cands if not re.search(r"\bno\b", o["label"], re.I)]
    return (yes or no_free or [None])[0]


def match_slot_market(markets: List[dict], symbol_words: List[str], slot_end_ms: int, tolerance_ms: int = 90_000,
                      timeframe: Optional[str] = None) -> Optional[dict]:
    """Find the Up/Down market for this coin and slot.

    Binance runs recurring series titled e.g. "ETH Up or Down 5m". Prefer a market whose end time
    matches the slot; otherwise accept the series whose title names the coin and the slot length
    (e.g. "5m") — the caller then loads its details and checks the current round's end time."""
    words = [w.lower() for w in symbol_words]
    tf = (timeframe or "").lower()
    coin = [m for m in markets if any(w in m["title"].lower() for w in words)]
    if tf:
        named = [m for m in coin if re.search(rf"(?<![0-9]){re.escape(tf)}\b", m["title"].lower())]
        if named:
            coin = named
    timed = [m for m in coin if m["endTime"] and abs(m["endTime"] - slot_end_ms) <= tolerance_ms]
    if timed:
        return min(timed, key=lambda m: abs(m["endTime"] - slot_end_ms))
    if tf:
        series = [m for m in coin if "up" in m["title"].lower() and "down" in m["title"].lower()
                  and re.search(rf"(?<![0-9]){re.escape(tf)}\b", m["title"].lower())]
        if series:
            return dict(series[0], needsRoundCheck=True)
    return None


def symbol_words(symbol: str) -> List[str]:
    base = symbol.upper().replace("USDT", "").replace("USDC", "")
    names = {"BTC": ["btc", "bitcoin"], "ETH": ["eth", "ethereum"], "BNB": ["bnb"], "SOL": ["sol", "solana"],
             "XRP": ["xrp"], "DOGE": ["doge", "dogecoin"]}
    return names.get(base, [base.lower()])


# ─── Wallet / trading ────────────────────────────────────────────────────────

class PredictionClient:
    def __init__(self, baw_dir: str):
        self.dir = baw_dir
        self._markets_cache: Tuple[float, str, List[dict], Any] = (0.0, "", [], None)

    def status(self) -> str:
        data = run_baw(self.dir, ["wallet", "status"], timeout=20)
        return (data or {}).get("status", "UNKNOWN")

    def usdt_balance(self) -> float:
        data = run_baw(self.dir, ["wallet", "balance", "--symbol", "USDT", "--binanceChainId", BSC_CHAIN_ID], timeout=30)
        rows = data if isinstance(data, list) else (data or {}).get("list", []) if isinstance(data, dict) else []
        return sum(float(r.get("balance") or 0) for r in rows if str(r.get("symbol", "")).upper() == "USDT")

    def search(self, query: str, max_age: float = 20) -> Tuple[List[dict], Any]:
        ts, q, markets, raw = self._markets_cache
        if q == query and time.time() - ts < max_age:
            return markets, raw
        raw = run_baw(self.dir, ["prediction", "market", "search", "--query", query, "--limit", "50"], timeout=30)
        markets = find_markets(raw)
        self._markets_cache = (time.time(), query, markets, raw)
        return markets, raw

    def market_detail(self, topic_id: str) -> List[dict]:
        return find_markets(run_baw(self.dir, ["prediction", "market", "detail", "--marketTopicId", topic_id], timeout=30))

    def quote(self, market: dict, outcome: dict, amount_usdt: float) -> dict:
        return run_baw(self.dir, [
            "prediction", "trade", "quote", "--binanceChainId", market.get("chainId") or BSC_CHAIN_ID,
            "--tokenId", outcome["tokenId"], "--marketTopicId", market["marketTopicId"],
            "--side", "BUY", "--amount", f"{amount_usdt:g}", "--orderType", "MARKET",
        ], timeout=30) or {}

    def place(self, quote: dict) -> dict:
        return run_baw(self.dir, [
            "prediction", "trade", "place-order", "--quoteId", str(quote["quoteId"]),
            "--slippageBps", str(quote.get("slippageBps") or 1000), "--orderType", "MARKET",
        ], timeout=60) or {}

    def redeem_all(self) -> int:
        data = run_baw(self.dir, ["prediction", "position", "list", "--tab", "PENDING_CLAIM", "--limit", "100"], timeout=30)
        tokens = sorted({str(d["tokenId"]) for d, _ in _walk(data) if d.get("tokenId")})
        if tokens:
            run_baw(self.dir, ["prediction", "trade", "redeem", "--tokenIds", ",".join(tokens)], timeout=90)
        return len(tokens)
