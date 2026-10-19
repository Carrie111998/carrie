import type { NextFunction, Request, Response } from "express";

/**
 * Server-side checks for the public auth endpoints. The browser's device gate is
 * only UX; these run on every sign-up / login / reset request regardless:
 *  - the request must come from an Android or iOS phone browser (User-Agent and
 *    the Sec-CH-UA-Mobile client hint; tablets and desktops are refused),
 *  - it must carry the installed-app marker header,
 *  - and each IP is rate limited.
 * Set DEVICE_GATE=off to disable the device part (e.g. local testing).
 * Real security still comes from passwords, single-use OTPs and the rate limits.
 */

export const BLOCK_MESSAGE =
  "This app is available only on Android and iOS smartphones. Please open this link on your mobile phone.";

const gateOn = () => (process.env["DEVICE_GATE"] ?? "on").toLowerCase() !== "off";

export function isPhoneRequest(req: Request): boolean {
  const ua = String(req.headers["user-agent"] ?? "");
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return false;
  // Chromium sends ?0 on desktops/tablets and ?1 on phones.
  if (String(req.headers["sec-ch-ua-mobile"] ?? "") === "?0") return false;
  if (/iPhone|iPod/.test(ua)) return true;
  return /Android/.test(ua) && /Mobile/.test(ua);
}

const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const MAX_HITS = Number(process.env["AUTH_RATE_LIMIT"] ?? 30);

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, v] of hits) {
    const kept = v.filter((t) => t > cutoff);
    if (kept.length) hits.set(k, kept);
    else hits.delete(k);
  }
}, 60_000).unref();

export function protectAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
  list.push(now);
  hits.set(key, list);
  if (list.length > MAX_HITS) {
    res.setHeader("Retry-After", "600");
    res.status(429).json({ error: "Too many attempts. Please wait 10 minutes and try again.", code: "RATE_LIMITED" });
    return;
  }
  if (gateOn()) {
    if (!isPhoneRequest(req)) {
      res.status(403).json({ error: BLOCK_MESSAGE, code: "DEVICE_NOT_ALLOWED" });
      return;
    }
    if (req.headers["x-app-mode"] !== "standalone") {
      res.status(403).json({ error: "Open the installed app from your Home Screen to sign up or log in.", code: "APP_NOT_INSTALLED" });
      return;
    }
  }
  next();
}
