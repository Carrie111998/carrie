// Binance Agentic Wallet sign-in for the Prediction Market (via the `baw` CLI).
// Each user has their own wallet session in data/users/<id>/baw.
import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { workspaceRoot } from "./bot/paths";
import { logger } from "./lib/logger";

const LOCAL_BAW = path.join(workspaceRoot, "artifacts/api-server/node_modules/.bin/baw");
export const BAW_BIN = process.env["BAW_BIN"] ?? (existsSync(LOCAL_BAW) ? LOCAL_BAW : "baw");

export const bawDir = (userDataDir: string) => path.join(userDataDir, "baw");

interface BawResult<T> {
  success: boolean;
  data?: T;
  error?: { code?: number; name?: string; message?: string };
}

function parse<T>(stdout: string): BawResult<T> {
  const i = stdout.indexOf("{");
  if (i < 0) throw new Error(`Unexpected baw output: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(i)) as BawResult<T>;
}

export function runBaw<T = unknown>(dir: string, args: string[], timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(
      BAW_BIN,
      [...args, "--json"],
      { env: { ...process.env, BINANCE_BAW_DIR: dir }, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        try {
          const res = parse<T>(stdout ?? "");
          if (!res.success) return reject(new Error(`${res.error?.name ?? "ERROR"}: ${res.error?.message ?? "request failed"}`));
          resolve(res.data as T);
        } catch (e) {
          reject(err ?? e);
        }
      },
    );
  });
}

interface SigninState {
  state: "waiting" | "success" | "failed";
  pairingCode?: string;
  url?: string;
  expireAt?: number;
  error?: string;
}

const signins = new Map<string, SigninState>();

/** Start sign-in: returns the pairing code + link and keeps `auth verify` running until confirmed. */
export async function startSignin(userId: string, dir: string, onSuccess: () => void) {
  const data = await runBaw<{ status?: string; urlForWeb?: string; qrCodeId?: string; pairingCode?: string; expireAt?: string }>(
    dir,
    ["auth", "signin"],
  );
  if (data?.status === "ALREADY_CONNECTED") {
    signins.set(userId, { state: "success" });
    onSuccess();
    return { status: "ALREADY_CONNECTED" };
  }
  const entry: SigninState = {
    state: "waiting",
    pairingCode: data.pairingCode,
    url: data.urlForWeb,
    expireAt: Number(data.expireAt) || Date.now() + 5 * 60_000,
  };
  signins.set(userId, entry);
  // `auth verify` blocks until the user confirms in the Binance App (or ~5 min timeout); it must not be killed early
  const child = spawn(BAW_BIN, ["auth", "verify", "--qrCodeId", String(data.qrCodeId), "--json"], {
    env: { ...process.env, BINANCE_BAW_DIR: dir },
  });
  let out = "";
  child.stdout.on("data", (c: Buffer) => (out += c.toString()));
  child.on("close", () => {
    try {
      const res = parse<{ status?: string }>(out);
      if (res.success && res.data?.status === "SUCCESS") {
        entry.state = "success";
        onSuccess();
      } else {
        entry.state = "failed";
        entry.error = res.error?.message ?? "Sign-in was not confirmed";
      }
    } catch {
      entry.state = "failed";
      entry.error = "Sign-in did not complete";
    }
    logger.info({ userId, state: entry.state }, "Agentic Wallet sign-in finished");
  });
  return { status: "PENDING", pairingCode: entry.pairingCode, url: entry.url, expireAt: entry.expireAt };
}

export const signinState = (userId: string) => signins.get(userId) ?? null;

export async function walletStatus(dir: string) {
  try {
    const st = await runBaw<{ status?: string }>(dir, ["wallet", "status"], 20_000);
    return st?.status ?? "UNKNOWN";
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function signout(userId: string, dir: string) {
  signins.delete(userId);
  await runBaw(dir, ["auth", "signout"]).catch(() => {});
}
