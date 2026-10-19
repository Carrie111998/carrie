---
name: Trade resolution idempotency
description: Why trade closure in the PocketOption bot must be idempotent across monitor + reaper paths
---

# Trade closure must be idempotent

Two independent code paths can resolve the same active trade: the per-trade
`monitor_trade` task and the periodic stale-trade reaper in the trading loop.
Both run in the single asyncio event loop but each `await`s (check_win,
closed_deals) — so one can finish closing a trade while the other is mid-await
on the same id.

**Rule:** any path that finalizes a trade must atomically claim it via
`self.active_trades.pop(id, None)` and bail out (`return`/`continue`) if it
returns `None`, BEFORE appending to `closed_trades` or emitting `trade_closed`.
Do the claim after the resolution awaits, right before mutating shared state.

**Why:** without the guard, a trade resolved by both paths got inserted into
closed history twice and double-counted in win/loss stats.

**How to apply:** whenever adding a new path that closes/finalizes a trade,
use the same pop-guard pattern; never `del` conditionally then mutate.
