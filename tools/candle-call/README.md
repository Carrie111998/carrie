# Candle Call — local live page

Live 5-minute and 15-minute Up/Down calls for BTC, ETH and BNB. Each timeframe shows two calls:
**This round** (live, follows the price as the round runs) and **Next round** (provisional until this round closes),
next to the live Binance Prediction odds.

Runs on your own computer — free, no claude.ai or Firecrawl needed.

## Start

1. Install Python 3.8 or newer (nothing else to install).
2. Download this folder (`candle_call.py` and `index.html`, kept together).
3. Optional, for the Binance Prediction odds — your Binance API key with **Prediction Trading** (no withdrawals; if the
   key has an IP whitelist, add your home IP):
   - macOS / Linux: `export BINANCE_API_KEY=... BINANCE_API_SECRET=...`
   - Windows PowerShell: `$env:BINANCE_API_KEY="..."; $env:BINANCE_API_SECRET="..."`
4. Run `python3 candle_call.py` (Windows: `py candle_call.py`).
5. Open the address it prints:
   - this computer: <http://localhost:8765>
   - your phone on the same Wi-Fi: `http://<computer's IP>:8765` (allow Python through the firewall if asked)

It refreshes every 30 seconds. Stop it with Ctrl+C. Use another port with `PORT=9000 python3 candle_call.py`.
Without an API key, both calls still work; only the odds panel stays empty. Not financial advice.
