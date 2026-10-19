"""
Binance Prediction Trading REST API (API key) — an alternative to the Agentic Wallet CLI.

Official docs: https://developers.binance.com/en/docs/catalog/web3-wallet-prediction-trading/api/rest-api
Signed SAPI endpoints under /sapi/v1/w3w/wallet/prediction/*, HMAC-SHA256 like every Binance API.

Requirements on the Binance account (the API answers with an error otherwise):
  - identity verification done and a Prediction account opened in the Binance app,
  - Prediction SAS authorization completed in the Binance app (needed to place orders and redeem),
  - "Prediction Trading" permission enabled on the API key (API Management).

Exposes the same methods as prediction_market.PredictionClient, so the bot can use either.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from prediction_market import BSC_CHAIN_ID, PredictionError, find_markets

BASE_URL = "https://api.binance.com"
PREFIX = "/sapi/v1/w3w/wallet/prediction"
WEI = 10 ** 18  # amounts are in wei (18 decimals): 1 USDT = 10^18

HINTS = {
    -31003: "SAS authorization required — complete Prediction SAS authorization in the Binance app",
    -2015: "API key rejected — enable the 'Prediction Trading' permission on this key and check its IP whitelist",
    -2014: "API key format invalid",
    -1022: "signature invalid — check the API secret",
    -3026: "Binance rejected a parameter (wallet address, amount below the minimum, or market closed)",
}


def _wei(amount: float) -> str:
    return str(int(round(amount * WEI)))


def _from_wei(v: Any) -> float:
    try:
        return int(str(v)) / WEI
    except (TypeError, ValueError):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0


class PredictionApiClient:
    """Prediction betting with the user's Binance API key."""

    def __init__(self, api_key: str, api_secret: str, funding: str = "MPC"):
        self.key = api_key.strip()
        self.secret = api_secret.strip().encode()
        self.funding = "CEX" if str(funding).upper() == "CEX" else "MPC"
        self.time_offset = 0
        self._wallet: Optional[Tuple[str, str]] = None
        self._markets_cache: Tuple[float, str, List[dict], Any] = (0.0, "", [], None)
        self._slippage: Dict[str, int] = {}

    # ─── HTTP ────────────────────────────────────────────────────────────────

    def _request(self, method: str, path: str, params: Optional[dict] = None, retry: bool = True) -> Any:
        params = {k: v for k, v in (params or {}).items() if v is not None}
        params["timestamp"] = int(time.time() * 1000) + self.time_offset
        params["recvWindow"] = 10000
        payload = urllib.parse.urlencode(params, doseq=True)  # lists → repeated keys (tokenIds=1&tokenIds=2)
        sig = hmac.new(self.secret, payload.encode(), hashlib.sha256).hexdigest()
        signed = f"{payload}&signature={sig}"
        headers = {"X-MBX-APIKEY": self.key}
        if method == "GET":
            req = urllib.request.Request(f"{BASE_URL}{PREFIX}{path}?{signed}", method="GET", headers=headers)
        else:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            req = urllib.request.Request(f"{BASE_URL}{PREFIX}{path}", data=signed.encode(), method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode()
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            try:
                err = json.loads(body)
            except Exception:
                raise PredictionError(f"HTTP {e.code}: {body[:200]}") from None
            code = err.get("code")
            if code == -1021 and retry:  # clock drift: sync with Binance and try once more
                self._sync_time()
                return self._request(method, path, {k: v for k, v in params.items() if k not in ("timestamp", "recvWindow")}, retry=False)
            hint = HINTS.get(code)
            raise PredictionError(f"{code}: {err.get('msg', body[:200])}" + (f" — {hint}" if hint else "")) from None
        except urllib.error.URLError as e:
            raise PredictionError(f"Network error: {e.reason}") from None
        data = json.loads(body) if body else {}
        # some SAPI responses wrap the payload as {"code":"000000","data":...}
        if isinstance(data, dict) and "data" in data and set(data) <= {"code", "message", "msg", "data", "success", "messageDetail"}:
            if data.get("success") is False:
                raise PredictionError(str(data.get("message") or data.get("msg") or "request failed"))
            return data["data"]
        return data

    def _sync_time(self):
        try:
            with urllib.request.urlopen(f"{BASE_URL}/api/v3/time", timeout=10) as resp:
                self.time_offset = int(json.loads(resp.read().decode())["serverTime"] - time.time() * 1000)
        except Exception:
            pass

    # ─── Wallet ──────────────────────────────────────────────────────────────

    def wallet(self) -> Tuple[str, str]:
        if not self._wallet:
            data = self._request("GET", "/wallet/list")
            wallets = (data or {}).get("wallets") if isinstance(data, dict) else data
            if not wallets:
                raise PredictionError("no Prediction wallet on this Binance account — open a Prediction account in the Binance app first")
            w = wallets[0]
            self._wallet = (str(w["walletAddress"]), str(w["walletId"]))
        return self._wallet

    def status(self) -> str:
        self.wallet()
        return "CONNECTED"

    def usdt_balance(self) -> float:
        """Balance the bets are paid from: the Prediction wallet (MPC) or the Binance Spot account (CEX)."""
        try:
            data = self._request("GET", "/balance/payment-options")
            items = (data or {}).get("items", []) if isinstance(data, dict) else data or []
            want = ("SPOT",) if self.funding == "CEX" else ("MPC", "PREDICTION", "WALLET", "WEB3")
            for it in items:
                if str(it.get("accountType", "")).upper() in want:
                    return float(str(it.get("availableBalanceDisplay") or 0).replace(",", "") or 0)
        except PredictionError:
            if self.funding == "CEX":
                raise
        address, _ = self.wallet()
        data = self._request("GET", "/position/list", {"walletAddress": address, "limit": 1})
        return float(str(((data or {}).get("summary") or {}).get("walletBalance") or 0).replace(",", "") or 0)

    # ─── Markets ─────────────────────────────────────────────────────────────

    def search(self, query: str, max_age: float = 20) -> Tuple[List[dict], Any]:
        ts, q, markets, raw = self._markets_cache
        if q == query and time.time() - ts < max_age:
            return markets, raw
        raw = self._request("GET", "/market/search", {"query": query, "topK": 50})
        markets = find_markets(raw)
        self._remember_slippage(raw)
        self._markets_cache = (time.time(), query, markets, raw)
        return markets, raw

    def market_detail(self, topic_id: str) -> List[dict]:
        raw = self._request("GET", "/market/detail", {"marketTopicId": topic_id})
        self._remember_slippage(raw)
        return find_markets(raw)

    def _remember_slippage(self, raw: Any):
        for t in raw if isinstance(raw, list) else [raw]:
            if isinstance(t, dict) and t.get("marketTopicId") and t.get("slippageBps"):
                self._slippage[str(t["marketTopicId"])] = int(t["slippageBps"])

    # ─── Trading ─────────────────────────────────────────────────────────────

    def quote(self, market: dict, outcome: dict, amount_usdt: float) -> dict:
        address, _ = self.wallet()
        slippage = self._slippage.get(str(market["marketTopicId"]), 1000)
        q = self._request("POST", "/trade/get-quote", {
            "walletAddress": address, "tokenId": outcome["tokenId"], "side": "BUY", "amountIn": _wei(amount_usdt),
            "orderType": "MARKET", "slippageBps": slippage, "chainId": market.get("chainId") or BSC_CHAIN_ID,
            "fundingSource": self.funding,
        }) or {}
        if not q.get("quoteId"):
            raise PredictionError(f"no quote returned: {json.dumps(q)[:200]}")
        # same shape the bot expects from the CLI: amountOut = shares (each winning share pays 1 USDT)
        return {**q, "amountOut": _from_wei(q.get("amountOut")), "feeAmount": _from_wei(q.get("feeAmount")),
                "slippageBps": int(q.get("slippageBps") or slippage)}

    def place(self, quote: dict) -> dict:
        address, wallet_id = self.wallet()
        r = self._request("POST", "/trade/place-order-bundle", {
            "walletAddress": address, "walletId": wallet_id, "quoteId": str(quote["quoteId"]),
            "timeInForce": "FOK", "accountType": "SPOT", "orderType": "MARKET",
            "slippageBps": int(quote.get("slippageBps") or 1000), "fundingSource": self.funding,
        }) or {}
        if not r.get("orderId"):
            raise PredictionError(f"order not accepted: {json.dumps(r)[:200]}")
        return r

    def redeem_all(self) -> int:
        address, wallet_id = self.wallet()
        data = self._request("GET", "/position/list", {"walletAddress": address, "tab": "PENDING_CLAIM", "limit": 100})
        by_chain: Dict[str, List[str]] = {}
        for p in (data or {}).get("positions", []) if isinstance(data, dict) else []:
            if p.get("tokenId") and p.get("canClaim", True):
                by_chain.setdefault(str(p.get("chainId") or BSC_CHAIN_ID), []).append(str(p["tokenId"]))
        for chain, tokens in by_chain.items():
            self._request("POST", "/batch-redeem", {
                "walletAddress": address, "walletId": wallet_id, "tokenIds": sorted(set(tokens)), "chainId": chain,
            })
        return sum(len(set(t)) for t in by_chain.values())
