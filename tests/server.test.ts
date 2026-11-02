import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createBattleServer } from "../src/app.js";

const dashboardToken = "test-dashboard-token-" + "a".repeat(32);
const running: ReturnType<typeof createBattleServer>[] = [];
async function launch(mockMode = true) {
  const app = createBattleServer({ mockMode, dashboardToken });
  running.push(app);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown = {}, origin = base) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        Authorization: `Bearer ${dashboardToken}`,
      },
      body: JSON.stringify(body),
    });
  return { base, post };
}
afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()));
});

describe("HTTP and WebSocket battle boundary", () => {
  it("feeds mock EventSub chat through the adapter, deduplicates events and exposes token-free status", async () => {
    const { base, post } = await launch();
    await post("/api/start", { boss: "iron-colossus", durationMs: 60_000 });
    const notification = (id: string, command: string) => ({
      metadata: {
        message_type: "notification",
        message_id: id,
        subscription_type: "channel.chat.message",
        subscription_version: "1",
      },
      payload: {
        subscription: { type: "channel.chat.message", version: "1" },
        event: {
          broadcaster_user_id: "1234",
          chatter_user_id: "99",
          chatter_user_name: "Knight",
          message: { text: command },
        },
      },
    });
    const joined = await post(
      "/api/mock/notification",
      notification("joined", "!join"),
    );
    expect(joined.status).toBe(200);
    expect((await joined.json()).state.knights).toHaveLength(1);
    const attacked = await post(
      "/api/mock/notification",
      notification("attack", "!attack"),
    );
    expect((await attacked.json()).state.boss.hp).toBe(2975);
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const replay = await post(
      "/api/mock/notification",
      notification("attack", "!attack"),
    );
    expect((await replay.json()).state.boss.hp).toBe(2975);
    const status = await (
      await fetch(`${base}/api/twitch`, {
        headers: { Authorization: `Bearer ${dashboardToken}` },
      })
    ).json();
    expect(status).toMatchObject({ mode: "mock", phase: "idle" });
    expect(JSON.stringify(status)).not.toMatch(
      /access_token|refresh_token|device_code/,
    );
  });
  it("starts a chosen boss, applies mock chat, pushes state and stops into results", async () => {
    const { base, post } = await launch();
    const socket = new WebSocket(base.replace("http", "ws") + "/ws");
    const initial = JSON.parse(String((await once(socket, "message"))[0]));
    expect(initial.state.status).toBe("idle");
    const started = await post("/api/start", {
      boss: "ember-drake",
      durationMs: 60_000,
    });
    expect(started.status).toBe(200);
    expect((await started.json()).state.boss.maxHp).toBe(4500);
    await post("/api/mock/command", {
      userId: "alice",
      username: "Alice",
      action: "!join",
    });
    await post("/api/mock/command", {
      userId: "alice",
      username: "Alice",
      action: "!attack",
    });
    const frame = JSON.parse(String((await once(socket, "message"))[0]));
    expect(frame.type).toBe("state");
    expect(frame.state.boss.hp).toBe(4475);
    const stopped = await post("/api/stop");
    expect((await stopped.json()).state).toMatchObject({
      status: "results",
      outcome: "stopped",
    });
    socket.close();
  });

  it("rejects malformed controls and foreign origins without changing game state", async () => {
    const { base, post } = await launch();
    expect(
      (await post("/api/start", { boss: "__proto__", durationMs: 1000 }))
        .status,
    ).toBe(400);
    expect(
      (await post("/api/start", { boss: "void-king", durationMs: -1 })).status,
    ).toBe(400);
    expect((await post("/api/start", null)).status).toBe(400);
    expect(
      (
        await post(
          "/api/start",
          { boss: "void-king", durationMs: 1000 },
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (await post("/api/mock/event", { type: "cheer", bits: "100" })).status,
    ).toBe(400);
    expect(
      (await post("/api/mock/event", { type: "gift", username: {} })).status,
    ).toBe(400);
    expect(
      (await post("/api/mock/command", { action: "!unknown" })).status,
    ).toBe(400);
    for (const action of [["!join"], { toString: null }]) {
      expect(
        (
          await post("/api/mock/command", {
            userId: "123",
            username: "Alice",
            action,
          })
        ).status,
      ).toBe(400);
    }
    const state = await (await fetch(`${base}/api/state`)).json();
    expect(state.state.status).toBe("idle");
  });

  it("disables mock ingestion outside mock mode", async () => {
    const { post } = await launch(false);
    expect((await post("/api/mock/event", { type: "follow" })).status).toBe(
      404,
    );
    expect(
      (
        await post("/api/mock/command", {
          userId: "alice",
          username: "Alice",
          action: "!join",
        })
      ).status,
    ).toBe(404);
  });

  it("drives time at 10Hz and exposes rage and event controls", async () => {
    const { base, post } = await launch();
    await post("/api/start", { boss: "iron-colossus", durationMs: 1000 });
    expect(
      (await post("/api/start", { boss: "void-king", durationMs: 1000 }))
        .status,
    ).toBe(409);
    const raging = await post("/api/rage");
    expect((await raging.json()).state.rage).not.toBeNull();
    const shielded = await post("/api/mock/event", { type: "follow" });
    const { state } = await shielded.json();
    expect(state.shieldUntil - state.now).toBe(10_000);
    await new Promise((resolve) => setTimeout(resolve, 1150));
    const final = await (await fetch(`${base}/api/state`)).json();
    expect(final.state).toMatchObject({
      status: "results",
      outcome: "timeout",
    });
  });
});
