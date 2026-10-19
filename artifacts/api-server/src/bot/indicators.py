"""
Technical indicators and prediction "votes".

Every vote function takes a candle dict of numpy arrays (open/high/low/close/volume)
plus indicator params, and returns a float in [-1, 1]:
  +1 = strongly bullish (price expected to rise), -1 = strongly bearish, 0 = neutral.

Some indicators are trend-following and some are mean-reverting on purpose: the
learner measures how accurate each one is on live data and re-weights them.
"""

from __future__ import annotations

import math
from typing import Callable, Dict

import numpy as np

EPS = 1e-12


# ─── Base series ──────────────────────────────────────────────────────────────

def ema(x: np.ndarray, period: int) -> np.ndarray:
    period = max(1, int(period))
    out = np.empty_like(x, dtype=float)
    alpha = 2.0 / (period + 1)
    out[0] = x[0]
    for i in range(1, len(x)):
        out[i] = alpha * x[i] + (1 - alpha) * out[i - 1]
    return out


def sma(x: np.ndarray, period: int) -> np.ndarray:
    period = max(1, int(period))
    c = np.cumsum(np.insert(x.astype(float), 0, 0.0))
    out = np.full(len(x), np.nan)
    out[period - 1:] = (c[period:] - c[:-period]) / period
    # back-fill the warm-up section so callers never see NaN
    if period - 1 < len(x):
        out[: period - 1] = out[period - 1]
    return out


def wilder(x: np.ndarray, period: int) -> np.ndarray:
    period = max(1, int(period))
    out = np.empty_like(x, dtype=float)
    out[0] = x[0]
    for i in range(1, len(x)):
        out[i] = (out[i - 1] * (period - 1) + x[i]) / period
    return out


def rsi(close: np.ndarray, period: int = 14) -> np.ndarray:
    d = np.diff(close, prepend=close[0])
    gain = wilder(np.clip(d, 0, None), period)
    loss = wilder(np.clip(-d, 0, None), period)
    rs = gain / (loss + EPS)
    return 100 - 100 / (1 + rs)


def true_range(c: Dict[str, np.ndarray]) -> np.ndarray:
    h, l, cl = c["high"], c["low"], c["close"]
    prev = np.roll(cl, 1)
    prev[0] = cl[0]
    return np.maximum(h - l, np.maximum(abs(h - prev), abs(l - prev)))


def atr(c: Dict[str, np.ndarray], period: int = 14) -> np.ndarray:
    return wilder(true_range(c), period)


def adx(c: Dict[str, np.ndarray], period: int = 14):
    h, l = c["high"], c["low"]
    up = np.diff(h, prepend=h[0])
    down = -np.diff(l, prepend=l[0])
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr = wilder(true_range(c), period)
    plus_di = 100 * wilder(plus_dm, period) / (tr + EPS)
    minus_di = 100 * wilder(minus_dm, period) / (tr + EPS)
    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di + EPS)
    return wilder(dx, period), plus_di, minus_di


def _clip(v: float) -> float:
    if v is None or not math.isfinite(v):
        return 0.0
    return float(max(-1.0, min(1.0, v)))


def _z(series: np.ndarray, lookback: int = 50) -> float:
    """Last value of a series expressed in standard deviations of its recent history."""
    tail = series[-lookback:]
    sd = float(np.std(tail))
    return float(series[-1] / (sd + EPS))


# ─── Votes ────────────────────────────────────────────────────────────────────

def vote_rsi(c, p):
    r = rsi(c["close"], p["rsiPeriod"])
    now, prev = r[-1], r[-2]
    os_, ob = p["rsiOversold"], p["rsiOverbought"]
    if now < os_:
        return _clip(0.5 + (os_ - now) / 15)
    if now > ob:
        return _clip(-0.5 - (now - ob) / 15)
    return _clip((now - prev) / 10 * 0.5)


def vote_macd(c, p):
    cl = c["close"]
    line = ema(cl, p["macdFast"]) - ema(cl, p["macdSlow"])
    hist = line - ema(line, p["macdSignal"])
    v = math.tanh(_z(hist))
    if hist[-1] > 0 >= hist[-2]:
        v += 0.4
    elif hist[-1] < 0 <= hist[-2]:
        v -= 0.4
    return _clip(v)


def vote_bollinger(c, p):
    cl = c["close"]
    n = p["bbPeriod"]
    mid = sma(cl, n)
    sd = np.array([np.std(cl[max(0, i - n + 1): i + 1]) for i in range(len(cl) - 3, len(cl))])
    upper, lower = mid[-1] + p["bbStd"] * sd[-1], mid[-1] - p["bbStd"] * sd[-1]
    pb = (cl[-1] - lower) / (upper - lower + EPS)
    return _clip((0.5 - pb) * 2)


def vote_ema(c, p):
    cl = c["close"]
    f, s = ema(cl, p["emaFast"]), ema(cl, p["emaSlow"])
    a = atr(c, p["atrPeriod"])[-1]
    v = math.tanh((f[-1] - s[-1]) / (a + EPS))
    if f[-1] > s[-1] and f[-2] <= s[-2]:
        v += 0.3
    elif f[-1] < s[-1] and f[-2] >= s[-2]:
        v -= 0.3
    return _clip(v)


def vote_stochastic(c, p):
    n = p["stochPeriod"]
    h, l, cl = c["high"], c["low"], c["close"]
    k = np.array([
        100 * (cl[i] - l[max(0, i - n + 1): i + 1].min())
        / (h[max(0, i - n + 1): i + 1].max() - l[max(0, i - n + 1): i + 1].min() + EPS)
        for i in range(len(cl) - 5, len(cl))
    ])
    d = np.mean(k[-3:])
    if k[-1] < 20 and k[-1] > d:
        return _clip(0.6 + (20 - k[-1]) / 40)
    if k[-1] > 80 and k[-1] < d:
        return _clip(-0.6 - (k[-1] - 80) / 40)
    return _clip((50 - k[-1]) / 100)


def vote_adx(c, p):
    a, pdi, mdi = adx(c, p["adxPeriod"])
    return _clip((pdi[-1] - mdi[-1]) / (pdi[-1] + mdi[-1] + EPS) * min(1.0, a[-1] / 25))


def vote_cci(c, p):
    tp = (c["high"] + c["low"] + c["close"]) / 3
    n = 20
    m = sma(tp, n)
    md = np.mean(abs(tp[-n:] - m[-1]))
    cci = (tp[-1] - m[-1]) / (0.015 * md + EPS)
    return _clip(cci / 150)


def vote_williams(c, p):
    n = 14
    hh, ll = c["high"][-n:].max(), c["low"][-n:].min()
    wr = -100 * (hh - c["close"][-1]) / (hh - ll + EPS)
    if wr < -80:
        return _clip(0.5 + (-80 - wr) / 40)
    if wr > -20:
        return _clip(-0.5 - (wr + 20) / 40)
    return 0.0


def vote_mfi(c, p):
    n = 14
    tp = (c["high"] + c["low"] + c["close"]) / 3
    mf = tp * c["volume"]
    d = np.diff(tp[-n - 1:])
    pos = mf[-n:][d > 0].sum()
    neg = mf[-n:][d < 0].sum()
    m = 100 - 100 / (1 + pos / (neg + EPS))
    if m < 20:
        return _clip(0.5 + (20 - m) / 30)
    if m > 80:
        return _clip(-0.5 - (m - 80) / 30)
    return _clip((m - 50) / 100)


def vote_obv(c, p):
    sign = np.sign(np.diff(c["close"], prepend=c["close"][0]))
    obv = np.cumsum(sign * c["volume"])
    slope = obv[-1] - obv[-10]
    sd = np.std(np.diff(obv[-60:])) * math.sqrt(10)
    return _clip(math.tanh(slope / (sd + EPS)))


def vote_vwap(c, p):
    n = 50
    tp = (c["high"] + c["low"] + c["close"]) / 3
    v = c["volume"][-n:]
    vwap = (tp[-n:] * v).sum() / (v.sum() + EPS)
    a = atr(c, p["atrPeriod"])[-1]
    return _clip(math.tanh((c["close"][-1] - vwap) / (2 * a + EPS)))


def vote_supertrend(c, p):
    mult, period = 3.0, 10
    a = atr(c, period)
    hl2 = (c["high"] + c["low"]) / 2
    up, dn = hl2 - mult * a, hl2 + mult * a
    trend = 1
    fu, fd = up[0], dn[0]
    cl = c["close"]
    for i in range(1, len(cl)):
        fu = max(up[i], fu) if cl[i - 1] > fu else up[i]
        fd = min(dn[i], fd) if cl[i - 1] < fd else dn[i]
        if cl[i] > fd:
            trend = 1
        elif cl[i] < fu:
            trend = -1
    return 0.8 * trend


def vote_ichimoku(c, p):
    h, l, cl = c["high"], c["low"], c["close"]
    tenkan = (h[-9:].max() + l[-9:].min()) / 2
    kijun = (h[-26:].max() + l[-26:].min()) / 2
    span_a = (tenkan + kijun) / 2
    span_b = (h[-52:].max() + l[-52:].min()) / 2
    v = 0.4 if tenkan > kijun else -0.4
    top, bot = max(span_a, span_b), min(span_a, span_b)
    if cl[-1] > top:
        v += 0.6
    elif cl[-1] < bot:
        v -= 0.6
    return _clip(v)


def vote_momentum(c, p):
    cl = c["close"]
    roc = (cl[10:] - cl[:-10]) / (cl[:-10] + EPS)
    return _clip(math.tanh(_z(roc)))


def vote_linreg(c, p):
    n = 20
    y = c["close"][-n:]
    x = np.arange(n)
    slope = np.polyfit(x, y, 1)[0]
    a = atr(c, p["atrPeriod"])[-1]
    return _clip(math.tanh(slope * p.get("horizon", 3) / (a + EPS)))


def vote_candles(c, p):
    o, h, l, cl = c["open"], c["high"], c["low"], c["close"]
    body = cl[-1] - o[-1]
    pbody = cl[-2] - o[-2]
    rng = h[-1] - l[-1] + EPS
    if pbody < 0 < body and cl[-1] >= o[-2] and o[-1] <= cl[-2]:
        return 0.8  # bullish engulfing
    if pbody > 0 > body and cl[-1] <= o[-2] and o[-1] >= cl[-2]:
        return -0.8  # bearish engulfing
    lower_wick = min(o[-1], cl[-1]) - l[-1]
    upper_wick = h[-1] - max(o[-1], cl[-1])
    if lower_wick > 2 * abs(body) and upper_wick < 0.3 * rng:
        return 0.5  # hammer
    if upper_wick > 2 * abs(body) and lower_wick < 0.3 * rng:
        return -0.5  # shooting star
    return 0.0


def vote_volume(c, p):
    v = c["volume"]
    avg = v[-21:-1].mean()
    ratio = v[-1] / (avg + EPS)
    if ratio < 1.3:
        return 0.0
    return _clip(np.sign(c["close"][-1] - c["open"][-1]) * min(1.0, ratio - 1))


def vote_flow(c, p):
    """Order flow: share of volume bought by aggressive (taker) buyers in the last 3 candles,
    against its usual level. More taker buying than usual → Up, more selling → Down."""
    if "taker" not in c:
        return 0.0
    v, t = c["volume"], c["taker"]
    ratio = (t + EPS) / (v + 2 * EPS)  # 0..1, 0.5 = balanced
    recent = ratio[-3:].mean()
    base, sd = ratio[-60:-3].mean(), ratio[-60:-3].std() + 0.01
    return _clip(math.tanh((recent - base) / (2 * sd)))


def vote_trend(c, p):
    cl = c["close"]
    e = ema(cl, 100)
    a = atr(c, p["atrPeriod"])[-1]
    return _clip(math.tanh((cl[-1] - e[-1]) / (3 * a + EPS)))


# name -> (label, kind, function). Kind is shown in the UI.
INDICATORS: Dict[str, tuple] = {
    "rsi": ("RSI", "reversal", vote_rsi),
    "macd": ("MACD", "momentum", vote_macd),
    "bollinger": ("Bollinger Bands", "reversal", vote_bollinger),
    "ema": ("EMA Cross", "trend", vote_ema),
    "stochastic": ("Stochastic", "reversal", vote_stochastic),
    "adx": ("ADX / DMI", "trend", vote_adx),
    "cci": ("CCI", "momentum", vote_cci),
    "williams": ("Williams %R", "reversal", vote_williams),
    "mfi": ("Money Flow Index", "reversal", vote_mfi),
    "obv": ("On-Balance Volume", "volume", vote_obv),
    "vwap": ("VWAP", "trend", vote_vwap),
    "supertrend": ("Supertrend", "trend", vote_supertrend),
    "ichimoku": ("Ichimoku", "trend", vote_ichimoku),
    "momentum": ("Rate of Change", "momentum", vote_momentum),
    "linreg": ("Linear Regression Forecast", "prediction", vote_linreg),
    "candles": ("Candlestick Patterns", "pattern", vote_candles),
    "volume": ("Volume Spike", "volume", vote_volume),
    "flow": ("Order Flow (taker buy/sell)", "volume", vote_flow),
    "trend": ("EMA-100 Trend", "trend", vote_trend),
}

# The AI model is a learned indicator (see learner.py) and is added on top.
AI_KEY = "ai"
AI_LABEL = ("AI Model (self-learning)", "prediction")

MIN_CANDLES = 120


def compute_votes(c: Dict[str, np.ndarray], params: dict, enabled: Callable[[str], bool]) -> Dict[str, float]:
    votes: Dict[str, float] = {}
    for key, (_label, _kind, fn) in INDICATORS.items():
        if not enabled(key):
            continue
        try:
            votes[key] = round(_clip(fn(c, params)), 4)
        except Exception:
            votes[key] = 0.0
    return votes


def market_context(c: Dict[str, np.ndarray], params: dict) -> dict:
    a, _, _ = adx(c, params["adxPeriod"])
    at = atr(c, params["atrPeriod"])
    return {
        "atr": float(at[-1]),
        "adx": float(a[-1]),
        "rsi": float(rsi(c["close"], params["rsiPeriod"])[-1]),
        "regime": "trending" if a[-1] >= 25 else "ranging",
    }
