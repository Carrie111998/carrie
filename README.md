# Binance Predict Bot — v3.4.0

See [CHANGELOG.md](CHANGELOG.md) for what changed; older versions are archived in [`archive/`](archive/).

A self-learning bot for **Binance Prediction**'s 5-minute "Up or Down" rounds on BTC, ETH and BNB. It places practice bets on every good signal, studies its results, auto-tunes one shared strategy from all users' trades, and can place real bets on Binance Prediction (QR-code Agentic Wallet or your Binance API key). Spot trading was removed in v3.4.0.

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
| `DEVICE_GATE` | `off` (default): the app works in any browser on any device. `on`: sign-up, login and password reset only accept Android/iOS phones using the installed app. |
| `AUTH_RATE_LIMIT` | Auth requests allowed per IP per 10 minutes (default 30) |
| `MAX_USERS` | Maximum number of accounts that can sign up (default 50) |
| `BOT_DATA_DIR` | Where trades, learning data, settings and API keys are saved (default `./data`, git-ignored) |
| `ADMIN_EMAILS` | Comma-separated admin emails (default `carriepatrick80@gmail.com`) |
| `BOT_SIMULATE=1` | Offline simulated prices and orders, for testing without Binance |
| `BINANCE_PREDICTION_API_BASE` | Override the Prediction Trading API address (offline tests only; default `https://api.binance.com`) |

## Features

- **Binance Prediction only**: every bet is on Binance Prediction's 5-minute Up or Down rounds (e.g. "BTC Up or Down 5m") for BTC, ETH and BNB — the markets at <https://www.binance.com/en/prediction/trending/up-down-crypto>.
- **One shared brain**: every user's bot runs the same strategy, managed by the admin and auto-tuned from all users' trades. Users only choose coins, run time (15 min … 12 h or ∞), bet amounts and limits.
- **When it bets**: at any moment of the running round (until 30 s before it closes) when its confidence is at least 60%, a win pays at least **1.40×** (+0.40 per 1 USDT) and its win chance — which also counts how far the price has moved since the round opened — beats the share price by 5 points. At most one bet per coin per round. Practice and real bets follow exactly the same rules.
- **Real bets, two ways to connect** (Settings → Connect Binance Prediction):
  - **QR code** — Binance's official Agentic Wallet (`baw` CLI, `@binance/agentic-wallet`); each user's session is kept in `data/users/<id>/baw`.
  - **My API key** — Binance's [Prediction Trading REST API](https://developers.binance.com/en/docs/catalog/web3-wallet-prediction-trading/api/rest-api). Needs a Prediction account and Prediction SAS authorization in the Binance app, and the **Prediction Trading** permission on a live (not testnet) API key. Bets are paid from the Prediction wallet or the main Binance (Spot) wallet.
  - Test mode (quotes only), a fixed bet per round, a daily loss limit, a cap on money in open bets and auto-claim of winnings every 5 minutes. **Markets the bot bets on** shows the exact Binance market and round each real bet goes to.
- **Live switch** (type START to confirm). It stays on through server restarts and deploys, and switches off when you turn it off, stop the bot, hit the daily loss limit, the run time ends or the account is put on hold.
- **Open bets, live**: every open bet (LIVE, TEST, PAPER) shows the coin's live price against the price to beat, whether it is winning or losing right now and by how much, and a countdown to the end of the round — on the Dashboard and in Signals → Active bets.
- **Works everywhere**: any browser on phones, tablets, laptops and desktops. On phones it can also be installed to the Home Screen.
- **Accounts**: sign up with a username, email and password, then confirm the 6-digit code sent by email; log in with username or email; "Forgot password" also uses an email code. Each user has their own bot, settings, API key, practice account and history in `data/users/<id>/`. Passwords are hashed with scrypt; sessions last 30 days.
- **20 indicators and a self-learning AI model**: RSI, MACD, Bollinger Bands, EMA cross, Stochastic, ADX/DMI, CCI, Williams %R, MFI, OBV, VWAP, Supertrend, Ichimoku, Rate of Change, linear-regression forecast, candlestick patterns, volume spikes, order flow (taker buy/sell), EMA-100 trend and an online logistic-regression model. Votes are combined by learned weights into a direction and a 50–100 confidence (50 = coin flip).
- **Admin area** (`carriepatrick80@gmail.com`, or the emails in `ADMIN_EMAILS`): users, password reset to `123456` (must be changed at next login), hold/resume, delete; the shared brain's strategy settings and its change log.
- **Learning page (admin)**: prediction accuracy, community win rates, loss study, per-indicator accuracy and weights, and every auto-tune change with its reason.
- **All data is kept**: trades, practice account, learning and settings are saved to disk and survive restarts. Trades export to CSV.

## Code map

- `artifacts/api-server/src/bot/binance_bot.py` — engine (scan, signals, practice and real Prediction bets, settlement, persistence)
- `artifacts/api-server/src/bot/indicators.py` — indicators and votes
- `artifacts/api-server/src/bot/learner.py` — accuracy tracking, AI model, loss study, auto-tune
- `artifacts/api-server/src/bot/prediction_market.py` — Binance Prediction via the Agentic Wallet CLI; market and round matching
- `artifacts/api-server/src/bot/prediction_api.py` — Binance Prediction Trading REST API (API key)
- `artifacts/api-server/src/bot/binance_client.py` — Binance market data and offline simulator
- `artifacts/api-server/src/auth.ts` — users, email OTP, sessions
- `artifacts/api-server/src/bot/engine.ts`, `settings.ts`, `src/routes.ts` — Node process manager, settings validation, REST API (`/api`) and WebSocket (`/ws`)
- `artifacts/trading-bot/src/` — React dashboard

## Safety

- For an API key: tick only **Prediction Trading** (and reading). **Never enable withdrawals**, and restrict the key to your server's IP.
- Start in test mode and with practice bets. Prediction bets can go to zero, and a high past win rate does not guarantee future profit — only bet money you can afford to lose.
- Binance blocks some regions (for example the US). Market data falls back between `data-api.binance.vision` and `api.binance.com`.
