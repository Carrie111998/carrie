#!/usr/bin/env python3
"""
Community learning: pool every user's settled trades (dummy paper, paper and live)
into one anonymous dataset and learn from it.

Run by the API server every few minutes:  python3 collective.py <DATA_DIR>
Writes <DATA_DIR>/global/collective.json with:
  - trades: compact anonymous trades (no names/emails/order ids; user = short hash)
  - indicators / model: accuracy stats and AI model trained on all trades
  - recommended: settings auto-tune derives from all trades (used as new-user defaults)
  - summary: users, trade counts, win rate, loss study
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import learner  # noqa: E402
from binance_bot import DEFAULT_SETTINGS, merge_settings  # noqa: E402

MAX_TRADES = 20000
KEEP = ("mode", "kind", "symbol", "side", "result", "pnl", "pnlPct", "confidence", "openTime", "closeTime",
        "regime", "exitReason", "heldCandles", "votes", "quote")


def user_tag(user_id: str) -> str:
    return hashlib.sha256(user_id.encode()).hexdigest()[:10]


def analyse(trades: list, indicators: dict) -> dict:
    """Compact breakdown of settled trades for the server log: what wins and what loses."""
    def grp(keyfn):
        out = {}
        for t in trades:
            k = keyfn(t)
            if k is None:
                continue
            g = out.setdefault(str(k), [0, 0, 0.0])
            g[0] += 1
            g[1] += t["result"] == "win"
            g[2] += t.get("pnl") or 0
        return {k: f"{v[0]}t {100 * v[1] / v[0]:.0f}% {v[2]:+.2f}" for k, v in sorted(out.items())}

    def conf_floor(t):
        c = t.get("confidence") or 0
        return min(80, int(c // 5) * 5)

    at_least = {}
    for th in (40, 45, 50, 55, 60, 65, 70, 75):
        sub = [t for t in trades if (t.get("confidence") or 0) >= th]
        if sub:
            w = sum(1 for t in sub if t["result"] == "win")
            at_least[f">={th}"] = f"{len(sub)}t {100 * w / len(sub):.0f}% {sum(t.get('pnl') or 0 for t in sub):+.2f}"
    ind = {k: f"{100 * learner.accuracy(v)[0]:.0f}%/{learner.accuracy(v)[1]:.0f}" for k, v in sorted(indicators.items())}
    return {
        "byConfidenceBucket": grp(conf_floor), "confidenceAtLeast": at_least,
        "byCoin": grp(lambda t: t.get("symbol")), "byDirection": grp(lambda t: t.get("side")),
        "byCoinDirection": grp(lambda t: f"{t.get('symbol', '')[:3]}-{t.get('side')}"),
        "byHourUTC": grp(lambda t: time.gmtime((t.get("openTime") or 0) / 1000).tm_hour),
        "byMode": grp(lambda t: t.get("mode")), "indicatorAccuracy": ind,
    }


def main(data_dir: str):
    trades = []
    users = 0
    for path in glob.glob(os.path.join(data_dir, "users", "*", "bot_data.json")):
        user_id = os.path.basename(os.path.dirname(path))
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception:
            continue
        own = [t for t in data.get("trades", []) if t.get("result") in ("win", "loss")]
        if own:
            users += 1
        tag = user_tag(user_id)
        for t in own:
            c = {k: t.get(k) for k in KEEP}
            c["user"] = tag
            c["mode"] = c.get("mode") or "paper"
            # direction the price actually moved while the trade was open (for indicator accuracy)
            entry, exit_ = t.get("entryPrice"), t.get("exitPrice")
            c["actual"] = 0 if not entry or not exit_ else (1 if exit_ > entry else -1 if exit_ < entry else 0)
            trades.append(c)

    trades.sort(key=lambda t: t.get("closeTime") or 0, reverse=True)
    trades = trades[:MAX_TRADES]

    learning = learner.empty_learning()
    for t in reversed(trades):  # oldest first so decay favours recent behaviour
        if t["actual"] and t.get("votes"):
            learner.record_outcome(learning, t["votes"], t["actual"])

    # One brain: every bot uses the same AI model — the most-trained one any bot has built
    # (each bot trains on every prediction it scores, far more samples than settled trades).
    best = None
    for path in glob.glob(os.path.join(data_dir, "users", "*", "bot_data.json")):
        try:
            with open(path) as f:
                m = json.load(f).get("learning", {}).get("model")
        except Exception:
            continue
        if m and m.get("samples", 0) > (best or {}).get("samples", 0):
            best = m
    if best and best.get("samples", 0) > learning["model"].get("samples", 0):
        learning["model"] = best
    best_ind = {}
    for path in glob.glob(os.path.join(data_dir, "users", "*", "bot_data.json")):
        try:
            with open(path) as f:
                ind = json.load(f).get("learning", {}).get("indicators", {})
        except Exception:
            continue
        if sum(v.get("total", 0) for v in ind.values()) > sum(v.get("total", 0) for v in best_ind.values()):
            best_ind = ind

    # what auto-tune would choose for a fresh account, learning from everybody's prediction bets
    # the shared brain (admin's strategy settings) is what gets tuned, when it exists
    brain_file = os.path.join(data_dir, "global", "brain.json")
    brain, tune_since = {}, 0
    try:
        with open(brain_file) as f:
            bf = json.load(f)
        brain, tune_since = bf.get("settings", {}), int(bf.get("tuneSince") or 0)
    except Exception:
        pass
    base = merge_settings(DEFAULT_SETTINGS, brain)
    # live results count as evidence too; only trades since the brain's tuneSince (older ones were biased)
    tune_view = [dict(t, mode="paper") for t in trades if (t.get("openTime") or 0) >= tune_since]
    recommended, changes = ({}, [])
    if len(tune_view) >= 15:
        recommended, changes = learner.autotune(dict(base, tuneRisk=False), learning, tune_view, int(time.time() * 1000))

    wins = sum(1 for t in trades if t["result"] == "win")
    by_mode = {}
    for t in trades:
        key = f"{t['mode']}-{t.get('kind') or 'spot'}"
        m = by_mode.setdefault(key, {"trades": 0, "wins": 0, "pnl": 0.0})
        m["trades"] += 1
        m["wins"] += t["result"] == "win"
        m["pnl"] = round(m["pnl"] + (t.get("pnl") or 0), 4)

    out = {
        "version": 2,
        "updatedAt": int(time.time() * 1000),
        "users": users,
        "trades": trades,
        "indicators": learning["indicators"],
        "model": learning["model"],
        "recommended": recommended,
        "changes": changes,
        "analysis": {"all": analyse(trades, best_ind), "sinceFix": analyse([t for t in trades if (t.get("openTime") or 0) >= tune_since], {})},
        "summary": {
            "trades": len(trades), "wins": wins,
            "winRate": round(100 * wins / len(trades), 1) if trades else None,
            "byMode": by_mode,
            # Up vs Down balance, to spot a one-sided bot quickly
            "byDirection": {d: {"trades": len(x), "wins": sum(1 for t in x if t["result"] == "win")}
                            for d in ("long", "short") for x in [[t for t in trades if t.get("side") == d]]},
            "lossStudy": learner.loss_study([dict(t, mode="paper") for t in trades[:2000]]),
        },
    }
    gdir = os.path.join(data_dir, "global")
    os.makedirs(gdir, exist_ok=True)
    tmp = os.path.join(gdir, "collective.json.tmp")
    with open(tmp, "w") as f:
        json.dump(out, f, default=float)
    os.replace(tmp, os.path.join(gdir, "collective.json"))
    print(json.dumps({"users": users, "trades": len(trades), "recommended": list(recommended),
                      "up": out["summary"]["byDirection"]["long"], "down": out["summary"]["byDirection"]["short"],
                      "minConfidence": recommended.get("minConfidence"), "analysis": out["analysis"]}))


if __name__ == "__main__":
    main(sys.argv[1])
