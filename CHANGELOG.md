# Changelog

All versions of the bot. Older versions are kept as zip files in [`archive/`](archive/).

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
