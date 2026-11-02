import type { Request, RequestHandler } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { performance } from "node:perf_hooks";

function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}
function checkedToken(value: unknown): string {
  if (!validToken(value))
    throw new Error(
      "DASHBOARD_TOKEN must contain 32–256 letters, digits, hyphens or underscores.",
    );
  return value;
}
function readToken(path: string): string {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 257)
      throw new Error("Invalid DASHBOARD_TOKEN file.");
    const token = checkedToken(
      readFileSync(descriptor, "utf8").replace(/\n$/, ""),
    );
    fchmodSync(descriptor, 0o600);
    return token;
  } finally {
    closeSync(descriptor);
  }
}
/** Only server startup calls this; the auth middleware never reads local secrets. */
export function loadDashboardToken(
  path = ".dashboard-token",
  override?: string,
): string {
  if (override !== undefined) return checkedToken(override);
  try {
    return readToken(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = randomBytes(32).toString("hex");
  try {
    writeFileSync(path, `${token}\n`, { flag: "wx", mode: 0o600 });
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return readToken(path);
  }
}

const cookieName = "siege_dashboard";
const sessionMs = 12 * 60 * 60 * 1000;
function sessionCookie(req: Pick<Request, "headers">): string | undefined {
  const cookies = (req.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim());
  const matches = cookies.filter((part) => part.startsWith(`${cookieName}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function createDashboardAuth(
  token: string,
  { now = () => performance.now() }: { now?: () => number } = {},
) {
  const expected = Buffer.from(checkedToken(token));
  const sessions = new Map<string, number>();
  let budget = { until: 0, count: 0 };
  function matchesToken(value: unknown): boolean {
    if (!validToken(value)) return false;
    const candidate = Buffer.from(value);
    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  }
  function authenticated(req: Pick<Request, "headers">): boolean {
    const authorization = req.headers.authorization;
    if (authorization !== undefined)
      return matchesToken(/^Bearer (\S+)$/i.exec(authorization)?.[1]);
    const session = sessionCookie(req);
    if (!session) return false;
    const expires = sessions.get(session);
    if (expires === undefined) return false;
    if (expires > now()) return true;
    sessions.delete(session);
    return false;
  }
  const login: RequestHandler = (req, res) => {
    const time = now();
    budget =
      time >= budget.until
        ? { until: time + 60_000, count: 1 }
        : { ...budget, count: budget.count + 1 };
    res.setHeader("Cache-Control", "no-store");
    if (budget.count > 10) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((budget.until - time) / 1000))),
      );
      res
        .status(429)
        .json({ error: "Too many sign-in attempts; retry in a minute." });
      return;
    }
    if (!matchesToken(req.body?.token)) {
      res.status(401).json({ error: "Invalid dashboard token." });
      return;
    }
    for (const [session, expires] of sessions)
      if (expires <= time) sessions.delete(session);
    if (sessions.size >= 128) sessions.delete(sessions.keys().next().value!);
    const session = randomBytes(32).toString("hex");
    sessions.set(session, time + sessionMs);
    res.cookie(cookieName, session, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: sessionMs,
    });
    res.json({ ok: true });
  };
  const logout: RequestHandler = (req, res) => {
    const session = sessionCookie(req);
    if (session) sessions.delete(session);
    res.clearCookie(cookieName, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true });
  };
  const requireAuth: RequestHandler = (req, res, next) => {
    if (authenticated(req)) next();
    else {
      res.setHeader("Cache-Control", "no-store");
      res.status(401).json({ error: "Dashboard token required." });
    }
  };
  return { authenticated, login, logout, requireAuth };
}
