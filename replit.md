# PocketOption Trading Bot

An automated binary options trading dashboard for PocketOption, powered by BinaryOptionsTools-v2. Connects via SSID session cookie, runs multi-indicator analysis across all markets, and auto-places up to 10 simultaneous trades.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/trading-bot run dev` — run the frontend (port 20883)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + TailwindCSS + shadcn/ui at `/`
- API: Express 5 + WebSocket (`ws`) at `/api` and `/ws`
- Trading: Python 3.11 + BinaryOptionsTools-v2 (spawned as child process)
- Technical Analysis: RSI, MACD, Bollinger Bands, EMA, Volume (NumPy)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all API contracts)
- `artifacts/trading-bot/src/` — React frontend
- `artifacts/api-server/src/` — Express API server
- `artifacts/api-server/src/bot/trading_bot.py` — Python trading bot (spawned by Express)
- `artifacts/api-server/src/bot/state.ts` — in-memory bot state manager
- `artifacts/api-server/src/bot/websocket.ts` — WebSocket broadcast layer

## Architecture decisions

- **Python subprocess for trading**: BinaryOptionsTools-v2 is Python-only; Express spawns it as a persistent child process and communicates via stdin/stdout JSON lines.
- **WebSocket at /ws**: Real-time trade updates, balance changes, and bot status pushed to frontend via WebSocket. The /ws path is registered in artifact.toml alongside /api.
- **In-memory state**: All bot state (active trades, closed trades, markets, analysis) lives in Node.js memory in `state.ts` — no database needed since this is a personal real-time tool.
- **Multi-indicator scoring**: RSI + MACD + Bollinger Bands + EMA + Volume are calculated in Python using NumPy on candle history. Signals are scored and ranked; top 10 are used for trading.
- **OTC vs normal markets**: OTC markets support 3/5/10-sec expiry; normal markets are capped at 60s minimum (enforced in Python bot).

## Product

- Login via PocketOption SSID session cookie (extracted from browser)
- Dashboard: live balance, bot phase (Idle/Analysing/Trading), start/stop controls, active trades
- Trade Setup: configure time (3s/5s/10s/1min/2min), amount, max simultaneous trades (1-10), risk level (Low/Mid/High), enable/disable prediction methods
- Markets: all OTC + normal markets with live RSI/MACD/Bollinger/EMA signals
- Analysis: top 10 ranked signals with method breakdown scores
- History: closed trade log with win/loss stats

## User preferences

- This tool is for personal use only
- No placeholder/mock data — all data is real from PocketOption API
- OTC markets support 3/5/10 sec trades; normal markets minimum 1 min

## Gotchas

- SSID must be extracted from PocketOption browser session (see BinaryOptionsTools-v2 docs/tutorials)
- Python process is spawned on first bot connect; if it crashes, restart the API server workflow
- `pnpm --filter @workspace/db run push` is NOT needed — this app uses no database
- The Python bot communicates via stdin/stdout JSON lines; stderr goes to API server debug logs
- Do NOT run `pnpm run dev` at workspace root — use workflow restart instead

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- BinaryOptionsTools-v2 docs: https://github.com/ChipaDevTeam/BinaryOptionsTools-v2
- SSID extraction: https://github.com/ChipaDevTeam/BinaryOptionsTools-v2/tree/master/docs/tutorials
