import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { engine } from "./bot/engine";

const router: IRouter = Router();

const APP_PASSWORD = process.env["APP_PASSWORD"] ?? "";

export function checkPassword(given: string | undefined | null): boolean {
  if (!APP_PASSWORD) return true;
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(APP_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/auth", (req, res) => {
  res.json({ required: Boolean(APP_PASSWORD), ok: checkPassword(req.header("x-app-password")) });
});

// Everything below needs the app password when APP_PASSWORD is set.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (checkPassword(req.header("x-app-password"))) return next();
  res.status(401).json({ error: "Password required" });
});

const wrap =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((err: unknown) => {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
  };

router.get("/state", (_req, res) => {
  res.json(engine.publicState());
});

router.post("/bot/start", wrap(async (_req, res) => {
  engine.command({ cmd: "start" });
  res.json({ ok: true });
}));

router.post("/bot/stop", wrap(async (_req, res) => {
  engine.command({ cmd: "stop" });
  res.json({ ok: true });
}));

router.post("/bot/live", wrap(async (req, res) => {
  const enabled = req.body?.enabled === true;
  if (enabled && req.body?.confirm !== true) {
    res.status(400).json({ error: "Live trading must be confirmed" });
    return;
  }
  const r = (await engine.request({ cmd: "live", enabled })) as { ok: boolean; error?: string };
  if (!r.ok) {
    res.status(400).json({ error: r.error ?? "Could not enable live trading" });
    return;
  }
  res.json(r);
}));

router.get("/settings", (_req, res) => {
  res.json(engine.settings);
});

router.post("/settings", wrap(async (req, res) => {
  res.json(engine.updateSettings(req.body));
}));

router.post("/settings/defaults", wrap(async (_req, res) => {
  res.json(engine.resetSettings());
}));

router.get("/credentials", (_req, res) => {
  res.json(engine.credentialInfo());
});

router.post("/credentials", wrap(async (req, res) => {
  const apiKey = String(req.body?.apiKey ?? "").trim();
  const apiSecret = String(req.body?.apiSecret ?? "").trim();
  const testnet = req.body?.testnet !== false;
  if (!/^[A-Za-z0-9]{16,128}$/.test(apiKey) || !/^[A-Za-z0-9]{16,128}$/.test(apiSecret)) {
    res.status(400).json({ error: "API key and secret look invalid (letters and digits only)" });
    return;
  }
  engine.setCredentials({ apiKey, apiSecret, testnet });
  res.json(await engine.request({ cmd: "test_credentials" }));
}));

router.delete("/credentials", wrap(async (_req, res) => {
  engine.setCredentials(null);
  res.json(engine.credentialInfo());
}));

router.post("/credentials/test", wrap(async (_req, res) => {
  res.json(await engine.request({ cmd: "test_credentials" }));
}));

router.get("/trades", wrap(async (req, res) => {
  const mode = req.query["mode"] === "live" ? "live" : req.query["mode"] === "paper" ? "paper" : undefined;
  const limit = Math.min(5000, Math.max(1, Number(req.query["limit"]) || 200));
  res.json(await engine.request({ cmd: "get_trades", mode, limit }));
}));

router.get("/trades.csv", wrap(async (_req, res) => {
  const trades = (await engine.request({ cmd: "get_trades", limit: 5000 })) as Record<string, unknown>[];
  const cols = ["mode", "symbol", "side", "openTime", "closeTime", "entryPrice", "exitPrice", "quote", "pnl", "pnlPct", "result", "exitReason", "confidence", "regime", "heldCandles"];
  const rows = trades.map((t) =>
    cols.map((c) => (c.endsWith("Time") ? new Date(Number(t[c])).toISOString() : String(t[c] ?? ""))).join(","),
  );
  res.setHeader("content-type", "text/csv");
  res.setHeader("content-disposition", "attachment; filename=trades.csv");
  res.send([cols.join(","), ...rows].join("\n"));
}));

router.post("/positions/:id/close", wrap(async (req, res) => {
  res.json(await engine.request({ cmd: "close_position", id: req.params["id"] }));
}));

router.post("/learning/calibrate", wrap(async (_req, res) => {
  res.json(await engine.request({ cmd: "calibrate" }));
}));

router.post("/learning/autotune", wrap(async (_req, res) => {
  res.json(await engine.request({ cmd: "autotune" }));
}));

router.post("/reset", wrap(async (req, res) => {
  const what = req.body?.what;
  if (!["paper", "learning", "all"].includes(what)) {
    res.status(400).json({ error: "what must be paper, learning or all" });
    return;
  }
  res.json(await engine.request({ cmd: "reset", what }));
}));

export default router;
