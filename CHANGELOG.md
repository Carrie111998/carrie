# Changelog

All versions of the bot. Older versions are kept as zip files in [`archive/`](archive/).

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
