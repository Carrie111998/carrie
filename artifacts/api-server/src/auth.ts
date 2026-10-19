// User accounts: signup with email OTP, login with username/email + password, sessions.
import { createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { promisify } from "util";
import nodemailer from "nodemailer";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./lib/logger";
import { DATA_DIR } from "./bot/paths";

const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
}

interface Session {
  userId: string;
  expires: number;
}

interface PendingOtp {
  purpose: "signup" | "reset";
  otpHash: string;
  expires: number;
  attempts: number;
  sentAt: number;
  // signup only
  username?: string;
  passwordHash?: string;
  salt?: string;
}

const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const SESSION_DAYS = 30;
const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;
const MAX_USERS = Number(process.env["MAX_USERS"] ?? 50);

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function load<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(file: string, data: unknown) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

let users: User[] = load<User[]>(USERS_FILE, []);
// Sessions are stored by SHA-256 of the token so a leaked file can't be replayed.
let sessions: Record<string, Session> = load<Record<string, Session>>(SESSIONS_FILE, {});
const pending = new Map<string, PendingOtp>(); // key: `${purpose}:${email}`
const failedLogins = new Map<string, { count: number; until: number }>();

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: (await scrypt(password, salt, 64)).toString("hex") };
}

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export class AuthError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const listUsers = () => users;
export const publicUser = (u: User) => ({ id: u.id, username: u.username, email: u.email });

function validatePassword(pw: string) {
  if (pw.length < 8) throw new AuthError("Password must be at least 8 characters");
  if (pw.length > 200) throw new AuthError("Password is too long");
}

// ─── Email ───────────────────────────────────────────────────────────────────

const smtpConfigured = Boolean(process.env["SMTP_HOST"]);
const transport = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env["SMTP_HOST"],
      port: Number(process.env["SMTP_PORT"] ?? 587),
      secure: Number(process.env["SMTP_PORT"] ?? 587) === 465,
      auth: process.env["SMTP_USER"] ? { user: process.env["SMTP_USER"], pass: process.env["SMTP_PASS"] } : undefined,
    })
  : null;

export const emailEnabled = () => smtpConfigured;

async function sendOtp(email: string, code: string, purpose: PendingOtp["purpose"]) {
  const what = purpose === "signup" ? "verify your email" : "reset your password";
  if (!transport) {
    // No SMTP configured: the code is only written to the server log (for self-hosting/testing).
    logger.warn({ email, code, purpose }, "SMTP not configured — OTP code logged instead of emailed");
    return;
  }
  await transport.sendMail({
    from: process.env["SMTP_FROM"] ?? process.env["SMTP_USER"],
    to: email,
    subject: `Your Binance Predict Bot code: ${code}`,
    text: `Use this code to ${what}: ${code}\n\nIt expires in ${OTP_MINUTES} minutes. If you didn't request it, ignore this email.`,
  });
}

async function issueOtp(email: string, entry: Omit<PendingOtp, "otpHash" | "expires" | "attempts" | "sentAt">) {
  const key = `${entry.purpose}:${email}`;
  const prev = pending.get(key);
  if (prev && Date.now() - prev.sentAt < OTP_RESEND_SECONDS * 1000) {
    throw new AuthError(`Please wait ${OTP_RESEND_SECONDS} seconds before requesting another code`, 429);
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  pending.set(key, { ...entry, otpHash: sha(`${key}:${code}`), expires: Date.now() + OTP_MINUTES * 60_000, attempts: 0, sentAt: Date.now() });
  try {
    await sendOtp(email, code, entry.purpose);
  } catch (err) {
    pending.delete(key);
    logger.error({ err }, "Failed to send OTP email");
    throw new AuthError("Could not send the email. Please try again later.", 502);
  }
}

function checkOtp(purpose: PendingOtp["purpose"], email: string, code: string): PendingOtp {
  const key = `${purpose}:${email}`;
  const p = pending.get(key);
  if (!p || p.expires < Date.now()) {
    pending.delete(key);
    throw new AuthError("Code expired. Please request a new one.");
  }
  p.attempts += 1;
  if (p.attempts > OTP_MAX_ATTEMPTS) {
    pending.delete(key);
    throw new AuthError("Too many wrong codes. Please request a new one.", 429);
  }
  if (!safeEqualHex(p.otpHash, sha(`${key}:${String(code).trim()}`))) throw new AuthError("Wrong code");
  pending.delete(key);
  return p;
}

// ─── Flows ───────────────────────────────────────────────────────────────────

const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
const findByLogin = (login: string) => {
  const l = login.trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === l || u.email === l);
};

export async function startSignup(body: Record<string, unknown>) {
  const username = String(body["username"] ?? "").trim();
  const email = normEmail(body["email"]);
  const password = String(body["password"] ?? "");
  if (!USERNAME_RE.test(username)) throw new AuthError("Username must be 3–24 letters, numbers, _ . or -");
  if (!EMAIL_RE.test(email)) throw new AuthError("Enter a valid email address");
  validatePassword(password);
  if (users.length >= MAX_USERS) throw new AuthError("Sign-ups are closed (user limit reached)", 403);
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new AuthError("Username is already taken");
  if (users.some((u) => u.email === email)) throw new AuthError("An account with this email already exists — log in instead");
  const { salt, hash } = await hashPassword(password);
  await issueOtp(email, { purpose: "signup", username, passwordHash: hash, salt });
  return { email, emailSent: smtpConfigured };
}

export async function verifySignup(body: Record<string, unknown>) {
  const email = normEmail(body["email"]);
  const p = checkOtp("signup", email, String(body["code"] ?? ""));
  if (users.some((u) => u.email === email || u.username.toLowerCase() === p.username!.toLowerCase())) {
    throw new AuthError("Account already exists — log in instead");
  }
  const user: User = { id: randomUUID(), username: p.username!, email, passwordHash: p.passwordHash!, salt: p.salt!, createdAt: Date.now() };
  users.push(user);
  save(USERS_FILE, users);
  logger.info({ username: user.username }, "New user signed up");
  return { user, token: createSession(user.id) };
}

export async function login(body: Record<string, unknown>, ip: string) {
  const loginName = String(body["login"] ?? "");
  const password = String(body["password"] ?? "");
  const key = `${ip}:${loginName.toLowerCase()}`;
  const f = failedLogins.get(key);
  if (f && f.until > Date.now()) throw new AuthError("Too many failed attempts. Try again in a few minutes.", 429);
  const user = findByLogin(loginName);
  const { hash } = await hashPassword(password, user?.salt ?? "0".repeat(32));
  if (!user || !safeEqualHex(user.passwordHash, hash)) {
    const count = (f?.count ?? 0) + 1;
    failedLogins.set(key, { count, until: count >= 5 ? Date.now() + 5 * 60_000 : 0 });
    throw new AuthError("Wrong username/email or password", 401);
  }
  failedLogins.delete(key);
  return { user, token: createSession(user.id) };
}

export async function startReset(body: Record<string, unknown>) {
  const email = normEmail(body["email"]);
  const user = users.find((u) => u.email === email);
  // Same response whether or not the account exists, so emails can't be probed.
  if (user) await issueOtp(email, { purpose: "reset" });
  return { email, emailSent: smtpConfigured };
}

export async function verifyReset(body: Record<string, unknown>) {
  const email = normEmail(body["email"]);
  const password = String(body["password"] ?? "");
  validatePassword(password);
  checkOtp("reset", email, String(body["code"] ?? ""));
  const user = users.find((u) => u.email === email);
  if (!user) throw new AuthError("Account not found");
  const { salt, hash } = await hashPassword(password);
  user.salt = salt;
  user.passwordHash = hash;
  save(USERS_FILE, users);
  // log out everywhere else
  sessions = Object.fromEntries(Object.entries(sessions).filter(([, s]) => s.userId !== user.id));
  return { user, token: createSession(user.id) };
}

// ─── Sessions ────────────────────────────────────────────────────────────────

function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  sessions = Object.fromEntries(Object.entries(sessions).filter(([, s]) => s.expires > now));
  sessions[sha(token)] = { userId, expires: now + SESSION_DAYS * 86_400_000 };
  save(SESSIONS_FILE, sessions);
  return token;
}

export function userFromToken(token: string | null | undefined): User | null {
  if (!token) return null;
  const s = sessions[sha(token)];
  if (!s || s.expires < Date.now()) return null;
  return users.find((u) => u.id === s.userId) ?? null;
}

export function logout(token: string | undefined) {
  if (!token) return;
  delete sessions[sha(token)];
  save(SESSIONS_FILE, sessions);
}

export const bearer = (req: Request) => req.header("authorization")?.replace(/^Bearer\s+/i, "") || undefined;

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = userFromToken(bearer(req));
  if (!user) {
    res.status(401).json({ error: "Please log in" });
    return;
  }
  res.locals["user"] = user;
  next();
}
