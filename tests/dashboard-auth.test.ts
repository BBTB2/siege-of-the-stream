import { once } from "node:events";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDashboardAuth,
  loadDashboardToken,
} from "../src/dashboard-auth.js";

const token = "test-dashboard-token-" + "a".repeat(44);
const directories: string[] = [];
const servers: ReturnType<ReturnType<typeof express>["listen"]>[] = [];
function tokenPath() {
  const directory = mkdtempSync(join(tmpdir(), "siege-auth-"));
  directories.push(directory);
  return join(directory, ".dashboard-token");
}
async function launch(now = () => performance.now()) {
  const auth = createDashboardAuth(token, { now });
  const app = express();
  app.use(express.json());
  app.post("/login", auth.login);
  app.post("/logout", auth.requireAuth, auth.logout);
  app.get("/private", auth.requireAuth, (_req, res) =>
    res.json({ protected: true }),
  );
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = (value: unknown = token) =>
    fetch(`${base}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: value }),
    });
  return { base, login };
}
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("dashboard token persistence", () => {
  it("creates a random private token once and reuses it", () => {
    const path = tokenPath();
    const first = loadDashboardToken(path);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(loadDashboardToken(path)).toBe(first);
    expect(readFileSync(path, "utf8").trim()).toBe(first);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadDashboardToken(tokenPath())).not.toBe(first);
  });
  it("accepts an explicit token without writing a token file", () => {
    const path = tokenPath();
    expect(loadDashboardToken(path, token)).toBe(token);
    expect(() => statSync(path)).toThrow();
  });
  it("rejects weak or malformed overrides and persisted tokens without replacing them", () => {
    for (const invalid of [
      "",
      "short",
      "a".repeat(257),
      "a".repeat(32) + "\nsecret",
    ])
      expect(() => loadDashboardToken(tokenPath(), invalid)).toThrow(
        /DASHBOARD_TOKEN/,
      );
    const path = tokenPath();
    writeFileSync(path, "corrupt", { mode: 0o600 });
    expect(() => loadDashboardToken(path)).toThrow(/DASHBOARD_TOKEN/);
    expect(readFileSync(path, "utf8")).toBe("corrupt");
  });
  it("repairs broad file permissions and refuses symlinked secrets", () => {
    const path = tokenPath();
    writeFileSync(path, token, { mode: 0o644 });
    expect(loadDashboardToken(path)).toBe(token);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const link = tokenPath();
    symlinkSync(path, link);
    expect(() => loadDashboardToken(link)).toThrow();
    expect(readFileSync(path, "utf8")).toBe(token);
  });
});

describe("dashboard authentication", () => {
  it("denies missing, incorrect, query-string and malformed credentials", async () => {
    const { base, login } = await launch();
    for (const suffix of ["", `?token=${token}`])
      expect((await fetch(`${base}/private${suffix}`)).status).toBe(401);
    for (const value of [
      null,
      {},
      "wrong",
      token + "x",
      token.slice(0, -1) + "b",
    ])
      expect((await login(value)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/private`, {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/private`, {
          headers: { Cookie: `siege_dashboard=${token}` },
        })
      ).status,
    ).toBe(401);
  });
  it("accepts a bearer token without exposing it in the response", async () => {
    const { base } = await launch();
    const response = await fetch(`${base}/private`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ protected: true });
  });
  it("uses an opaque HttpOnly strict cookie and revokes it on logout", async () => {
    const { base, login } = await launch();
    const response = await login();
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain(token);
    expect(await response.text()).not.toContain(token);
    const headers = { Cookie: cookie.split(";")[0]! };
    expect((await fetch(`${base}/private`, { headers })).status).toBe(200);
    const logout = await fetch(`${base}/logout`, { method: "POST", headers });
    expect(logout.status).toBe(200);
    expect((await fetch(`${base}/private`, { headers })).status).toBe(401);
  });
  it("keeps independent browser sessions and expires them", async () => {
    let now = 0;
    const { base, login } = await launch(() => now);
    const first = (await login()).headers.get("set-cookie")!.split(";")[0]!;
    const second = (await login()).headers.get("set-cookie")!.split(";")[0]!;
    expect(second).not.toBe(first);
    await fetch(`${base}/logout`, {
      method: "POST",
      headers: { Cookie: first },
    });
    expect(
      (await fetch(`${base}/private`, { headers: { Cookie: second } })).status,
    ).toBe(200);
    now = 12 * 60 * 60 * 1000;
    expect(
      (await fetch(`${base}/private`, { headers: { Cookie: second } })).status,
    ).toBe(401);
  });
  it("limits login attempts across users and allows retry after the window", async () => {
    let now = 0;
    const { login } = await launch(() => now);
    for (let index = 0; index < 10; index++)
      expect((await login("bad")).status).toBe(401);
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    now = 60_000;
    expect((await login()).status).toBe(200);
  });
});
