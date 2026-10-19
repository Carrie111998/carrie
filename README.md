# Binance Predict Bot

A self-learning Binance crypto prediction bot. It paper-trades every signal, studies its losing trades, auto-tunes its own settings, and can optionally place real Binance Spot orders.

## Run

Requirements: Node 20+ with pnpm, and Python 3.10+ with NumPy (`pip install numpy`).

```bash
pnpm install
# Development (two terminals)
PORT=8080 pnpm --filter @workspace/api-server run dev
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/trading-bot run dev
# Production: one process serves API + dashboard
PORT=1 BASE_PATH=/ pnpm --filter @workspace/trading-bot run build
pnpm --filter @workspace/api-server run build
PORT=8080 APP_PASSWORD=choose-a-password node artifacts/api-server/dist/index.mjs
```

On Replit, the existing run configuration starts both services.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (required) |
| `APP_PASSWORD` | Optional. Protects the dashboard and API with a password. **Set it whenever the app is reachable from the internet**, because it controls live trading. |
| `BOT_DATA_DIR` | Where trades, learning data, settings and API keys are saved (default `./data`, git-ignored) |
| `BOT_SIMULATE=1` | Offline simulated prices and orders, for testing without Binance |

## Features

- **18 indicators and prediction tools, plus a self-learning AI model**: RSI, MACD, Bollinger Bands, EMA cross, Stochastic, ADX/DMI, CCI, Williams %R, MFI, OBV, VWAP, Supertrend, Ichimoku, Rate of Change, Linear-regression forecast, Candlestick patterns, Volume spikes, EMA-100 trend, and an online logistic-regression model trained on real outcomes. Votes (-1…+1) are combined by learned weights into one direction and a 0–100 confidence.
- **Auto paper trading** while the bot runs: ATR-based stop-loss and take-profit, max hold time, fees, long and short.
- **Live trading switch** (requires typing START to confirm): long signals are also sent to Binance Spot as market orders, with a fixed USDT size, a max number of open positions and a daily loss limit that switches live trading off. Testnet is supported and is the default.
- **API key and secret fields** in Settings, stored server-side only (`data/credentials.json`, mode 600) and never sent back to the browser. There is also a Test connection button.
- **Accuracy meter**: overall accuracy score, prediction accuracy, win rate over the last 20 and 50 trades, and per-indicator accuracy.
- **Loss study**: losses broken down by exit reason, pair, hour, confidence, market regime and direction, plus the indicators that backed losing trades, with plain-English insights.
- **Auto-tune**: every N closed trades it re-weights indicators, moves the minimum confidence, adjusts SL/TP, and blocks weak pairs, hours, shorts and ranging markets. Every change is logged with its reason.
- **Calibrate**: learns from the last 1000 historical candles per pair before risking anything.
- **All data is kept**: trades, paper account, learning and settings are saved to disk and survive restarts. Trades export to CSV.
- **Mobile-first dashboard**: Dashboard, Signals, Learning, History and Settings, with bottom navigation on phones.

## Code map

- `artifacts/api-server/src/bot/binance_bot.py` — trading engine (scan, signals, paper/live positions, persistence)
- `artifacts/api-server/src/bot/indicators.py` — indicators and votes
- `artifacts/api-server/src/bot/learner.py` — accuracy tracking, AI model, loss study, auto-tune
- `artifacts/api-server/src/bot/binance_client.py` — Binance REST client (public, signed, testnet) and offline simulator
- `artifacts/api-server/src/bot/engine.ts`, `settings.ts`, `src/routes.ts` — Node process manager, settings validation, REST API (`/api`) and WebSocket (`/ws`)
- `artifacts/trading-bot/src/` — React dashboard

## Safety

- Create Binance API keys with spot trading only. **Never enable withdrawals**, and restrict the key to your server's IP.
- Start with paper trading and the testnet (testnet.binance.vision). A high past win rate does not guarantee future profit, so only trade money you can afford to lose.
- Binance blocks some regions (for example the US) on api.binance.com. Market data falls back between `data-api.binance.vision` and `api.binance.com`. US users need Binance.US, which this bot does not target.
