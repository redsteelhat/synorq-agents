import { createHmac, timingSafeEqual } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";

export const SESSION_COOKIE = "synorq_agents_session";
const SESSION_DAYS = 30;

export type Admin = { username: string; password: string };

/** Derived from the password, so changing ADMIN_PASSWORD signs everyone out. */
export function sessionSecret(admin: Admin): string {
  return createHmac("sha256", admin.password).update(`synorq-agents-session:${admin.username}`).digest("base64url");
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function checkCredentials(admin: Admin, username: string, password: string): boolean {
  // Evaluate both so the response time does not reveal which one was wrong.
  const userOk = same(username, admin.username);
  const passwordOk = same(password, admin.password);
  return userOk && passwordOk;
}

export async function startSession(c: Context, admin: Admin, secure: boolean): Promise<void> {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await setSignedCookie(c, SESSION_COOKIE, String(expires), sessionSecret(admin), {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function endSession(c: Context, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure });
}

export async function hasSession(c: Context, admin: Admin): Promise<boolean> {
  const value = await getSignedCookie(c, sessionSecret(admin), SESSION_COOKIE);
  return typeof value === "string" && Number(value) > Date.now();
}

/** Redirects to /login unless a valid session cookie is present. */
export function requireSession(admin: Admin, publicPaths: string[]): MiddlewareHandler {
  return async (c, next) => {
    if (publicPaths.includes(c.req.path) || (await hasSession(c, admin))) return next();
    if (c.req.method !== "GET") return c.text("Unauthorized", 401);
    const target = c.req.path === "/" ? "" : `?next=${encodeURIComponent(c.req.path)}`;
    return c.redirect(`/login${target}`, 303);
  };
}

/** Five failed attempts per client in 15 minutes, then wait. */
export function createLoginLimiter(maxFailures = 5, windowMs = 15 * 60 * 1000) {
  const failures = new Map<string, { count: number; until: number }>();
  return {
    blocked(key: string): boolean {
      const entry = failures.get(key);
      if (!entry) return false;
      if (entry.until < Date.now()) {
        failures.delete(key);
        return false;
      }
      return entry.count >= maxFailures;
    },
    fail(key: string): void {
      const entry = failures.get(key);
      if (!entry || entry.until < Date.now()) failures.set(key, { count: 1, until: Date.now() + windowMs });
      else entry.count += 1;
    },
    reset(key: string): void {
      failures.delete(key);
    },
  };
}

/** Only same-site relative paths, so ?next= cannot send the user elsewhere. */
export function safeNext(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}
