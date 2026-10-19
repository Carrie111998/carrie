"""
Self-learning layer:
  - per-indicator accuracy tracking (exponentially decayed so it adapts to the market)
  - a small online logistic-regression "AI model" that learns how to combine indicator votes
  - loss study: breaks down losing trades by symbol / hour / confidence / regime / indicator
  - auto-tune: turns those statistics into new settings and logs every change with a reason
"""

from __future__ import annotations

import math
import time
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from indicators import AI_KEY, AI_LABEL, INDICATORS

DECAY = 0.995          # older outcomes slowly lose influence
MIN_VOTE = 0.15        # votes weaker than this count as "neutral" and are not scored
RECENT = 50
AI_MIN_SAMPLES = 30
LR = 0.05
WEEK_MS = 7 * 24 * 3600 * 1000


def empty_learning() -> dict:
    return {
        "indicators": {},
        "model": {"w": {}, "b": 0.0, "samples": 0},
        "predictions": {"hits": 0, "total": 0, "recent": []},
        "symbols": {},
        "tuningLog": [],
        "lastTuneTradeCount": 0,
        "calibration": None,
    }


def label_of(key: str) -> Tuple[str, str]:
    if key == AI_KEY:
        return AI_LABEL
    lbl, kind, _ = INDICATORS[key]
    return lbl, kind


# ─── Outcome recording ────────────────────────────────────────────────────────

def _bump(stat: dict, hit: int, weight: float = 1.0):
    stat["hits"] = stat.get("hits", 0.0) * DECAY + hit * weight
    stat["total"] = stat.get("total", 0.0) * DECAY + weight
    rec = stat.setdefault("recent", [])
    rec.append(hit)
    if len(rec) > RECENT:
        del rec[: len(rec) - RECENT]


def record_outcome(learning: dict, votes: Dict[str, float], actual: int, symbol: Optional[str] = None,
                   predicted: Optional[int] = None, weight: float = 1.0):
    """actual = +1 if price went up over the horizon, -1 if it went down."""
    if actual == 0:
        return
    inds = learning["indicators"]
    for k, v in votes.items():
        if abs(v) < MIN_VOTE:
            continue
        _bump(inds.setdefault(k, {}), 1 if (v > 0) == (actual > 0) else 0, weight)

    if predicted:
        hit = 1 if predicted == actual else 0
        p = learning["predictions"]
        p["hits"] += hit
        p["total"] += 1
        p["recent"].append(hit)
        if len(p["recent"]) > 200:
            del p["recent"][: len(p["recent"]) - 200]
        if symbol:
            _bump(learning["symbols"].setdefault(symbol, {}), hit)

    _train_model(learning["model"], votes, actual)


def accuracy(stat: Optional[dict]) -> Tuple[float, float]:
    if not stat:
        return 0.5, 0.0
    n = stat.get("total", 0.0)
    return (stat.get("hits", 0.0) + 1) / (n + 2), n


# ─── AI model (online logistic regression on indicator votes) ────────────────

def _sigmoid(z: float) -> float:
    z = max(-30.0, min(30.0, z))
    return 1 / (1 + math.exp(-z))


def _train_model(model: dict, votes: Dict[str, float], actual: int):
    feats = {k: v for k, v in votes.items() if k != AI_KEY}
    y = 1.0 if actual > 0 else 0.0
    w = model["w"]
    p = _sigmoid(model["b"] + sum(w.get(k, 0.0) * v for k, v in feats.items()))
    g = y - p
    for k, v in feats.items():
        w[k] = w.get(k, 0.0) * (1 - 1e-4) + LR * g * v
    model["b"] += LR * g * 0.1
    model["samples"] += 1


def ai_vote(learning: dict, votes: Dict[str, float]) -> Optional[float]:
    m = learning["model"]
    if m["samples"] < AI_MIN_SAMPLES:
        return None
    # no bias term: it only remembers whether the market mostly rose or fell while the model
    # trained, which made every prediction lean the same way (e.g. Up only)
    z = sum(m["w"].get(k, 0.0) * v for k, v in votes.items() if k != AI_KEY)
    return round(2 * _sigmoid(z) - 1, 4)


# ─── Signal combination ──────────────────────────────────────────────────────

# Slow "market regime" votes: the 100-candle trend sits near +1 or -1 for hours, so letting it vote on
# every short slot made the bot agree with the long-term trend only (e.g. Up bets only, Down bets
# never confident enough). It still feeds the AI model, which learns how much it really matters.
CONTEXT_KEYS = {"trend"}


def combine(votes: Dict[str, float], weights: Dict[str, float]) -> Tuple[int, float, float]:
    """Returns (direction, confidence 0-100, weighted score -1..1)."""
    votes = {k: v for k, v in votes.items() if k not in CONTEXT_KEYS}
    tw = sum(weights.get(k, 1.0) for k in votes) or 1.0
    score = sum(weights.get(k, 1.0) * v for k, v in votes.items()) / tw
    mag = sum(weights.get(k, 1.0) * abs(v) for k, v in votes.items())
    if mag <= 0 or abs(score) < 1e-6:
        return 0, 0.0, 0.0
    direction = 1 if score > 0 else -1
    agree = sum(weights.get(k, 1.0) * abs(v) for k, v in votes.items() if (v > 0) == (direction > 0) and v != 0)
    agreement = agree / mag                      # 0.5..1  how much of the evidence agrees
    strength = min(1.0, abs(score) / 0.35)       # 0..1    how strong the combined push is
    confidence = 100 * (0.6 * agreement + 0.4 * strength)
    return direction, round(confidence, 1), round(score, 4)


# ─── Loss study ──────────────────────────────────────────────────────────────

def _group(trades: List[dict], keyfn) -> List[dict]:
    g: Dict[str, dict] = defaultdict(lambda: {"trades": 0, "wins": 0, "pnl": 0.0})
    for t in trades:
        k = keyfn(t)
        if k is None:
            continue
        r = g[str(k)]
        r["trades"] += 1
        r["wins"] += 1 if t["result"] == "win" else 0
        r["pnl"] += t.get("pnl") or 0.0
    out = []
    for k, r in g.items():
        out.append({"key": k, "trades": r["trades"], "wins": r["wins"],
                    "winRate": round(100 * r["wins"] / r["trades"], 1), "pnl": round(r["pnl"], 2)})
    return sorted(out, key=lambda r: r["winRate"])


def _conf_bucket(t):
    c = t.get("confidence") or 0
    lo = int(c // 10 * 10)
    return f"{lo}-{lo + 10}"


def _hour(t):
    return time.gmtime(t["openTime"] / 1000).tm_hour


def loss_study(trades: List[dict]) -> dict:
    closed = [t for t in trades if t.get("result") in ("win", "loss")]
    losses = [t for t in closed if t["result"] == "loss"]
    wins = [t for t in closed if t["result"] == "win"]
    study = {
        "totalTrades": len(closed),
        "totalLosses": len(losses),
        "lossRate": round(100 * len(losses) / len(closed), 1) if closed else 0.0,
        "byExitReason": [],
        "bySymbol": _group(closed, lambda t: t["symbol"]),
        "byHour": sorted(_group(closed, _hour), key=lambda r: int(r["key"])),
        "byConfidence": sorted(_group(closed, _conf_bucket), key=lambda r: int(r["key"].split("-")[0])),
        "byRegime": _group(closed, lambda t: t.get("regime")),
        "byDirection": _group(closed, lambda t: "long" if t["side"] == "long" else "short"),
        "misleading": [],
        "insights": [],
    }
    reasons: Dict[str, int] = defaultdict(int)
    for t in losses:
        reasons[t.get("exitReason") or "unknown"] += 1
    study["byExitReason"] = [{"reason": k, "count": v} for k, v in sorted(reasons.items(), key=lambda x: -x[1])]

    # Which indicators most often strongly backed trades that then lost?
    def backing(group, key):
        if not group:
            return 0.0
        n = 0
        for t in group:
            v = (t.get("votes") or {}).get(key, 0.0)
            d = 1 if t["side"] == "long" else -1
            if v * d >= 0.4:
                n += 1
        return n / len(group)

    keys = set()
    for t in closed:
        keys.update((t.get("votes") or {}).keys())
    mis = []
    for k in keys:
        lb, wb = backing(losses, k), backing(wins, k)
        if lb == 0 and wb == 0:
            continue
        mis.append({"indicator": k, "label": label_of(k)[0] if k in INDICATORS or k == AI_KEY else k,
                    "lossBacking": round(100 * lb, 1), "winBacking": round(100 * wb, 1),
                    "lift": round(100 * (lb - wb), 1)})
    study["misleading"] = sorted(mis, key=lambda r: -r["lift"])

    ins = study["insights"]
    if len(closed) < 10:
        ins.append("Not enough closed trades yet for a reliable study — keep paper trading or run Calibrate.")
        return study
    if study["byExitReason"]:
        top = study["byExitReason"][0]
        share = 100 * top["count"] / max(1, len(losses))
        if top["reason"] == "stop_loss" and share > 60:
            ins.append(f"{share:.0f}% of losses hit the stop-loss — stops may be too tight for current volatility.")
        if top["reason"] == "timeout" and share > 50:
            ins.append(f"{share:.0f}% of losses expired at max hold time — predictions are too slow to play out.")
    for r in study["bySymbol"]:
        if r["trades"] >= 6 and r["winRate"] < 35:
            ins.append(f"{r['key']} wins only {r['winRate']}% of {r['trades']} trades — candidate for blocking.")
    for r in study["byHour"]:
        if r["trades"] >= 6 and r["winRate"] < 30:
            ins.append(f"Trades opened at {int(r['key']):02d}:00 UTC win only {r['winRate']}% — weak hour.")
    for r in study["byRegime"]:
        if r["trades"] >= 8 and r["winRate"] < 38:
            ins.append(f"{r['key'].capitalize()} markets win only {r['winRate']}% — consider an ADX filter.")
    for r in study["byDirection"]:
        if r["trades"] >= 8 and r["winRate"] < 38:
            ins.append(f"{r['key'].capitalize()} trades win only {r['winRate']}%.")
    low_conf = [r for r in study["byConfidence"] if r["trades"] >= 5 and r["winRate"] < 40]
    if low_conf:
        ins.append(f"Low win rate in confidence band {low_conf[0]['key']}% — raising the minimum confidence helps.")
    for m in study["misleading"][:3]:
        if m["lift"] >= 15:
            ins.append(f"{m['label']} backed {m['lossBacking']}% of losers vs {m['winBacking']}% of winners — down-weight it.")
    if not ins:
        ins.append("No dominant loss pattern found — losses look like normal market noise.")
    return study


# ─── Auto-tune ───────────────────────────────────────────────────────────────

def _change(changes, param, old, new, reason):
    if old != new:
        changes.append({"param": param, "from": old, "to": new, "reason": reason})


def autotune(settings: dict, learning: dict, trades: List[dict], now_ms: int) -> Tuple[dict, List[dict]]:
    patch: dict = {}
    changes: List[dict] = []
    paper = [t for t in trades if t.get("mode") == "paper" and t.get("result") in ("win", "loss")]
    recent = paper[:200]
    week = [t for t in paper if now_ms - t["openTime"] <= WEEK_MS]

    # 1) Indicator weights from measured accuracy
    if settings.get("tuneWeights", True):
        inds = {k: dict(v) for k, v in settings["indicators"].items()}
        for key, cfg in inds.items():
            acc, n = accuracy(learning["indicators"].get(key))
            if n < 20:
                continue
            target = max(0.1, min(3.0, 1 + (acc - 0.5) * 10))
            new = round(0.6 * cfg["weight"] + 0.4 * target, 2)
            if abs(new - cfg["weight"]) >= 0.05:
                _change(changes, f"weight.{key}", cfg["weight"], new,
                        f"{label_of(key)[0]} accuracy {acc * 100:.1f}% over {n:.0f} samples")
                cfg["weight"] = new
        if any(c["param"].startswith("weight.") for c in changes):
            patch["indicators"] = inds

    # 2) Minimum confidence from realised results per confidence level
    if settings.get("tuneThreshold", True) and len(recent) >= 15:
        best_t, best_score = None, -1e9
        for t in range(50, 90, 5):
            sub = [x for x in recent if (x.get("confidence") or 0) >= t]
            if len(sub) < 8:
                continue
            avg = sum(x.get("pnlPct") or 0 for x in sub) / len(sub)
            score = avg * math.sqrt(len(sub))
            if score > best_score:
                best_t, best_score = t, score
        cur = settings["minConfidence"]
        if best_t is not None:
            new = int(round(cur + (best_t - cur) * 0.5))
            new = max(50, min(90, new))
            if new != cur:
                wr = [x for x in recent if (x.get("confidence") or 0) >= best_t]
                w = sum(1 for x in wr if x["result"] == "win")
                _change(changes, "minConfidence", cur, new,
                        f"trades at ≥{best_t}% confidence won {100 * w / len(wr):.0f}% ({len(wr)} trades)")
                patch["minConfidence"] = new

    # 3) Risk: stop-loss / take-profit distance
    if settings.get("tuneRisk", True) and len(recent) >= 15:
        losses = [t for t in recent if t["result"] == "loss"]
        wins = [t for t in recent if t["result"] == "win"]
        quick_sl = [t for t in losses if t.get("exitReason") == "stop_loss" and (t.get("heldCandles") or 0) <= 2]
        sl, tp = settings["slAtrMult"], settings["tpAtrMult"]
        if losses and len(quick_sl) / len(losses) > 0.5 and sl < 3.0:
            new = round(min(3.0, sl + 0.2), 2)
            _change(changes, "slAtrMult", sl, new, f"{len(quick_sl)}/{len(losses)} losses stopped out within 2 candles")
            patch["slAtrMult"] = new
        timeouts = [t for t in recent if t.get("exitReason") == "timeout"]
        tp_hits = [t for t in wins if t.get("exitReason") == "take_profit"]
        if len(timeouts) / len(recent) > 0.5 and tp > 1.0:
            new = round(max(1.0, tp - 0.2), 2)
            _change(changes, "tpAtrMult", tp, new, f"{len(timeouts)}/{len(recent)} trades timed out before reaching target")
            patch["tpAtrMult"] = new
        elif wins and len(tp_hits) / len(wins) > 0.6 and len(wins) / len(recent) > 0.55 and tp < 4.0:
            new = round(min(4.0, tp + 0.2), 2)
            _change(changes, "tpAtrMult", tp, new, "take-profit is hit often — letting winners run further")
            patch["tpAtrMult"] = new

    # 4) Filters: symbols, hours, shorts, ranging markets (based on the last 7 days)
    if settings.get("tuneFilters", True):
        blocked = list(settings.get("blockedSymbols", []))
        for r in _group(week, lambda t: t["symbol"]):
            if r["trades"] >= 8 and r["winRate"] < 35 and r["pnl"] < 0 and r["key"] not in blocked:
                blocked.append(r["key"])
                _change(changes, f"block.{r['key']}", False, True, f"won {r['winRate']}% of {r['trades']} trades this week")
        for sym in list(settings.get("blockedSymbols", [])):
            acc, n = accuracy(learning["symbols"].get(sym))
            # blocked symbols still get scan predictions, so recovery is measurable
            if n >= 20 and acc >= 0.55:
                blocked.remove(sym)
                _change(changes, f"block.{sym}", True, False, f"prediction accuracy recovered to {acc * 100:.0f}%")
        if sorted(blocked) != sorted(settings.get("blockedSymbols", [])):
            patch["blockedSymbols"] = blocked

        hours = sorted({int(r["key"]) for r in _group(week, _hour) if r["trades"] >= 8 and r["winRate"] < 30})
        if hours != sorted(settings.get("blockedHours", [])):
            _change(changes, "blockedHours", settings.get("blockedHours", []), hours, "hours (UTC) with <30% win rate this week")
            patch["blockedHours"] = hours

        # Down bets / shorts are never switched off automatically: once off, no new Down results
        # arrive to switch them back on, so the bot got stuck betting Up only. Direction is the
        # signal's job; weights and minimum confidence handle accuracy.

        reg = {r["key"]: r for r in _group(week, lambda t: t.get("regime"))}
        rng, trd = reg.get("ranging"), reg.get("trending")
        if settings.get("minAdx", 0) < 20 and rng and rng["trades"] >= 10 and rng["winRate"] < 35 and (not trd or trd["winRate"] >= 45):
            _change(changes, "minAdx", settings.get("minAdx", 0), 20, f"ranging-market trades won only {rng['winRate']}%")
            patch["minAdx"] = 20

    if changes:
        learning["tuningLog"].insert(0, {"time": now_ms, "changes": changes})
        del learning["tuningLog"][100:]
    learning["lastTuneTradeCount"] = len(paper)
    return patch, changes
