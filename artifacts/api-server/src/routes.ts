import { Router, type IRouter, type Request, type Response } from "express";
import { getEngine, type Engine } from "./bot/engine";
import { getKlines, KLINE_INTERVALS, SYMBOL_RE } from "./market";
import { bawDir, signinState, signout, startSignin, walletStatus } from "./prediction";
import {
  AuthError, bearer, emailEnabled, login, logout, publicUser, requireUser,
  startReset, startSignup, verifyReset, verifySignup, type User,
} from "./auth";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((err: unknown) => {
      const status = err instanceof AuthError ? err.status : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    });
  };

const userOf = (res: Response) => res.locals["user"] as User;
const engineOf = (res: Response): Engine => getEngine(userOf(res).id);

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// ─── Auth (public) ───────────────────────────────────────────────────────────

router.get("/auth/config", (_req, res) => {
  res.json({ emailEnabled: emailEnabled() });
});

router.post("/auth/signup", wrap(async (req, res) => {
  res.json(await startSignup(req.body ?? {}));
}));

router.post("/auth/signup/verify", wrap(async (req, res) => {
  const { user, token } = await verifySignup(req.body ?? {});
  res.json({ user: publicUser(user), token });
}));

router.post("/auth/login", wrap(async (req, res) => {
  const { user, token } = await login(req.body ?? {}, req.ip ?? "");
  res.json({ user: publicUser(user), token });
}));

router.post("/auth/reset", wrap(async (req, res) => {
  res.json(await startReset(req.body ?? {}));
}));

router.post("/auth/reset/verify", wrap(async (req, res) => {
  const { user, token } = await verifyReset(req.body ?? {});
  res.json({ user: publicUser(user), token });
}));

// ─── Everything below needs a logged-in user ────────────────────────────────

router.use(requireUser);

router.get("/auth/me", (_req, res) => {
  res.json({ user: publicUser(userOf(res)) });
});

router.post("/auth/logout", (req, res) => {
  logout(bearer(req));
  res.json({ ok: true });
});

router.get("/market/klines", wrap(async (req, res) => {
  const symbol = String(req.query["symbol"] ?? "").toUpperCase();
  const interval = String(req.query["interval"] ?? "1s");
  const limit = Math.min(1000, Math.max(1, Number(req.query["limit"]) || 300));
  if (!SYMBOL_RE.test(symbol) || !(KLINE_INTERVALS as readonly string[]).includes(interval)) {
    res.status(400).json({ error: "Invalid symbol or interval" });
    return;
  }
  res.json(await getKlines(symbol, interval, limit));
}));

router.get("/state", (_req, res) => {
  res.json(engineOf(res).publicState());
});

router.post("/bot/start", wrap(async (_req, res) => {
  engineOf(res).command({ cmd: "start" });
  res.json({ ok: true });
}));

router.post("/bot/stop", wrap(async (_req, res) => {
  engineOf(res).command({ cmd: "stop" });
  res.json({ ok: true });
}));

router.post("/bot/live", wrap(async (req, res) => {
  const enabled = req.body?.enabled === true;
  if (enabled && req.body?.confirm !== true) {
    res.status(400).json({ error: "Live trading must be confirmed" });
    return;
  }
  const r = (await engineOf(res).request({ cmd: "live", enabled })) as { ok: boolean; error?: string };
  if (!r.ok) {
    res.status(400).json({ error: r.error ?? "Could not enable live trading" });
    return;
  }
  res.json(r);
}));

router.get("/settings", (_req, res) => {
  res.json(engineOf(res).settings);
});

router.post("/settings", wrap(async (req, res) => {
  res.json(engineOf(res).updateSettings(req.body));
}));

router.post("/settings/defaults", wrap(async (_req, res) => {
  res.json(engineOf(res).resetSettings());
}));

router.get("/credentials", (_req, res) => {
  res.json(engineOf(res).credentialInfo());
});

router.post("/credentials", wrap(async (req, res) => {
  const apiKey = String(req.body?.apiKey ?? "").trim();
  const apiSecret = String(req.body?.apiSecret ?? "").trim();
  const testnet = req.body?.testnet !== false;
  if (!/^[A-Za-z0-9]{16,128}$/.test(apiKey) || !/^[A-Za-z0-9]{16,128}$/.test(apiSecret)) {
    res.status(400).json({ error: "API key and secret look invalid (letters and digits only)" });
    return;
  }
  const engine = engineOf(res);
  engine.setCredentials({ apiKey, apiSecret, testnet });
  res.json(await engine.request({ cmd: "test_credentials" }));
}));

router.delete("/credentials", wrap(async (_req, res) => {
  const engine = engineOf(res);
  engine.setCredentials(null);
  res.json(engine.credentialInfo());
}));

router.post("/credentials/test", wrap(async (_req, res) => {
  res.json(await engineOf(res).request({ cmd: "test_credentials" }));
}));

// ─── Binance Prediction Market (Agentic Wallet) ─────────────────────────────

router.get("/prediction/wallet", wrap(async (_req, res) => {
  const engine = engineOf(res);
  res.json({ status: await walletStatus(bawDir(engine.dataDir)), signin: signinState(userOf(res).id) });
}));

router.post("/prediction/signin", wrap(async (_req, res) => {
  const engine = engineOf(res);
  const refresh = () => void engine.request({ cmd: "prediction_refresh" }, 60_000).catch(() => {});
  res.json(await startSignin(userOf(res).id, bawDir(engine.dataDir), refresh));
}));

router.post("/prediction/signout", wrap(async (_req, res) => {
  const engine = engineOf(res);
  engine.command({ cmd: "live", enabled: false });
  await signout(userOf(res).id, bawDir(engine.dataDir));
  res.json({ ok: true });
}));

router.post("/prediction/refresh", wrap(async (_req, res) => {
  res.json(await engineOf(res).request({ cmd: "prediction_refresh" }, 60_000));
}));

router.get("/prediction/markets", wrap(async (req, res) => {
  const query = String(req.query["query"] ?? "").slice(0, 200);
  res.json(await engineOf(res).request({ cmd: "prediction_markets", query }, 60_000));
}));

router.get("/trades", wrap(async (req, res) => {
  const mode = req.query["mode"] === "live" ? "live" : req.query["mode"] === "paper" ? "paper" : undefined;
  const limit = Math.min(5000, Math.max(1, Number(req.query["limit"]) || 200));
  res.json(await engineOf(res).request({ cmd: "get_trades", mode, limit }));
}));

router.get("/trades.csv", wrap(async (_req, res) => {
  const trades = (await engineOf(res).request({ cmd: "get_trades", limit: 5000 })) as Record<string, unknown>[];
  const cols = ["mode", "symbol", "side", "openTime", "closeTime", "entryPrice", "exitPrice", "quote", "pnl", "pnlPct", "result", "exitReason", "confidence", "regime", "heldCandles"];
  const rows = trades.map((t) =>
    cols.map((c) => (c.endsWith("Time") ? new Date(Number(t[c])).toISOString() : String(t[c] ?? ""))).join(","),
  );
  res.setHeader("content-type", "text/csv");
  res.setHeader("content-disposition", "attachment; filename=trades.csv");
  res.send([cols.join(","), ...rows].join("\n"));
}));

router.post("/positions/:id/close", wrap(async (req, res) => {
  res.json(await engineOf(res).request({ cmd: "close_position", id: req.params["id"] }));
}));

router.post("/learning/calibrate", wrap(async (_req, res) => {
  res.json(await engineOf(res).request({ cmd: "calibrate" }));
}));

router.post("/learning/autotune", wrap(async (_req, res) => {
  res.json(await engineOf(res).request({ cmd: "autotune" }));
}));

router.post("/reset", wrap(async (req, res) => {
  const what = req.body?.what;
  if (!["paper", "learning", "all"].includes(what)) {
    res.status(400).json({ error: "what must be paper, learning or all" });
    return;
  }
  res.json(await engineOf(res).request({ cmd: "reset", what }));
}));

export default router;
