import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createBattleServer } from "../src/app.js";

const token = "test-dashboard-token-" + "a".repeat(32);
const running: ReturnType<typeof createBattleServer>[] = [];
async function launch() {
  const app = createBattleServer({ mockMode: true, dashboardToken: token });
  running.push(app);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const request = (path: string, body?: unknown, authorized = true) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const start = () =>
    request("/api/start", { boss: "void-king", durationMs: 60000 });
  const chat = (action: string, userId = "42") =>
    request("/api/mock/command", { userId, username: "Knight", action });
  return { base, request, start, chat };
}
afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()));
});

describe("broadcaster boundary", () => {
  it("protects dashboard aliases and every control while leaving the OBS overlay public", async () => {
    const { request } = await launch();
    for (const route of ["/dashboard", "/dashboard.html"]) {
      const denied = await request(route, undefined, false);
      expect(denied.status).toBe(401);
      expect(await denied.text()).not.toContain('id="round-form"');
      expect((await request(route)).status).toBe(200);
    }
    for (const route of ["/api/twitch", "/api/dashboard"])
      expect((await request(route, undefined, false)).status).toBe(401);
    for (const route of [
      "/api/start",
      "/api/stop",
      "/api/rage",
      "/api/effects",
      "/api/leaderboard/reset",
      "/api/twitch/connect",
      "/api/mock/command",
      "/api/mock/event",
      "/api/mock/notification",
    ]) {
      expect((await request(route, {}, false)).status).toBe(401);
    }
    expect((await request("/overlay", undefined, false)).status).toBe(200);
    expect((await request("/api/state", undefined, false)).status).toBe(200);
  });

  it("exchanges a token for a cookie without accepting query credentials or foreign origins", async () => {
    const { base, request } = await launch();
    expect(
      (await request(`/api/dashboard?token=${token}`, undefined, false)).status,
    ).toBe(401);
    const denied = await fetch(base + "/api/dashboard/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ token }),
    });
    expect(denied.status).toBe(403);
    const login = await request("/api/dashboard/login", { token }, false);
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain(token);
    expect(await login.text()).not.toContain(token);
    expect(
      (
        await fetch(base + "/dashboard", {
          headers: { Cookie: cookie.split(";")[0]! },
        })
      ).status,
    ).toBe(200);
    const status = await request("/api/dashboard");
    expect(await status.text()).not.toContain(token);
  });

  it.each([
    { type: "follow", username: "Follower" },
    { type: "subscription", username: "Sub" },
    { type: "gift", username: "Gifter" },
    { type: "cheer", bits: 500 },
    { type: "raid", viewers: 20, username: "Raider" },
  ])(
    "toggles $type effects at dispatch and can re-enable them",
    async (event) => {
      const { request, start } = await launch();
      await start();
      const disabled = await request("/api/effects", {
        type: event.type,
        enabled: false,
      });
      expect(disabled.status).toBe(200);
      expect((await disabled.json()).effects[event.type]).toBe(false);
      const skipped = await request("/api/mock/event", event);
      const before = (await skipped.json()).state;
      expect(before.boss.hp).toBe(6000);
      expect(before.knights).toHaveLength(0);
      expect(before.shieldUntil).toBe(0);
      expect(before.events).toHaveLength(0);
      await request("/api/effects", { type: event.type, enabled: true });
      const after = (await (await request("/api/mock/event", event)).json())
        .state;
      expect(after.events).toHaveLength(1);
    },
  );

  it("validates effect toggles and retains the other settings", async () => {
    const { request } = await launch();
    for (const body of [
      { type: "__proto__", enabled: false },
      { type: "follow", enabled: "false" },
      null,
    ]) {
      expect((await request("/api/effects", body)).status).toBe(400);
    }
    const status = await (await request("/api/dashboard")).json();
    expect(Object.values(status.effects)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("ignores unjoined viewers and rate-limits repeated joins before game dispatch", async () => {
    const { chat, start } = await launch();
    await start();
    for (const action of ["!attack", "!defend", "!heal"]) {
      const state = (await (await chat(action)).json()).state;
      expect(state.knights).toHaveLength(0);
      expect(state.boss.hp).toBe(6000);
    }
    await chat("!join", "new");
    expect((await (await chat("!attack", "new")).json()).state.boss.hp).toBe(
      5975,
    );
    for (let i = 0; i < 3; i++) await chat("!join", "new");
    const denied = await chat("!join", "new");
    expect((await denied.json()).effect).toBe("ignored:user_rate_limit");
    expect(
      (await (await chat("!join", "other")).json()).state.knights,
    ).toHaveLength(2);
  });

  it("records each completed round once and resets all-time totals without changing the round card", async () => {
    const { request, start, chat } = await launch();
    await start();
    await chat("!join");
    await chat("!attack");
    await request("/api/stop", {});
    await request("/api/stop", {});
    const totals = await (await request("/api/dashboard")).json();
    expect(totals.leaderboard).toEqual([
      expect.objectContaining({ id: "viewer:42", damage: 25, score: 25 }),
    ]);
    expect(
      (await (await request("/api/leaderboard/reset", {})).json()).leaderboard,
    ).toEqual([]);
    expect(
      (await (await request("/api/state")).json()).state.leaderboard,
    ).toHaveLength(1);
    expect(
      (await (await request("/api/dashboard")).json()).leaderboard,
    ).toEqual([]);
  });
});
