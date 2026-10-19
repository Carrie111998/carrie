#!/usr/bin/env python3
"""
Binance crypto prediction bot engine.

Spawned by the Express API server. Talks JSON lines:
  stdin  <- {"cmd": "...", ...}
  stdout -> {"type": "...", "data": ...}

Always paper-trades every signal (so it keeps learning), and optionally mirrors
long signals as real Binance Spot market orders when live trading is switched on.
All trades, learning statistics and the paper account are persisted to
<dataDir>/bot_data.json so nothing is lost on restart.
"""

from __future__ import annotations

import json
import os
import queue
import re
import sys
import threading
import time
import traceback
import uuid
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import learner  # noqa: E402
from binance_client import (  # noqa: E402
    INTERVAL_SECONDS, BinanceError, MarketData, SimulatedMarket, SimulatedTrader, SpotTrader,
)
from indicators import AI_KEY, INDICATORS, MIN_CANDLES, compute_votes, market_context  # noqa: E402
from prediction_market import (  # noqa: E402
    PredictionClient, PredictionError, match_slot_market, pick_outcome, symbol_words,
)

SIMULATE = os.environ.get("BOT_SIMULATE") == "1"
MAX_TRADES = 5000
MAX_EQUITY_POINTS = 500


def now_ms() -> int:
    return int(time.time() * 1000)


def emit(type_: str, data=None, **extra):
    msg = {"type": type_, "data": data}
    msg.update(extra)
    sys.stdout.write(json.dumps(msg, default=float) + "\n")
    sys.stdout.flush()


def log(msg: str, level: str = "info"):
    emit("log", {"time": now_ms(), "level": level, "message": msg})


# ─── Default settings (the Node server sends the real ones) ──────────────────

DEFAULT_SETTINGS = {
    "symbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "LTCUSDT"],
    "interval": "5m",
    "scanIntervalSec": 30,
    "predictionHorizon": 3,
    "minConfidence": 62,
    "maxOpenPositions": 5,
    "paperStartBalance": 100.0,
    "paperTradeMode": "fixed",      # "fixed" USDT per trade or "percent" of balance
    "paperTradeAmountUsdt": 1.5,    # fixed bet every round (never raised after a loss); minimum 1 USD
    "paperTradeSizePct": 5.0,
    # "prediction" = dummy Binance Prediction Up/Down bets per slot, "spot" = long/short positions with SL/TP
    "paperMode": "prediction",
    "paperPredictionPrice": 0.5,    # assumed share price of the side we buy (0.50 = fresh 50/50 market)
    "allowShort": True,
    "slAtrMult": 1.5,
    "tpAtrMult": 2.0,
    "maxHoldCandles": 12,
    "minAdx": 0,
    "feePct": 0.1,
    "indicators": {k: {"enabled": True, "weight": 1.0} for k in list(INDICATORS) + [AI_KEY]},
    "indicatorParams": {
        "rsiPeriod": 14, "rsiOversold": 30, "rsiOverbought": 70,
        "macdFast": 12, "macdSlow": 26, "macdSignal": 9,
        "bbPeriod": 20, "bbStd": 2.0, "emaFast": 9, "emaSlow": 21,
        "stochPeriod": 14, "adxPeriod": 14, "atrPeriod": 14,
    },
    "autoTune": True,
    "autoTuneEvery": 5,
    "tuneWeights": True,
    "tuneThreshold": True,
    "tuneRisk": True,
    "tuneFilters": True,
    "blockedSymbols": [],
    "blockedHours": [],
    "liveTradeAmountUsdt": 5.0,
    "liveMaxOpenPositions": 3,
    "liveDailyLossLimitUsdt": 50.0,
    # live venue: "prediction" = Binance Prediction Market (Agentic Wallet), "spot" = Binance Spot API keys
    "liveVenue": "prediction",
    "predictionSymbol": "BTCUSDT",
    "predictionQuery": "BTC",
    "predictionBetUsdt": 1.5,
    "predictionMaxExposureUsdt": 20.0,
    "predictionDryRun": True,
    "predictionAutoRedeem": True,
    # learn from every user's settled trades (anonymous pool built by collective.py)
    "useCommunityLearning": True,
}


def merge_settings(base: dict, patch: dict) -> dict:
    out = json.loads(json.dumps(base))
    for k, v in (patch or {}).items():
        if k in ("indicators", "indicatorParams") and isinstance(v, dict):
            for ik, iv in v.items():
                if isinstance(iv, dict) and isinstance(out[k].get(ik), dict):
                    out[k][ik].update(iv)
                else:
                    out[k][ik] = iv
        else:
            out[k] = v
    return out


class Bot:
    def __init__(self):
        self.settings = merge_settings(DEFAULT_SETTINGS, {})
        self.data_dir: Optional[str] = None
        self.data = self._empty_data()
        self.running = False
        self.live_enabled = False
        self.phase = "idle"
        self.next_cycle = 0.0
        self.last_cycle: Optional[int] = None
        self.cycle_ms: Optional[int] = None
        self.errors: List[dict] = []
        self.signals: Dict[str, dict] = {}
        self.credentials: dict = {}
        self.trader = None
        self.live_account: Optional[dict] = None
        self.sim = SimulatedMarket() if SIMULATE else None
        self.market = self.sim if SIMULATE else MarketData()
        self.study_cache: Optional[dict] = None
        self._new_slots: List[tuple] = []
        self.collective: Optional[dict] = None
        self.collective_mtime = 0.0
        self.pm: Optional[PredictionClient] = None
        self.pm_status: Optional[str] = None
        self.pm_balance_at = 0.0
        self.pm_redeem_at = 0.0
        self.calibrating: Optional[dict] = None

    # ─── Persistence ────────────────────────────────────────────────────────

    def _empty_data(self) -> dict:
        start = float(self.settings["paperStartBalance"]) if hasattr(self, "settings") else 10000.0
        return {
            "version": 1,
            "paper": {"balance": start, "startBalance": start},
            "positions": [],
            "trades": [],
            "equity": [],
            "pending": [],
            "learning": learner.empty_learning(),
            "liveDaily": {},
            "slots": {},
            "predictionBets": [],
        }

    def _path(self):
        return os.path.join(self.data_dir, "bot_data.json") if self.data_dir else None

    def load(self):
        p = self._path()
        if not p or not os.path.exists(p):
            return
        try:
            with open(p) as f:
                d = json.load(f)
            base = self._empty_data()
            base.update(d)
            for k, v in learner.empty_learning().items():
                base["learning"].setdefault(k, v)
            self.data = base
            log(f"Loaded {len(self.data['trades'])} trades and learning data from disk")
        except Exception as e:
            log(f"Could not load saved data ({e}); starting fresh", "warn")

    def save(self):
        p = self._path()
        if not p:
            return
        os.makedirs(self.data_dir, exist_ok=True)
        tmp = p + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.data, f, default=float)
        os.replace(tmp, p)

    # ─── Helpers ────────────────────────────────────────────────────────────

    def params(self) -> dict:
        p = dict(self.settings["indicatorParams"])
        p["horizon"] = self.settings["predictionHorizon"]
        return p

    def enabled(self, key: str) -> bool:
        cfg = self.settings["indicators"].get(key)
        return bool(cfg and cfg.get("enabled", True))

    def weights(self) -> Dict[str, float]:
        return {k: float(v.get("weight", 1.0)) for k, v in self.settings["indicators"].items()}

    @staticmethod
    def unrealized(p: dict, price: Optional[float] = None) -> float:
        price = p["lastPrice"] if price is None else price
        if p.get("kind") == "prediction":
            winning = price > p["entryPrice"] if p["side"] == "long" else price < p["entryPrice"]
            return p["qty"] - p["quote"] if winning else -p["quote"]
        side = 1 if p["side"] == "long" else -1
        return p["qty"] * (price - p["entryPrice"]) * side

    def positions(self, mode: Optional[str] = None):
        return [p for p in self.data["positions"] if mode is None or p["mode"] == mode]

    def add_error(self, msg: str):
        if self.errors and self.errors[0]["message"] == msg:
            self.errors[0]["time"] = now_ms()  # same error again — don't spam the log
            return
        self.errors.insert(0, {"time": now_ms(), "message": msg})
        del self.errors[20:]
        log(msg, "error")

    def analyse(self, c: dict) -> dict:
        votes = compute_votes(c, self.params(), self.enabled)
        if self.enabled(AI_KEY):
            model_src = self.data["learning"]
            col = self.collective if self.settings.get("useCommunityLearning", True) else None
            if col and col.get("model", {}).get("samples", 0) > model_src["model"]["samples"]:
                model_src = {"model": col["model"]}  # community model has seen more outcomes
            ai = learner.ai_vote(model_src, votes)
            if ai is not None:
                votes[AI_KEY] = ai
        direction, confidence, score = learner.combine(votes, self.weights())
        ctx = market_context(c, self.params())
        return {"votes": votes, "direction": direction, "confidence": confidence, "score": score, **ctx}

    # ─── Trading cycle ──────────────────────────────────────────────────────

    def run_cycle(self):
        t0 = time.time()
        self.phase = "scanning"
        s = self.settings
        interval_ms = INTERVAL_SECONDS.get(s["interval"], 300) * 1000
        symbols = list(dict.fromkeys(s["symbols"] + [p["symbol"] for p in self.data["positions"]]))
        candidates = []
        prices: Dict[str, float] = {}
        self._new_slots: List[tuple] = []

        for sym in symbols:
            try:
                c = self.market.klines(sym, s["interval"], 300)
            except BinanceError as e:
                self.add_error(f"{sym}: {e}")
                continue
            except Exception as e:
                self.add_error(f"{sym}: unexpected error {e}")
                continue
            if len(c["close"]) < MIN_CANDLES + 1:
                continue
            price = float(c["close"][-1])
            prices[sym] = price

            self.manage_positions(sym, c, interval_ms)
            self.evaluate_predictions(sym, price)

            closed = {k: v[:-1] for k, v in c.items()}  # signal on closed candles only
            a = self.analyse(closed)
            candle_t = int(c["time"][-1])
            sig = {
                "symbol": sym, "price": price, "time": now_ms(), "candleTime": candle_t,
                "direction": "long" if a["direction"] > 0 else "short" if a["direction"] < 0 else "neutral",
                "confidence": a["confidence"], "score": a["score"], "votes": a["votes"],
                "atr": a["atr"], "adx": round(a["adx"], 1), "rsi": round(a["rsi"], 1), "regime": a["regime"],
                "blocked": sym in s["blockedSymbols"], "reasons": [],
            }
            self.signals[sym] = sig
            if a["direction"] != 0 and a["confidence"] >= 50:
                self.add_prediction(sig, interval_ms)
            if sym in s["symbols"]:
                self.update_slots(sym, c, sig, interval_ms)
            if sym in s["symbols"]:
                candidates.append(sig)

        self.phase = "trading"
        self.open_new_positions(candidates)
        if s.get("paperMode") == "prediction":
            self.open_paper_predictions(self._new_slots)
        self.prediction_housekeeping()
        self.maybe_autotune()
        self.snapshot_equity(prices)
        self.last_cycle = now_ms()
        self.cycle_ms = int((time.time() - t0) * 1000)
        self.phase = "waiting"
        self.save()

    def entry_blockers(self, sig: dict, mode: str) -> List[str]:
        s = self.settings
        r = []
        if sig["direction"] == "neutral":
            r.append("no clear direction")
        if sig["confidence"] < s["minConfidence"]:
            r.append(f"confidence {sig['confidence']:.0f}% < {s['minConfidence']}%")
        if sig["symbol"] in s["blockedSymbols"]:
            r.append("symbol blocked by auto-tune")
        if time.gmtime().tm_hour in s["blockedHours"]:
            r.append("hour blocked by auto-tune")
        if sig["adx"] < s["minAdx"]:
            r.append(f"ADX {sig['adx']:.0f} < {s['minAdx']}")
        if sig["direction"] == "short" and (mode == "live" or not s["allowShort"]):
            r.append("shorts disabled" if mode == "paper" else "spot live trading is long-only")
        if any(p["symbol"] == sig["symbol"] for p in self.positions(mode)):
            r.append("position already open")
        return r

    # ─── Paper "Binance Prediction" bets (dummy Up/Down bet on every slot) ──

    def prediction_blockers(self, sig: dict) -> List[str]:
        s = self.settings
        r = []
        if sig["direction"] == "neutral":
            r.append("no clear direction")
        if sig["confidence"] < s["minConfidence"]:
            r.append(f"confidence {sig['confidence']:.0f}% < {s['minConfidence']}%")
        if sig["symbol"] in s["blockedSymbols"]:
            r.append("symbol blocked by auto-tune")
        if time.gmtime().tm_hour in s["blockedHours"]:
            r.append("hour blocked by auto-tune")
        if sig["adx"] < s["minAdx"]:
            r.append(f"ADX {sig['adx']:.0f} < {s['minAdx']}")
        if sig["direction"] == "short" and not s["allowShort"]:
            r.append("Down bets disabled by auto-tune")
        return r

    def open_paper_predictions(self, new_slots: List[tuple]):
        """Bet on the slots that opened this cycle: best confidence first, up to maxOpenPositions per slot."""
        s = self.settings
        placed = 0
        skipped: Dict[str, int] = {}
        for sym, slot, sig in sorted(new_slots, key=lambda x: -x[2]["confidence"]):
            blockers = self.prediction_blockers(sig)
            if placed >= s["maxOpenPositions"]:
                blockers = blockers or ["max bets per slot reached"]
            if blockers:
                # group "confidence 61% < 78%" style reasons so the summary stays short
                key = re.sub(r"\d+%? <", "<", blockers[0])
                skipped[key] = skipped.get(key, 0) + 1
                continue
            if any(p["symbol"] == sym and p.get("kind") == "prediction" for p in self.positions("paper")):
                continue
            bal = self.data["paper"]["balance"]
            amount = float(s.get("paperTradeAmountUsdt", 1.5))  # same size every slot, win or lose
            amount = max(1.0, amount)
            if amount > bal:
                continue
            price = min(0.95, max(0.05, float(s.get("paperPredictionPrice", 0.5))))
            self.data["paper"]["balance"] = bal - amount
            self.data["positions"].append({
                "id": uuid.uuid4().hex[:12], "mode": "paper", "kind": "prediction", "symbol": sym, "side": sig["direction"],
                "qty": amount / price, "entryPrice": slot["open"], "quote": amount, "entryFee": amount * s["feePct"] / 100,
                "sl": 0.0, "tp": 0.0, "openTime": now_ms(), "openCandle": slot["slotStart"], "checkedFrom": slot["slotStart"],
                "slotStart": slot["slotStart"], "slotEnd": slot["slotEnd"], "heldCandles": 0, "lastPrice": sig["price"],
                "confidence": sig["confidence"], "score": sig["score"], "votes": sig["votes"], "regime": sig["regime"],
                "adx": sig["adx"], "orderId": None, "sellFailures": 0, "sharePrice": price,
            })
            placed += 1
            log(f"PAPER bet {'UP' if sig['direction'] == 'long' else 'DOWN'} {sym} {amount:g} USDT @ {price:.2f} "
                f"(beat {slot['open']:.6g}, conf {sig['confidence']:.0f}%)")
        if new_slots:
            why = ", ".join(f"{k} ×{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
            log(f"Slot {time.strftime('%H:%M', time.gmtime(new_slots[0][1]['slotStart'] / 1000))} UTC: {placed} paper bet(s) placed"
                + (f", {sum(skipped.values())} skipped ({why})" if skipped else ""), "slot")

    def settle_paper_prediction(self, sym: str, slot: dict):
        pos = next((p for p in self.positions("paper") if p.get("kind") == "prediction" and p["symbol"] == sym
                    and p["slotStart"] == slot["slotStart"]), None)
        if not pos:
            return
        won = slot["actual"] == ("up" if pos["side"] == "long" else "down")  # flat ("no change") loses both sides
        payout = pos["qty"] if won else 0.0
        pnl = payout - pos["quote"] - pos["entryFee"]
        self.data["paper"]["balance"] += payout - pos["entryFee"]
        self.data["positions"] = [p for p in self.data["positions"] if p["id"] != pos["id"]]
        trade = {k: pos[k] for k in ("id", "mode", "symbol", "side", "qty", "entryPrice", "quote", "openTime",
                                     "confidence", "score", "votes", "regime", "adx", "orderId")}
        trade.update({
            "kind": "prediction", "heldCandles": 1, "exitPrice": slot["close"], "closeTime": now_ms(),
            "pnl": round(pnl, 4), "fees": round(pos["entryFee"], 4), "pnlPct": round(100 * pnl / pos["quote"], 3),
            "result": "win" if won else "loss", "exitReason": "slot_won" if won else "slot_lost",
        })
        self.data["trades"].insert(0, trade)
        del self.data["trades"][MAX_TRADES:]
        actual = 1 if slot["actual"] == "up" else -1 if slot["actual"] == "down" else 0
        learner.record_outcome(self.data["learning"], pos["votes"], actual)
        self.study_cache = None
        log(f"PAPER bet {sym} {'won' if won else 'lost'} {pnl:+.4f} USDT ({slot['open']:.6g} → {slot['close']:.6g})", "trade")
        emit("trade_closed", trade)

    def open_new_positions(self, candidates: List[dict]):
        s = self.settings
        prediction_paper = s.get("paperMode") == "prediction"
        for sig in sorted(candidates, key=lambda x: -x["confidence"]):
            sig["reasons"] = self.prediction_blockers(sig) if prediction_paper else self.entry_blockers(sig, "paper")
            if not prediction_paper and not sig["reasons"] and len(self.positions("paper")) < s["maxOpenPositions"]:
                self.open_paper(sig)
            if self.live_enabled and self.trader and self.settings.get("liveVenue") == "spot":
                if not self.entry_blockers(sig, "live") and len(self.positions("live")) < s["liveMaxOpenPositions"]:
                    if self.live_loss_today() >= s["liveDailyLossLimitUsdt"]:
                        self.add_error("Daily live loss limit reached — live trading switched off")
                        self.live_enabled = False
                        continue
                    self.open_live(sig)

    def _new_position(self, sig, mode, qty, entry, quote, fee, order_id=None):
        side = 1 if sig["direction"] == "long" else -1
        s = self.settings
        pos = {
            "id": uuid.uuid4().hex[:12], "mode": mode, "symbol": sig["symbol"], "side": sig["direction"],
            "qty": qty, "entryPrice": entry, "quote": quote, "entryFee": fee,
            "sl": entry - side * s["slAtrMult"] * sig["atr"], "tp": entry + side * s["tpAtrMult"] * sig["atr"],
            "openTime": now_ms(), "openCandle": sig["candleTime"], "checkedFrom": sig["candleTime"],
            "heldCandles": 0, "lastPrice": entry, "confidence": sig["confidence"], "score": sig["score"],
            "votes": sig["votes"], "regime": sig["regime"], "adx": sig["adx"], "orderId": order_id, "sellFailures": 0,
        }
        self.data["positions"].append(pos)
        return pos

    def open_paper(self, sig):
        s = self.settings
        bal = self.data["paper"]["balance"]
        if s.get("paperTradeMode") == "percent":
            quote = round(bal * s["paperTradeSizePct"] / 100, 2)
        else:
            quote = float(s.get("paperTradeAmountUsdt", 1.0))
        quote = max(1.0, quote)  # minimum bet is 1 USD
        if quote > bal:
            return
        fee = quote * s["feePct"] / 100
        self.data["paper"]["balance"] = bal - quote
        pos = self._new_position(sig, "paper", quote / sig["price"], sig["price"], quote, fee)
        log(f"PAPER open {pos['side']} {pos['symbol']} @ {pos['entryPrice']:.6g} (conf {sig['confidence']:.0f}%)")

    def open_live(self, sig):
        try:
            r = self.trader.market_buy(sig["symbol"], float(self.settings["liveTradeAmountUsdt"]))
        except BinanceError as e:
            self.add_error(f"LIVE buy {sig['symbol']} failed: {e}")
            return
        pos = self._new_position(sig, "live", r["qty"], r["price"], r["quote"], 0.0, r["orderId"])
        log(f"LIVE BUY {pos['symbol']} qty {pos['qty']:.8g} @ {pos['entryPrice']:.6g}", "trade")
        self.refresh_live_account(quiet=True)

    def manage_positions(self, sym: str, c: dict, interval_ms: int):
        for pos in [p for p in self.data["positions"] if p["symbol"] == sym]:
            if pos.get("kind") == "prediction":
                pos["lastPrice"] = float(c["close"][-1])  # settled when its slot closes (update_slots)
                continue
            side = 1 if pos["side"] == "long" else -1
            times = c["time"]
            idx = [i for i in range(len(times)) if times[i] >= pos["checkedFrom"]]
            exit_price, reason = None, None
            for i in idx:
                hi, lo = c["high"][i], c["low"][i]
                hit_sl = lo <= pos["sl"] if side > 0 else hi >= pos["sl"]
                hit_tp = hi >= pos["tp"] if side > 0 else lo <= pos["tp"]
                if hit_sl:  # conservative: if both touched in one candle assume stop first
                    exit_price, reason = pos["sl"], "stop_loss"
                    break
                if hit_tp:
                    exit_price, reason = pos["tp"], "take_profit"
                    break
            pos["checkedFrom"] = int(times[-1])
            pos["lastPrice"] = float(c["close"][-1])
            pos["heldCandles"] = int((times[-1] - pos["openCandle"]) // interval_ms)
            if reason is None and pos["heldCandles"] >= self.settings["maxHoldCandles"]:
                exit_price, reason = pos["lastPrice"], "timeout"
            if reason:
                self.close_position(pos, float(exit_price), reason)

    def close_position(self, pos: dict, exit_price: float, reason: str):
        side = 1 if pos["side"] == "long" else -1
        if pos["mode"] == "live":
            try:
                r = self.trader.market_sell(pos["symbol"], pos["qty"])
            except Exception as e:
                pos["sellFailures"] = pos.get("sellFailures", 0) + 1
                self.add_error(f"LIVE sell {pos['symbol']} failed ({pos['sellFailures']}x): {e}")
                return
            exit_price = r["price"]
            pnl = r["quote"] - pos["quote"]
            fees = 0.0
        else:
            exit_fee = pos["qty"] * exit_price * self.settings["feePct"] / 100
            fees = pos["entryFee"] + exit_fee
            pnl = pos["qty"] * (exit_price - pos["entryPrice"]) * side - fees
            self.data["paper"]["balance"] += pos["quote"] + pnl

        self.data["positions"] = [p for p in self.data["positions"] if p["id"] != pos["id"]]
        trade = {k: pos[k] for k in ("id", "mode", "symbol", "side", "qty", "entryPrice", "quote", "openTime",
                                     "confidence", "score", "votes", "regime", "adx", "heldCandles", "orderId")}
        trade.update({
            "exitPrice": exit_price, "closeTime": now_ms(), "pnl": round(pnl, 4), "fees": round(fees, 4),
            "pnlPct": round(100 * pnl / pos["quote"], 3) if pos["quote"] else 0.0,
            "result": "win" if pnl > 0 else "loss", "exitReason": reason,
        })
        self.data["trades"].insert(0, trade)
        del self.data["trades"][MAX_TRADES:]
        if pos["mode"] == "live":
            day = time.strftime("%Y-%m-%d", time.gmtime())
            self.data["liveDaily"][day] = self.data["liveDaily"].get(day, 0.0) + pnl
            self.refresh_live_account(quiet=True)
        # trade outcomes teach the indicators too (price direction while the trade was open)
        actual = 1 if exit_price > pos["entryPrice"] else -1 if exit_price < pos["entryPrice"] else 0
        if pos["mode"] == "paper":
            learner.record_outcome(self.data["learning"], pos["votes"], actual)
        self.study_cache = None
        log(f"{pos['mode'].upper()} close {pos['symbol']} {reason} pnl {pnl:+.2f} USDT", "trade")
        emit("trade_closed", trade)

    def live_loss_today(self) -> float:
        day = time.strftime("%Y-%m-%d", time.gmtime())
        return max(0.0, -self.data["liveDaily"].get(day, 0.0))

    # ─── Slot predictions: "will this candle close above its open?" ─────────

    def update_slots(self, sym: str, c: dict, sig: dict, interval_ms: int):
        """Each candle is a slot. The first scan in a slot records the bot's call
        (made from closed candles only); when the slot's candle closes it is scored."""
        slots = self.data["slots"].setdefault(sym, [])
        times = [int(t) for t in c["time"]]
        index = {t: i for i, t in enumerate(times)}
        cur = times[-1]
        for sl in slots:
            if sl["close"] is None and sl["slotStart"] < cur and sl["slotStart"] in index:
                i = index[sl["slotStart"]]
                sl["close"] = float(c["close"][i])
                sl["actual"] = "up" if sl["close"] > sl["open"] else "down" if sl["close"] < sl["open"] else "flat"
                sl["hit"] = None if sl["direction"] == "neutral" or sl["actual"] == "flat" else (
                    (sl["direction"] == "long") == (sl["actual"] == "up"))
                self.settle_prediction_bet(sym, sl)
                self.settle_paper_prediction(sym, sl)
        if not slots or slots[-1]["slotStart"] < cur:
            slot = {
                "slotStart": cur, "slotEnd": cur + interval_ms, "open": float(c["open"][-1]),
                "direction": sig["direction"], "confidence": sig["confidence"],
                "predictedAt": now_ms(), "priceAtPrediction": sig["price"],
                "close": None, "actual": None, "hit": None,
            }
            slots.append(slot)
            self._new_slots.append((sym, slot, sig))
            if self.live_enabled and self.settings.get("liveVenue") == "prediction" and sym == self.settings["predictionSymbol"]:
                self.place_prediction_bet(sym, slot, sig)
        # forget unscorable slots (missed candles) and keep history small
        self.data["slots"][sym] = [sl for sl in slots if sl["close"] is not None or sl["slotStart"] >= times[0]][-200:]

    # ─── Binance Prediction Market bets ──────────────────────────────────────

    def prediction_exposure(self) -> float:
        return sum(b["amount"] for b in self.data["predictionBets"] if b["status"] == "placed" and b.get("result") is None)

    def place_prediction_bet(self, sym: str, slot: dict, sig: dict):
        s = self.settings
        bet = {
            "id": uuid.uuid4().hex[:12], "symbol": sym, "slotStart": slot["slotStart"], "slotEnd": slot["slotEnd"],
            "direction": sig["direction"], "confidence": sig["confidence"], "amount": float(s["predictionBetUsdt"]),
            "dryRun": bool(s["predictionDryRun"]), "status": "skipped", "reason": None, "createdAt": now_ms(),
            "marketTopicId": None, "marketTitle": None, "outcome": None, "tokenId": None,
            "shares": None, "avgPrice": None, "fee": None, "orderId": None, "result": None, "pnl": None,
        }
        reasons = []
        if sig["direction"] == "neutral":
            reasons.append("no clear direction")
        if sig["confidence"] < s["minConfidence"]:
            reasons.append(f"confidence {sig['confidence']:.0f}% < {s['minConfidence']}%")
        if time.gmtime().tm_hour in s["blockedHours"]:
            reasons.append("hour blocked by auto-tune")
        if not bet["dryRun"] and self.prediction_exposure() + bet["amount"] > s["predictionMaxExposureUsdt"]:
            reasons.append("max exposure reached")
        if self.live_loss_today() >= s["liveDailyLossLimitUsdt"]:
            reasons.append("daily loss limit reached")
            self.live_enabled = False
        if reasons:
            bet["reason"] = ", ".join(reasons)
            return self._record_bet(bet)
        try:
            markets, _ = self.pm.search(s["predictionQuery"])
            m = match_slot_market(markets, symbol_words(sym), slot["slotEnd"])
            if not m:
                raise PredictionError(f"no open {sym} market ends at this slot's close — check Settings → Find markets")
            if not m["outcomes"] or not pick_outcome(m, sig["direction"]):
                detail = self.pm.market_detail(m["marketTopicId"])
                m = next((x for x in detail if x["marketTopicId"] == m["marketTopicId"]), m)
            outcome = pick_outcome(m, sig["direction"])
            if not outcome:
                raise PredictionError(f"could not find the {'Up' if sig['direction'] == 'long' else 'Down'} outcome in '{m['title']}'")
            bet.update(marketTopicId=m["marketTopicId"], marketTitle=m["title"], outcome=outcome["label"], tokenId=outcome["tokenId"])
            q = self.pm.quote(m, outcome, bet["amount"])
            bet.update(shares=float(q.get("amountOut") or 0), avgPrice=q.get("averagePrice"), fee=q.get("feeAmount"))
            if bet["dryRun"]:
                bet["status"] = "dry_run"
            else:
                r = self.pm.place(q)
                bet["orderId"] = str(r.get("orderId") or r.get("id") or r.get("orderNo") or "")
                bet["status"] = "placed"
                self.pm_balance_at = 0  # refresh balance next cycle
            log(f"PREDICTION {'quote (dry run)' if bet['dryRun'] else 'BET'} {bet['outcome']} {bet['amount']:g} USDT "
                f"→ {bet['shares']:.4g} shares @ {bet['avgPrice']} on '{bet['marketTitle']}'", "trade")
        except PredictionError as e:
            bet["status"] = "failed"
            bet["reason"] = str(e)
            self.add_error(f"Prediction bet failed: {e}")
        self._record_bet(bet)

    def _record_bet(self, bet: dict):
        self.data["predictionBets"].append(bet)
        del self.data["predictionBets"][:-500]

    def settle_prediction_bet(self, sym: str, slot: dict):
        bet = next((b for b in self.data["predictionBets"] if b["symbol"] == sym and b["slotStart"] == slot["slotStart"]
                    and b["status"] in ("placed", "dry_run") and b["result"] is None), None)
        if not bet or slot["hit"] is None:
            if bet and slot["actual"] == "flat":
                bet["result"] = "flat"
            return
        won = slot["hit"]
        shares = bet["shares"] or 0.0
        bet["result"] = "win" if won else "loss"
        bet["pnl"] = round((shares if won else 0.0) - bet["amount"], 4)  # estimate; market oracle decides the payout
        if bet["status"] != "placed":
            return
        trade = {
            "id": bet["id"], "mode": "live", "symbol": sym, "side": bet["direction"], "qty": shares,
            "entryPrice": slot["open"], "exitPrice": slot["close"], "quote": bet["amount"], "openTime": bet["createdAt"],
            "closeTime": now_ms(), "confidence": bet["confidence"], "score": 0, "votes": {}, "regime": "prediction",
            "adx": 0, "heldCandles": 1, "orderId": bet["orderId"], "pnl": bet["pnl"], "fees": 0.0,
            "pnlPct": round(100 * bet["pnl"] / bet["amount"], 3) if bet["amount"] else 0.0,
            "result": bet["result"], "exitReason": "slot_settled",
        }
        self.data["trades"].insert(0, trade)
        day = time.strftime("%Y-%m-%d", time.gmtime())
        self.data["liveDaily"][day] = self.data["liveDaily"].get(day, 0.0) + bet["pnl"]
        self.study_cache = None
        emit("trade_closed", trade)

    def prediction_housekeeping(self):
        if not self.pm or self.settings.get("liveVenue") != "prediction" or not self.live_enabled:
            return
        if time.time() - self.pm_balance_at > 60:
            self.refresh_live_account(quiet=True)
        if self.settings.get("predictionAutoRedeem") and time.time() - self.pm_redeem_at > 300:
            self.pm_redeem_at = time.time()
            try:
                n = self.pm.redeem_all()
                if n:
                    log(f"Redeemed {n} winning prediction position(s)", "trade")
                    self.pm_balance_at = 0
            except PredictionError as e:
                self.add_error(f"Redeem failed: {e}")

    def slot_view(self) -> dict:
        out, total, hits = {}, 0, 0
        for sym, slots in self.data["slots"].items():
            if sym not in self.settings["symbols"]:
                continue
            scored = [sl for sl in slots if sl["hit"] is not None]
            h = sum(1 for sl in scored if sl["hit"])
            total += len(scored)
            hits += h
            out[sym] = {"slots": slots[-40:], "scored": len(scored), "hits": h,
                        "accuracy": round(100 * h / len(scored), 1) if scored else None}
        return {"bySymbol": out, "scored": total, "hits": hits,
                "accuracy": round(100 * hits / total, 1) if total else None,
                "interval": self.settings["interval"]}

    # ─── Scan-level predictions (learn from every signal, not only trades) ──

    def add_prediction(self, sig: dict, interval_ms: int):
        pend = self.data["pending"]
        if any(p["symbol"] == sig["symbol"] and p["candleTime"] == sig["candleTime"] for p in pend):
            return
        pend.append({
            "symbol": sig["symbol"], "candleTime": sig["candleTime"], "price": sig["price"],
            "dir": 1 if sig["direction"] == "long" else -1, "votes": sig["votes"],
            "evalAt": now_ms() + self.settings["predictionHorizon"] * interval_ms,
        })
        del pend[: max(0, len(pend) - 2000)]

    def evaluate_predictions(self, sym: str, price: float):
        keep = []
        t = now_ms()
        for p in self.data["pending"]:
            if p["symbol"] != sym or p["evalAt"] > t:
                keep.append(p)
                continue
            move = (price - p["price"]) / p["price"]
            if abs(move) < 0.0002:  # flat — no information
                continue
            learner.record_outcome(self.data["learning"], p["votes"], 1 if move > 0 else -1,
                                   symbol=sym, predicted=p["dir"])
        self.data["pending"] = keep

    # ─── Auto-tune ──────────────────────────────────────────────────────────

    # ─── Community learning (anonymous pool of all users' trades) ────────────

    def collective_path(self) -> Optional[str]:
        gdir = os.environ.get("BOT_GLOBAL_DIR") or (os.path.join(os.path.dirname(os.path.dirname(self.data_dir)), "global") if self.data_dir else None)
        return os.path.join(gdir, "collective.json") if gdir else None

    def load_collective(self) -> Optional[dict]:
        p = self.collective_path()
        if not p or not self.settings.get("useCommunityLearning", True) or not os.path.exists(p):
            return None
        mtime = os.path.getmtime(p)
        if mtime != self.collective_mtime:
            try:
                with open(p) as f:
                    self.collective = json.load(f)
                self.collective_mtime = mtime
            except Exception:
                return self.collective
        return self.collective

    def my_tag(self) -> str:
        import hashlib
        return hashlib.sha256(os.path.basename(self.data_dir or "").encode()).hexdigest()[:10]

    def community_learning(self) -> Tuple[dict, List[dict]]:
        """Own learning/trades merged with everybody else's (own trades are never counted twice)."""
        own_learning = self.data["learning"]
        own_trades = self.data["trades"]
        col = self.load_collective()
        if not col:
            return own_learning, own_trades
        me = self.my_tag()
        others = [dict(t, mode="paper") for t in col.get("trades", []) if t.get("user") != me]
        merged_ind = {k: dict(v) for k, v in own_learning["indicators"].items()}
        for k, v in (col.get("indicators") or {}).items():
            m = merged_ind.setdefault(k, {"hits": 0.0, "total": 0.0, "recent": []})
            m["hits"] = m.get("hits", 0.0) + v.get("hits", 0.0)
            m["total"] = m.get("total", 0.0) + v.get("total", 0.0)
        merged = dict(own_learning, indicators=merged_ind)
        return merged, own_trades + others

    def maybe_autotune(self, force: bool = False):
        s = self.settings
        if not s["autoTune"] and not force:
            return
        n_paper = sum(1 for t in self.data["trades"] if t["mode"] == "paper")
        if not force and n_paper - self.data["learning"]["lastTuneTradeCount"] < s["autoTuneEvery"]:
            return
        tune_s = dict(s, tuneRisk=False) if s.get("paperMode") == "prediction" else s  # no SL/TP on slot bets
        learning, trades = self.community_learning()
        patch, changes = learner.autotune(tune_s, learning, trades, now_ms())
        self.data["learning"]["lastTuneTradeCount"] = n_paper  # count only this user's new trades
        if patch:
            self.settings = merge_settings(self.settings, patch)
            emit("settings_tuned", patch)
            log(f"Auto-tune applied {len(changes)} change(s)", "tune")
        elif force:
            log("Auto-tune: no changes needed yet (need more data)", "tune")

    # ─── Calibration: learn from historical candles before trading ─────────

    def calibrate(self):
        s = self.settings
        interval_ms = INTERVAL_SECONDS.get(s["interval"], 300) * 1000
        horizon = int(s["predictionHorizon"])
        total_samples = 0
        symbols = s["symbols"]
        self.phase = "calibrating"
        for si, sym in enumerate(symbols):
            self.calibrating = {"symbol": sym, "progress": round(100 * si / len(symbols))}
            self.emit_state()
            try:
                c = self.market.klines_range(sym, s["interval"], 1000)
            except Exception as e:
                self.add_error(f"Calibrate {sym}: {e}")
                continue
            n = len(c["close"])
            for i in range(MIN_CANDLES + 30, n - horizon, 2):
                window = {k: v[i - 150 if i >= 150 else 0: i] for k, v in c.items()}
                a = self.analyse(window)
                fut = c["close"][i - 1 + horizon]
                now = c["close"][i - 1]
                move = (fut - now) / now
                if abs(move) < 0.0002:
                    continue
                pred = a["direction"] if a["confidence"] >= 50 else None
                learner.record_outcome(self.data["learning"], a["votes"], 1 if move > 0 else -1,
                                       symbol=sym, predicted=pred or None, weight=0.5)
                total_samples += 1
        self.data["learning"]["calibration"] = {"time": now_ms(), "samples": total_samples,
                                                "symbols": len(symbols), "interval": s["interval"]}
        self.calibrating = None
        log(f"Calibration finished: {total_samples} historical samples learned", "tune")
        # apply weights straight away
        only = dict(s, tuneThreshold=False, tuneRisk=False, tuneFilters=False)
        patch, changes = learner.autotune(only, self.data["learning"], self.data["trades"], now_ms())
        if patch:
            self.settings = merge_settings(self.settings, patch)
            emit("settings_tuned", patch)
        self.phase = "waiting" if self.running else "idle"
        self.save()

    # ─── Live account ───────────────────────────────────────────────────────

    def build_trader(self):
        c = self.credentials
        if SIMULATE and c.get("apiKey"):
            self.trader = SimulatedTrader(self.sim)
        elif c.get("apiKey") and c.get("apiSecret"):
            self.trader = SpotTrader(c["apiKey"], c["apiSecret"], bool(c.get("testnet", True)))
        else:
            self.trader = None

    def refresh_live_account(self, quiet: bool = False) -> dict:
        if self.settings.get("liveVenue") == "prediction":
            return self.refresh_prediction_wallet(quiet)
        if not self.trader:
            self.live_account = None
            return {"ok": False, "error": "API key and secret are not set"}
        try:
            self.trader.sync_time()
            acct = self.trader.account()
            usdt = next((float(b["free"]) for b in acct.get("balances", []) if b["asset"] == "USDT"), 0.0)
            self.live_account = {"ok": True, "usdt": usdt, "canTrade": acct.get("canTrade", False),
                                 "testnet": self.trader.testnet, "checkedAt": now_ms()}
        except Exception as e:
            self.live_account = {"ok": False, "error": str(e), "testnet": getattr(self.trader, "testnet", True), "checkedAt": now_ms()}
            if not quiet:
                self.add_error(f"Binance account check failed: {e}")
        return self.live_account

    def refresh_prediction_wallet(self, quiet: bool = False) -> dict:
        self.pm_balance_at = time.time()
        if not self.pm:
            return {"ok": False, "error": "bot not initialised"}
        try:
            self.pm_status = self.pm.status()
            if self.pm_status != "CONNECTED":
                self.live_account = {"ok": False, "venue": "prediction", "status": self.pm_status, "checkedAt": now_ms(),
                                     "error": "Binance Agentic Wallet is not signed in — connect it in Settings"}
            else:
                self.live_account = {"ok": True, "venue": "prediction", "status": "CONNECTED",
                                     "usdt": self.pm.usdt_balance(), "canTrade": True, "testnet": False, "checkedAt": now_ms()}
        except PredictionError as e:
            self.live_account = {"ok": False, "venue": "prediction", "error": str(e), "checkedAt": now_ms()}
            if not quiet:
                self.add_error(f"Prediction wallet check failed: {e}")
        return self.live_account

    # ─── State for the UI ───────────────────────────────────────────────────

    def stats(self, mode: str) -> dict:
        tr = [t for t in self.data["trades"] if t["mode"] == mode]
        wins = [t for t in tr if t["result"] == "win"]
        losses = [t for t in tr if t["result"] == "loss"]
        day_ago = now_ms() - 86400000
        gross_win = sum(t["pnl"] for t in wins)
        gross_loss = -sum(t["pnl"] for t in losses)

        def wr(sub):
            return round(100 * sum(1 for t in sub if t["result"] == "win") / len(sub), 1) if sub else None

        return {
            "trades": len(tr), "wins": len(wins), "losses": len(losses),
            "winRate": wr(tr), "winRate20": wr(tr[:20]), "winRate50": wr(tr[:50]),
            "pnl": round(sum(t["pnl"] for t in tr), 4),
            "pnlToday": round(sum(t["pnl"] for t in tr if t["closeTime"] >= day_ago), 4),
            "avgWin": round(gross_win / len(wins), 4) if wins else 0.0,
            "avgLoss": round(-gross_loss / len(losses), 4) if losses else 0.0,
            "profitFactor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
            "open": len(self.positions(mode)),
        }

    def learning_view(self) -> dict:
        L = self.data["learning"]
        inds = []
        for key in list(INDICATORS) + [AI_KEY]:
            st = L["indicators"].get(key)
            acc, n = learner.accuracy(st)
            rec = (st or {}).get("recent", [])
            cfg = self.settings["indicators"].get(key, {"enabled": True, "weight": 1.0})
            lbl, kind = learner.label_of(key)
            inds.append({
                "key": key, "label": lbl, "kind": kind, "accuracy": round(acc * 100, 1), "samples": round(n),
                "recentAccuracy": round(100 * sum(rec) / len(rec), 1) if rec else None,
                "weight": cfg.get("weight", 1.0), "enabled": cfg.get("enabled", True),
            })
        p = L["predictions"]
        rec = p["recent"]
        if self.study_cache is None:
            self.study_cache = learner.loss_study([t for t in self.data["trades"] if t["mode"] == "paper"][:500])
        return {
            "indicators": sorted(inds, key=lambda x: -x["accuracy"]),
            "predictions": {"total": p["total"], "accuracy": round(100 * p["hits"] / p["total"], 1) if p["total"] else None,
                            "recentAccuracy": round(100 * sum(rec) / len(rec), 1) if rec else None},
            "aiModel": {"samples": L["model"]["samples"], "active": L["model"]["samples"] >= learner.AI_MIN_SAMPLES,
                        "minSamples": learner.AI_MIN_SAMPLES},
            "tuningLog": L["tuningLog"][:30],
            "calibration": L["calibration"],
            "lossStudy": self.study_cache,
            "pendingPredictions": len(self.data["pending"]),
            "community": self.community_view(),
        }

    def community_view(self) -> Optional[dict]:
        col = self.load_collective()
        if not col:
            return {"enabled": bool(self.settings.get("useCommunityLearning", True)), "users": 0, "trades": 0}
        sm = col.get("summary", {})
        return {"enabled": True, "users": col.get("users", 0), "trades": sm.get("trades", 0), "winRate": sm.get("winRate"),
                "updatedAt": col.get("updatedAt"), "byMode": sm.get("byMode", {}), "recommended": col.get("recommended", {}),
                "insights": (sm.get("lossStudy") or {}).get("insights", [])[:5]}

    def accuracy_score(self, paper: dict, learning: dict) -> Optional[float]:
        """Single 0-100 'how well is the bot doing' meter: blends trade win rate and prediction accuracy."""
        parts = []
        if paper["winRate50"] is not None and paper["trades"] >= 5:
            parts.append((paper["winRate50"], min(1.0, paper["trades"] / 50)))
        pa = learning["predictions"]["recentAccuracy"]
        if pa is not None:
            parts.append((pa, min(1.0, learning["predictions"]["total"] / 100)))
        if not parts:
            return None
        w = sum(x[1] for x in parts)
        return round(sum(v * x for v, x in parts) / w, 1)

    def emit_state(self):
        paper = self.stats("paper")
        live = self.stats("live")
        learning = self.learning_view()
        unreal = sum(self.unrealized(p) for p in self.positions("paper"))
        equity = self.data["paper"]["balance"] + sum(p["quote"] for p in self.positions("paper")) + unreal
        start = self.data["paper"]["startBalance"]
        positions = []
        for p in self.data["positions"]:
            u = self.unrealized(p)
            positions.append({k: p[k] for k in ("id", "mode", "symbol", "side", "qty", "entryPrice", "quote", "sl", "tp",
                                                "openTime", "heldCandles", "lastPrice", "confidence")}
                             | {"kind": p.get("kind", "position"), "slotEnd": p.get("slotEnd")}
                             | {"unrealizedPnl": round(u, 4), "unrealizedPct": round(100 * u / p["quote"], 3) if p["quote"] else 0})
        emit("state", {
            "status": {
                "running": self.running, "liveEnabled": self.live_enabled, "phase": self.phase,
                "lastCycle": self.last_cycle, "cycleMs": self.cycle_ms,
                "nextCycle": int(self.next_cycle * 1000) if self.running else None,
                "simulated": SIMULATE, "errors": self.errors[:10], "calibrating": self.calibrating,
                "hasCredentials": self.trader is not None or self.settings.get("liveVenue") == "prediction",
                "venue": self.settings.get("liveVenue"), "liveAccount": self.live_account,
            },
            "paper": paper | {"balance": round(self.data["paper"]["balance"], 2), "equity": round(equity, 2),
                              "startBalance": start, "returnPct": round(100 * (equity - start) / start, 2) if start else 0},
            "live": live | {"lossToday": round(self.live_loss_today(), 2)},
            "accuracyScore": self.accuracy_score(paper, learning),
            "positions": positions,
            "signals": sorted(self.signals.values(), key=lambda x: -x["confidence"]),
            "learning": learning,
            "equity": self.data["equity"][-200:],
            "recentTrades": self.data["trades"][:50],
            "slots": self.slot_view(),
            "prediction": {
                "venue": self.settings.get("liveVenue"), "dryRun": self.settings.get("predictionDryRun"),
                "symbol": self.settings.get("predictionSymbol"), "exposure": round(self.prediction_exposure(), 4),
                "bets": self.data["predictionBets"][-40:][::-1],
            },
            "settings": self.settings,
        })

    def snapshot_equity(self, prices: Dict[str, float]):
        unreal = sum(self.unrealized(p, prices.get(p["symbol"])) for p in self.positions("paper"))
        eq = self.data["paper"]["balance"] + sum(p["quote"] for p in self.positions("paper")) + unreal
        e = self.data["equity"]
        e.append({"t": now_ms(), "v": round(eq, 2)})
        if len(e) > MAX_EQUITY_POINTS:
            self.data["equity"] = e[::2]  # downsample to keep history long but small

    # ─── Commands ───────────────────────────────────────────────────────────

    def handle(self, msg: dict):
        cmd = msg.get("cmd")
        req = msg.get("reqId")
        if cmd == "init":
            self.data_dir = msg.get("dataDir")
            self.settings = merge_settings(DEFAULT_SETTINGS, msg.get("settings") or {})
            self.data = self._empty_data()
            self.load()
            self.credentials = msg.get("credentials") or {}
            self.build_trader()
            if self.data_dir:
                self.pm = PredictionClient(os.environ.get("BINANCE_BAW_DIR") or os.path.join(self.data_dir, "baw"))
        elif cmd == "settings":
            old_venue = self.settings.get("liveVenue")
            self.settings = merge_settings(DEFAULT_SETTINGS, msg.get("settings") or {})
            self.signals = {k: v for k, v in self.signals.items() if k in self.settings["symbols"]}
            if self.live_enabled and old_venue != self.settings.get("liveVenue"):
                # never carry a live session across venues — switch it on again deliberately
                self.live_enabled = False
                self.live_account = None
                log("Live trading OFF: connection method changed", "trade")
            self.study_cache = None
        elif cmd == "credentials":
            self.credentials = msg.get("credentials") or {}
            self.build_trader()
            self.live_account = None
            if not self.trader:
                self.live_enabled = False
        elif cmd == "start":
            if not self.running:
                self.running = True
                self.next_cycle = 0
                log("Bot started — paper trading every signal")
        elif cmd == "stop":
            self.running = False
            self.live_enabled = False
            self.phase = "idle"
            log("Bot stopped")
        elif cmd == "live":
            want = bool(msg.get("enabled"))
            if want:
                acct = self.refresh_live_account()
                if not acct.get("ok"):
                    emit("response", {"ok": False, "error": acct.get("error")}, reqId=req)
                    return
                self.live_enabled = True
                if not self.running:
                    self.running = True
                    self.next_cycle = 0
                if self.settings.get("liveVenue") == "prediction":
                    mode = "DRY RUN — quotes only" if self.settings["predictionDryRun"] else "REAL BETS"
                    log(f"LIVE prediction betting ON on {self.settings['predictionSymbol']} ({mode})", "trade")
                else:
                    log(f"LIVE trading ON ({'testnet' if self.trader.testnet else 'REAL MONEY'})", "trade")
            else:
                self.live_enabled = False
                log("Live trading OFF (open live positions are still managed until they close)", "trade")
        elif cmd == "prediction_markets":
            try:
                if not self.pm:
                    raise PredictionError("bot not initialised")
                query = (msg.get("query") or self.settings["predictionQuery"]).strip()
                markets, raw = self.pm.search(query, max_age=0)
                step = INTERVAL_SECONDS.get(self.settings["interval"], 300) * 1000
                slot_end = (now_ms() // step + 1) * step
                sym = self.settings["predictionSymbol"]
                m = match_slot_market(markets, symbol_words(sym), slot_end)
                upcoming = sorted([x for x in markets if x["endTime"] and x["endTime"] > now_ms()], key=lambda x: x["endTime"])
                emit("response", {
                    "ok": True, "query": query, "slotEnd": slot_end, "count": len(markets),
                    "markets": (upcoming or markets)[:20],
                    "match": m and {**m, "up": pick_outcome(m, "long"), "down": pick_outcome(m, "short")},
                    "raw": json.dumps(raw, default=str)[:3000],
                }, reqId=req)
            except PredictionError as e:
                emit("response", {"ok": False, "error": str(e)}, reqId=req)
            return
        elif cmd == "prediction_refresh":
            emit("response", self.refresh_prediction_wallet(), reqId=req)
            self.emit_state()
            return
        elif cmd == "test_credentials":
            emit("response", self.refresh_live_account(), reqId=req)
            self.emit_state()
            return
        elif cmd == "close_position":
            pos = next((p for p in self.data["positions"] if p["id"] == msg.get("id")), None)
            if pos and pos.get("kind") != "prediction":  # slot bets always run until their slot closes
                self.close_position(pos, pos["lastPrice"], "manual")
                self.save()
        elif cmd == "calibrate":
            emit("response", {"ok": True}, reqId=req)
            self.calibrate()
            req = None
        elif cmd == "autotune":
            self.maybe_autotune(force=True)
            self.save()
        elif cmd == "reset":
            what = msg.get("what")
            if what in ("paper", "all"):
                start = float(self.settings["paperStartBalance"])
                self.data["paper"] = {"balance": start, "startBalance": start}
                self.data["positions"] = self.positions("live")
                self.data["trades"] = [t for t in self.data["trades"] if t["mode"] == "live"]
                self.data["equity"] = []
            if what in ("learning", "all"):
                self.data["learning"] = learner.empty_learning()
                self.data["pending"] = []
            self.study_cache = None
            self.save()
            log(f"Reset: {what}")
        elif cmd == "get_trades":
            mode = msg.get("mode")
            tr = [t for t in self.data["trades"] if not mode or t["mode"] == mode]
            emit("response", tr[: int(msg.get("limit", 200))], reqId=req)
            return
        if req:
            emit("response", {"ok": True}, reqId=req)
        self.emit_state()


def main():
    bot = Bot()
    q: "queue.Queue[dict]" = queue.Queue()

    def reader():
        for line in sys.stdin:
            line = line.strip()
            if line:
                try:
                    q.put(json.loads(line))
                except json.JSONDecodeError:
                    pass
        q.put({"cmd": "__eof__"})

    threading.Thread(target=reader, daemon=True).start()
    emit("ready", {"simulated": SIMULATE})

    while True:
        timeout = max(0.1, bot.next_cycle - time.time()) if bot.running else 1.0
        try:
            msg = q.get(timeout=min(timeout, 1.0))
            if msg.get("cmd") == "__eof__":
                bot.save()
                return
            try:
                bot.handle(msg)
            except Exception as e:
                bot.add_error(f"Command {msg.get('cmd')} failed: {e}")
                traceback.print_exc(file=sys.stderr)
                if msg.get("reqId"):
                    emit("response", {"ok": False, "error": str(e)}, reqId=msg["reqId"])
        except queue.Empty:
            pass
        if bot.running and time.time() >= bot.next_cycle:
            try:
                bot.run_cycle()
            except Exception as e:
                bot.add_error(f"Cycle failed: {e}")
                traceback.print_exc(file=sys.stderr)
            bot.next_cycle = time.time() + max(5, int(bot.settings["scanIntervalSec"]))
            bot.emit_state()


if __name__ == "__main__":
    main()
