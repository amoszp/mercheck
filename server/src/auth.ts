import type { NextFunction, Request, Response } from "express";

// Client for the shared accounts service, reached over a private Docker network.
const ACCOUNTS_URL = process.env.ACCOUNTS_URL ?? "http://accounts:4600";
const SERVICE_TOKEN = process.env.ACCOUNTS_SERVICE_TOKEN ?? "";
const APP_NAME = "mercheck";

export const SESSION_COOKIE = "mercheck_session";
const SESSION_MAX_AGE_SECONDS = 180 * 86_400;
const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? "true") !== "false";

export interface User {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export class AccountsUnavailable extends Error {}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  let res: globalThis.Response;
  try {
    res = await fetch(`${ACCOUNTS_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-service-token": SERVICE_TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new AccountsUnavailable(String(err));
  }
  if (res.status >= 500) throw new AccountsUnavailable(`accounts service answered ${res.status}`);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

export interface Client {
  ip?: string;
  device?: string;
}

export async function login(username: string, password: string, client: Client) {
  return call("POST", "/v1/login", { username, password, app: APP_NAME, ...client });
}

export async function signup(username: string, password: string, displayName: string, client: Client) {
  return call("POST", "/v1/signup", { username, password, displayName, app: APP_NAME, ...client });
}

// Behind Cloudflare the visitor's address arrives in CF-Connecting-IP; on the
// LAN there is no proxy, so the socket address is the client.
export function clientInfo(req: Request): Client {
  const forwarded = req.get("cf-connecting-ip")?.trim();
  const ip = (forwarded || req.socket.remoteAddress || "").slice(0, 64) || undefined;
  // The browser's own description of itself (device, system, browser).
  const device = (req.get("user-agent") ?? "").slice(0, 300) || undefined;
  return { ip, device };
}

export async function logout(token: string): Promise<void> {
  await call("POST", "/v1/logout", { token });
}

// Verified tokens are cached briefly so a burst of API calls costs one lookup.
const verifyCache = new Map<string, { user: User; until: number }>();
const VERIFY_CACHE_MS = 30_000;

export async function verify(token: string): Promise<User | null> {
  const cached = verifyCache.get(token);
  if (cached && cached.until > Date.now()) return cached.user;
  const { status, data } = await call("POST", "/v1/verify", { token });
  if (status !== 200) {
    verifyCache.delete(token);
    return null;
  }
  verifyCache.set(token, { user: data.user, until: Date.now() + VERIFY_CACHE_MS });
  return data.user;
}

export function forgetToken(token: string): void {
  verifyCache.delete(token);
}

// ---------- cookies ----------

export function readToken(req: Request): string | null {
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  for (const part of (req.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("=")) || null;
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${COOKIE_SECURE ? "; Secure" : ""}`);
}

// ---------- middleware ----------

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function requireUser() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readToken(req);
    if (!token) {
      res.status(401).json({ error: "login required" });
      return;
    }
    try {
      const user = await verify(token);
      if (!user) {
        res.status(401).json({ error: "login required" });
        return;
      }
      req.user = user;
      next();
    } catch (err) {
      if (err instanceof AccountsUnavailable) {
        console.error("[auth] accounts service unavailable:", err.message);
        res.status(503).json({ error: "accounts service unavailable" });
        return;
      }
      next(err);
    }
  };
}
