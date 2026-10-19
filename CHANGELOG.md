# Changelog

All versions of the bot. Older versions are kept as zip files in [`archive/`](archive/).

## v3.3.3 — 2026-10-19

- **5-minute rounds only** for everyone (15 min removed; anyone on 15 min moves to 5 min).
- **Bets any time during the running round** — until 30 s before it closes (was: not in the last 60 s) — whenever the payout (≥ 1.40×) and the edge are good, not only at the start of a new round.
- **Mid-round win estimate**: the bot's win chance now counts how far the price has already moved since the round opened; its signal only adds its lean for the time that is left. This stops it from buying a cheap share on the side that is already losing late in the round.

## v3.3.2 — 2026-10-19

- **"Markets the bot bets on"** (Settings → Prediction Market) replaces the old search box: one button shows, for every coin, the exact Binance Prediction market and round ("BTC Up or Down 5m", round 18:40–18:45) each real bet goes to, with the live Up/Down prices. It uses the same lookup as real bets, so what you see is what the bot bets on.

## v3.3.1 — 2026-10-19

- **Fixed real bets never being placed** ("current round ends 18:30, not at this slot's close 18:10"): Binance lists each round of a recurring "ETH Up or Down 5m" series as its own market in the detail's timeline. The bot now switches to the round that closes with the current slot instead of the series' newest round.
- **Bet when a win pays +0.40 or more per 1 USDT** (minimum payout 1.40×, was 1.65×) — also on rounds already running.
- Minimum confidence back to a fixed 60% (auto-tune had raised it to 82%, blocking every bet); auto-tune can never raise it above 65%.

## v3.3.0 — 2026-10-19

- **Prediction bets with your Binance API key**: Settings → Connect Binance → Prediction Market → "Connect Prediction with: My API key". Uses Binance's official Prediction Trading REST API (`/sapi/v1/w3w/wallet/prediction/*`) with the API key saved in Settings — no QR sign-in needed. Same bets, quotes, rules and auto-claim as the Agentic Wallet.
- Pay bets from the **Prediction wallet** (MPC) or your **Binance Spot** USDT (CEX).
- Needs on Binance: a Prediction account, Prediction SAS authorization in the Binance app, and the "Prediction Trading" permission on the API key.
- Changing the connection method switches real betting off until it is switched on again.

## v3.2.5 — 2026-10-19

- **Claim winnings now** button (Settings → Connect Binance → Prediction Market): redeems every winning position into the Agentic Wallet right away, besides the automatic claim every 5 minutes.

## v3.2.4 — 2026-10-19

- **Fixed "Redeem failed: SERVICE_ERROR: chainId not supported"**: auto-claim now passes `--binanceChainId` (56 BSC, or the position's own chain) to `baw prediction trade redeem`, grouping winning positions by chain.

## v3.2.3 — 2026-10-19

- **Real bets find ETH and BNB markets**: Binance runs recurring series titled "ETH Up or Down 5m", "BNB Up or Down 15m" etc. The bot now matches the series by coin and slot length (never a 15m/1h/1d market for a 5m slot), loads its details and only bets when the current round ends exactly at the slot's close. Before, it only accepted search results with a matching end time and listed outcomes, so ETH/BNB were reported as "no market". If nothing matches, the log lists what Binance returned.

## v3.2.2 — 2026-10-19

- Prediction slots are 5 or 15 minutes only (1 hour removed); anyone on 1 hour moves to 5 minutes.

## v3.2.1 — 2026-10-19

- **Fixed bot engine crash during real betting / Find markets**: the Binance `baw` CLI shared the engine's command pipe and could break it, so the engine shut down (and live betting switched off). The CLI now runs without access to it, and the engine no longer treats a temporary pipe read error as shutdown.
- If the engine ever restarts by itself, live betting that was switched on is switched back on (a full server restart still turns it off).
- Coins without a Binance Prediction market at the chosen slot length are skipped for real bets with one warning, re-checked every 30 minutes, instead of failing every slot.

## v3.2.0 — 2026-10-19 (branch `release/v3.2.0`)

- **Open to every device and browser**: the phone-only gate and the installed-app requirement are removed — the app (sign-up, login, everything) works in any browser on iPhone, Android, tablets, laptops and desktops. Server-side login protection stays: per-IP rate limit, single-use 10-minute email codes with attempt limits, failed-login lockout. `DEVICE_GATE=on` brings the old phone-only rule back. Phones can still install it to the Home Screen from the browser menu.

## v3.1.3 — 2026-10-19

- Shared brain (admin's choice): minimum confidence back to 60% and fixed (auto-tune had raised it to 84% from ~50 bets, so no bet passed), and Down bets switched back on. Real betting stays in test mode until switched off by the user.

## v3.1.2 — 2026-10-19

- **Fresh start** (admin's request, runs once on update): every user's practice trades, practice balance, AI model, indicator statistics and slot history are deleted, plus the pooled community dataset and the brain's change log. Kept: accounts, settings, API keys, wallet connections, the shared strategy settings, and anything involving real money (live trades, open live positions, unsettled real bets).

## v3.1.1 — 2026-10-19

- **AI model can't lean one way anymore**: it learns from each vote minus that vote's usual level and from every outcome mirrored (Up⇄Down), and ignores the slow trend vote. Before, a vote stuck near +1 let it learn "the market fell lately" as a permanent Down lean (live AI vote sat at about −0.75 on every coin). AI models restart once with the new training.
- **Each shared bet counted once**: all users' bots place the same bet, so auto-tune and the trade analysis now count it once instead of once per user.
- **Safer auto-tune blocks**: an hour is blocked only after 30+ distinct bets this week with under 35% wins (it clears itself as trades age out); coins are never blocked automatically. The 09:00 UTC block learned from 4 double-counted bets was removed.

## v3.1.0 — 2026-10-19 (branch `release/v3.1.0`)

Research-based betting rules (5-minute crypto Up/Down markets are close to random and bot-dominated; the edge comes from comparing your win estimate with the executable price and from order flow):
- **Order-flow indicator** (new, weight 1.5): taker buy vs. sell imbalance of the last 3 candles against its usual level, from Binance kline taker volume.
- **Honest confidence scale**: 50% = coin flip, 100% = everything agrees strongly (before, a coin flip showed ~30%, so 60% was almost never reached and almost no bets were placed).
- **Edge rule** (new admin setting *Minimum edge*, default 5 points): bet only when confidence beats the share price by at least 5 points, e.g. 60% vs. a 0.52 share. Same for practice and real bets, together with the 1.65× minimum payout and the 60% minimum confidence.

## v3.0.7 — 2026-10-19

- Indicator weights set from the analysis of all 103 settled trades: on 5-minute slots the "snap-back" indicators won most (Bollinger 58%, Stochastic 56%, AI 55%, Williams %R 54%) and trend followers lost (OBV 39%, CCI 42%, MACD/Momentum 43%), so the former now count up to 1.8× and the latter 0.3–0.6×. Auto-tune keeps refining weights from new trades.

## v3.0.6 — 2026-10-19

- Every bet (practice and real) needs at least **60% confidence**; auto-tune keeps that fixed (admin can change it in the shared brain).
- Every user's coins, slot time and practice mode copied from the admin once; amounts, limits and wallets stay personal.
- Community learning logs a full trade analysis (win rate and P&L by confidence, coin, direction, coin+direction, hour, mode, and each indicator's accuracy) to the server log.

## v3.0.5 — 2026-10-19

- **Practice bets = real bets**: one rule book decides both — clear Up/Down signal, minimum confidence, Down bets allowed, coin/hour not blocked, bets-per-slot cap, at least 20% of the slot left, and the **payout must be at least the minimum (default 1.65×)**. Real bets use Binance's live quote; practice bets use a fair-price estimate (distance from the price to beat, time left and recent volatility, plus a small spread). Real bets additionally respect your wallet limits (daily loss, max open money).
- **Bets during a running slot**: the bot re-checks every scan and bets as soon as the rules pass and the payout reaches the minimum — not only at the slot's start. If the payout is too low it waits and checks again.
- Admin setting *Minimum payout (×)* in the shared brain; the Dashboard explains the payout rule and the break-even win rate.
- Auto-tune now learns only from trades after this update (older trades came from the Up-biased bot), and coin/hour blocks learned from them were cleared.
- Logs show why a slot got no bet (e.g. "confidence 58% < 62%", "payout 1.52x < 1.65x").

## v3.0.4 — 2026-10-19

- **Practice bets on every slot, Up or Down**: dummy Prediction bets no longer need the minimum confidence (that limit only ever let the old Up-biased predictions through, so every past bet was Up). Auto-tune now gets a fair record of which confidence levels win. Real-money bets still need the minimum confidence.
- **One AI model for every bot**: all bots use the most-trained model (shared via community learning), so every user gets the same prediction for the same coin and slot.

## v3.0.3 — 2026-10-19

- The slow EMA-100 trend no longer votes directly on each slot's Up/Down decision or confidence. In a long uptrend it sat at about +0.97 on every coin, so Down predictions were rarely confident enough to bet. It still feeds the AI model.

## v3.0.2 — 2026-10-19

- Diagnostics in the server log (Hostinger → Docker logs): each slot summary lists every coin's prediction (Up/Down, confidence, score, AI and trend votes), startup shows each user's Up/Down trade counts, and community learning logs pooled Up/Down results.

## v3.0.1 — 2026-10-19

- **Fixed "all bets are Up"**: auto-tune could switch *Allow Down bets* off after a run of losing Down bets, and nothing could ever switch it back on (no new Down results arrive while it's off), so the bot only bet Up. Auto-tune no longer switches Down bets off, and the update turns them back on once in the shared brain (logged on the Learning page).
- Learning page shows how many Up vs Down bets all users have placed and how often each won.

## v3.0.0 — 2026-10-19 (branch `release/v3.0.0`)

- **One brain, one bot for everyone**: all strategy settings (confidence, filters, indicators and weights, Down bets, auto-tune) live in one shared brain (`data/global/brain.json`). Only the admin can see and change them (Settings → Shared brain, and the Learning page). The first brain is copied from the admin's settings.
- **Learns from all users**: every user's practice and real trades are pooled every 10 minutes and auto-tune updates the shared brain after enough new trades (admin can also press *Auto-tune now*). Every change (admin or auto-tune) is logged on the Learning page.
- **Simple settings for users**: coins (BTC, ETH, BNB), prediction slot (5 min, 15 min, 1 hour), run time, bet amounts, daily loss limit, max open bets, practice/real mode and Binance connection. Learning page and strategy settings are hidden for normal users.
- **Run time**: when you press Start the bot runs for 15 min, 30 min, 1 h, 3 h, 6 h, 12 h or with no limit (default), then stops itself (real betting too). A countdown shows on the Dashboard. Survives server restarts.
- **Real Prediction bets on every chosen coin** (each coin's own market), and Down bets respect the shared *Allow Down bets* setting.
- **Fixed "Up only" bias**: the AI model no longer uses its bias term, which only remembered whether the market had mostly risen while it trained and pushed every prediction the same way.
- **New light theme** with rounded cards, larger tap targets and plainer wording.

## v2.2.0 — 2026-10-19 (branch `release/v2.2.0`)

- **Phone-only app**: works only on Android phones (Chrome) and iPhones (Safari). Desktops, laptops and tablets see "This app is available only on Android and iOS smartphones. Please open this link on your mobile phone." Detection uses the User-Agent, client hints, platform, touch support and (only as a tie-breaker) screen size.
- **Install as an app (PWA)**: manifest, icons and service worker. Android shows a **Download App** button (Chrome's install prompt) or menu steps; iPhone shows Safari "Add to Home Screen" steps. In-app browsers (Facebook, Instagram, TikTok…) and other browsers are told to open the link in Chrome or Safari.
- **Sign-up/login only inside the installed app** (display-mode standalone / `navigator.standalone`).
- **Server-side protection** on all sign-up, login and reset endpoints: phone-only User-Agent/client-hint check, installed-app header, and a per-IP rate limit (30 requests per 10 minutes), on top of single-use, 10-minute, 5-attempt OTPs. `DEVICE_GATE=off` disables the device check for testing.
- **Hostinger email** settings (`smtp.hostinger.com`, port 465) in `.env.example` and `docker-compose.yml`.

## v2.1.0 — 2026-10-19 (branch `release/v2.1.0`)

**Admin user management.**

- **Admin area** (menu → Admin) for `carriepatrick80@gmail.com` only (more admins via the `ADMIN_EMAILS` setting). Lists every user with username, email, join date, status, bot/live state, trades and balance, with search.
- **Edit** a user's username or email.
- **Reset password** to the default `123456` — the user is logged out everywhere and must choose a new password at the next login before using the bot (the default can't be kept).
- **Hold all trades**: stops the user's bot and live trading at once and blocks the account ("Account on hold — contact the admin"); held bots don't restart after a server reboot. **Resume** reopens the account.
- **Delete account**: removes the user, bot, trades, settings, API keys and wallet session (type the username to confirm).
- The admin can't hold, reset or delete their own account.
- **Change password** for every user in Settings.

## v2.0.0 — 2026-10-19 (branch `release/v2.0.0`)

**Fixed-bet rule and community learning for every user.**

- **Fixed bet size for everyone**: the same bet every round, never raised after a loss or scaled with the balance (the "% of balance" option was removed). Default bet is **1.50 USD** for dummy and live prediction bets. Auto-tune changes *which* bets are taken, never their size.
- **Dashboard break-even**: shows the fixed bet, what a win/loss pays and the break-even win rate; the win rate turns green above it and red below.
- **Community learning**: every 10 minutes the server pools all users' settled trades (dummy paper, paper and live) into an anonymous dataset (`data/global/collective.json` — no names, emails or order IDs). Each user's auto-tune and AI model learn from it (switch: *Settings → Auto-tune → Learn from all users*). New accounts start with the community's learned settings. The Learning page shows users, pooled trades and win rate.
- **Automatic upgrade of existing users** (settings version 2): bets left at the old 1.00 default become 1.50 (custom amounts are kept), paper mode becomes *Dummy Binance Prediction*, community learning is switched on.
- Version number shown in the app and returned by `/api/healthz`.

## v1.0.0 — 2026-10-19

First Binance release (archived as `archive/binance-predict-bot-v1.0.0.zip`, branch `release/v1.0.0`).

- Self-learning Binance bot: 18 indicators + online AI model, combined into one prediction with confidence.
- Paper trading (dummy Binance Prediction Up/Down bets per slot, or dummy Spot), loss study, auto-tune, calibration on history.
- Live trading: Binance Prediction Market through the Agentic Wallet (connect by QR code, dry run, auto-claim) or Binance Spot with API keys (testnet supported).
- Live market panel: Binance chart, price to beat, countdown, slot predictions and accuracy.
- Accounts: sign-up with email code (default code 986796 while email isn't configured), login, password reset, one bot per user.
- Docker image published to GHCR; deployed on the Hostinger VPS behind Traefik.

## v0.1.0

Original PocketOption binary-options bot (archived as `archive/pocketoption-bot-v0.1.0.zip`).
