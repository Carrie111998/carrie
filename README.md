# Binance Predict Bot — v3.1.3

See [CHANGELOG.md](CHANGELOG.md) for what changed; older versions are archived in [`archive/`](archive/).

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
PORT=8080 SMTP_HOST=smtp.gmail.com SMTP_USER=you@gmail.com SMTP_PASS=app-password node artifacts/api-server/dist/index.mjs
```

On Replit, the existing run configuration starts both services.

### Docker (recommended for a server)

```bash
cp .env.example .env      # add your SMTP email settings (for sign-up codes)
docker compose up -d --build
```

The app runs on port **8888** (`docker-compose.yml` also has Traefik labels for `trader.srv1854512.hstgr.cloud`; change the `Host(...)` rule to use your own domain). All users, trades, learning data and API keys live in the `trader-data` volume, so they survive rebuilds and restarts. Don't delete that volume. If email isn't configured, read sign-up codes with `docker logs binance-predict-bot | grep code`.


| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (required) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email server used to send sign-up and password-reset codes (OTP). For Gmail use `smtp.gmail.com`, port 587 and an [app password](https://myaccount.google.com/apppasswords). **If not set, codes are written to the server log instead.** |
| `DEFAULT_SIGNUP_CODE` | Code that sign-up accepts **only while SMTP is not configured** (default `986796`). Password resets never accept it. |
| `DEVICE_GATE` | `on` (default): sign-up, login and password reset only accept requests from Android/iOS phones using the installed app. `off` for testing. |
| `AUTH_RATE_LIMIT` | Auth requests allowed per IP per 10 minutes (default 30) |
| `MAX_USERS` | Maximum number of accounts that can sign up (default 50) |
| `BOT_DATA_DIR` | Where trades, learning data, settings and API keys are saved (default `./data`, git-ignored) |
| `BOT_SIMULATE=1` | Offline simulated prices and orders, for testing without Binance |

## Features

- **One shared brain**: every user's bot runs the same strategy, managed by the admin and auto-tuned from all users' trades. Users only choose coins (BTC/ETH/BNB), slot time (5m/15m/1h), run time, amounts and limits.
- **Phone app only**: open the link on an Android phone (Chrome) or iPhone (Safari), tap **Download App** / follow the Add to Home Screen steps, then open it from the Home Screen. Computers and tablets are blocked.
- **Accounts**: a login page opens first. Sign up with a username, email and password, then confirm the 6-digit code sent to your email. You can log in with your username or email, and there is a "Forgot password" option that also uses an email code. Many users can sign up, and **each one gets their own bot, settings, API keys, paper account and trade history** in `data/users/<id>/`. Passwords are hashed with scrypt and sessions last 30 days.
- **Bet amount**: choose a fixed USD amount per trade (**standard and minimum is $1**, with quick picks $1/$2/$5/$10/$25/$50) or a % of the paper balance. Live orders have their own size. Binance rejects orders under about 5 USDT on most pairs, so live defaults to $5.

- **18 indicators and prediction tools, plus a self-learning AI model**: RSI, MACD, Bollinger Bands, EMA cross, Stochastic, ADX/DMI, CCI, Williams %R, MFI, OBV, VWAP, Supertrend, Ichimoku, Rate of Change, Linear-regression forecast, Candlestick patterns, Volume spikes, EMA-100 trend, and an online logistic-regression model trained on real outcomes. Votes (-1…+1) are combined by learned weights into one direction and a 0–100 confidence.
- **Admin area** (only for `carriepatrick80@gmail.com`, or the emails in `ADMIN_EMAILS`): see all users and their emails, edit them, reset a password to the default `123456` (the user must change it at next login), put an account on hold (stops all paper and live trading) or resume it, and delete accounts.
- **Fixed bet size**: every bet is the same amount (default **$1.50**), never raised after a loss. The Dashboard shows the break-even win rate next to the actual one.
- **Community learning**: all users' settled trades (dummy, paper and live) are pooled anonymously every 10 minutes to tune indicator weights, confidence and filters for everyone; new users start with the learned settings. Can be switched off per user.
- **Paper trading modes**: *Dummy Binance Prediction* (default) places a pretend Up/Down bet (default $1, at an assumed 0.50 share price) on every slot and settles it when the slot closes, so the loss study and auto-tune learn from prediction-style results. *Dummy Spot* trades pretend long/short positions instead.
- **Auto paper trading** while the bot runs: ATR-based stop-loss and take-profit, max hold time, fees, long and short.
- **Binance Prediction Market (default live venue)**: connect your Binance Agentic Wallet in Settings (pairing code confirmed in the Binance App — no API key). At the start of every slot the bot bets the set USDT amount (minimum 1) on Up or Down for the chosen pair, within a max exposure and daily loss limit, and auto-claims winnings. **Dry run** (quotes only) is on by default; **Find markets** shows which market the bot will use. Uses Binance's official `baw` CLI (`@binance/agentic-wallet`); each user's wallet session is stored in `data/users/<id>/baw`.
- **Live trading switch** (requires typing START to confirm): long signals are also sent to Binance Spot as market orders, with a fixed USDT size, a max number of open positions and a daily loss limit that switches live trading off. Testnet is supported and is the default.
- **API key and secret fields** in Settings, stored server-side only (`data/credentials.json`, mode 600) and never sent back to the browser. There is also a Test connection button.
- **Accuracy meter**: overall accuracy score, prediction accuracy, win rate over the last 20 and 50 trades, and per-indicator accuracy.
- **Loss study**: losses broken down by exit reason, pair, hour, confidence, market regime and direction, plus the indicators that backed losing trades, with plain-English insights.
- **Auto-tune**: every N closed trades it re-weights indicators, moves the minimum confidence, adjusts SL/TP, and blocks weak pairs, hours, shorts and ranging markets. Every change is logged with its reason.
- **Calibrate**: learns from the last 1000 historical candles per pair before risking anything.
- **All data is kept**: trades, paper account, learning and settings are saved to disk and survive restarts. Bots that were paper trading resume automatically after a server restart. Live trading always needs to be switched on again. Trades export to CSV.
- **Mobile-first dashboard**: Dashboard, Signals, Learning, History and Settings, with bottom navigation on phones.

## Code map

- `artifacts/api-server/src/bot/binance_bot.py` — trading engine (scan, signals, paper/live positions, persistence)
- `artifacts/api-server/src/bot/indicators.py` — indicators and votes
- `artifacts/api-server/src/bot/learner.py` — accuracy tracking, AI model, loss study, auto-tune
- `artifacts/api-server/src/bot/binance_client.py` — Binance REST client (public, signed, testnet) and offline simulator
- `artifacts/api-server/src/auth.ts` — users, email OTP, sessions
- `artifacts/api-server/src/bot/engine.ts`, `settings.ts`, `src/routes.ts` — Node process manager, settings validation, REST API (`/api`) and WebSocket (`/ws`)
- `artifacts/trading-bot/src/` — React dashboard

## Safety

- Create Binance API keys with spot trading only. **Never enable withdrawals**, and restrict the key to your server's IP.
- Start with paper trading and the testnet (testnet.binance.vision). A high past win rate does not guarantee future profit, so only trade money you can afford to lose.
- Binance blocks some regions (for example the US) on api.binance.com. Market data falls back between `data-api.binance.vision` and `api.binance.com`. US users need Binance.US, which this bot does not target.
