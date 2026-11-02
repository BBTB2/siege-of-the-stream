import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import {
  EventSubConnection,
  type EventSubStatus,
} from "../src/twitch/eventsub.js";

const servers: WebSocketServer[] = [];
const connections: EventSubConnection[] = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check: () => boolean, timeout = 2000) {
  const until = Date.now() + timeout;
  while (!check() && Date.now() < until) await delay(5);
  expect(check()).toBe(true);
}
async function server() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(wss);
  await once(wss, "listening");
  return {
    wss,
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ws`,
  };
}
function welcome(socket: WebSocket, id = "session-1", timeout = 10) {
  socket.send(
    JSON.stringify({
      metadata: { message_type: "session_welcome", message_id: id },
      payload: { session: { id, keepalive_timeout_seconds: timeout } },
    }),
  );
}
function notification(id = "event-1") {
  return {
    metadata: { message_type: "notification", message_id: id },
    payload: {
      subscription: { type: "channel.follow" },
      event: { user_id: "123" },
    },
  };
}
function client(
  url: string,
  overrides: Partial<ConstructorParameters<typeof EventSubConnection>[0]> = {},
) {
  const subscribed: string[] = [];
  const events: unknown[] = [];
  const revoked: unknown[] = [];
  const statuses: EventSubStatus[] = [];
  const logs: string[] = [];
  const connection = new EventSubConnection({
    url,
    mockMode: true,
    onWelcome: async (id) => {
      subscribed.push(id);
    },
    onNotification: (message) => {
      events.push(message);
    },
    onRevocation: (message) => {
      revoked.push(message);
    },
    onStatus: (status) => {
      statuses.push(status);
    },
    log: (line) => logs.push(line),
    reconnectBaseMs: 20,
    handshakeTimeoutMs: 100,
    ...overrides,
  });
  connections.push(connection);
  connection.start();
  return { connection, subscribed, events, revoked, statuses, logs };
}
afterEach(async () => {
  for (const connection of connections.splice(0)) connection.stop();
  await Promise.all(
    servers.splice(0).map((wss) => {
      for (const peer of wss.clients) peer.terminate();
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    }),
  );
});

describe("EventSub WebSocket lifecycle", () => {
  it("subscribes after welcome, delivers events once, and ignores malformed frames", async () => {
    const { wss, url } = await server();
    wss.on("connection", (peer) => welcome(peer));
    const c = client(url);
    await eventually(() => c.statuses.at(-1)?.phase === "connected");
    const peer = [...wss.clients][0]!;
    peer.send("not JSON");
    peer.send(JSON.stringify({ metadata: null }));
    peer.send(JSON.stringify(notification()));
    peer.send(JSON.stringify(notification()));
    await eventually(() => c.events.length === 1);
    expect(c.subscribed).toEqual(["session-1"]);
    expect(c.events).toEqual([notification()]);
    expect(c.logs.some((line) => line.includes("duplicate"))).toBe(true);
  });

  it("reconnects after a dropped connection and subscribes to the new session", async () => {
    const { wss, url } = await server();
    let count = 0;
    wss.on("connection", (peer) => welcome(peer, `session-${++count}`));
    const c = client(url);
    await eventually(() => c.subscribed.length === 1);
    [...wss.clients][0]!.terminate();
    await eventually(() => c.subscribed.length === 2);
    expect(c.subscribed).toEqual(["session-1", "session-2"]);
    expect(c.statuses.some((status) => status.phase === "reconnecting")).toBe(
      true,
    );
  });

  it("keeps the old connection alive until transfer welcome, without resubscribing", async () => {
    const old = await server();
    const replacement = await server();
    old.wss.on("connection", (peer) => welcome(peer, "old"));
    const c = client(old.url);
    await eventually(() => c.subscribed.length === 1);
    const first = [...old.wss.clients][0]!;
    const transferred = once(replacement.wss, "connection");
    first.send(
      JSON.stringify({
        metadata: {
          message_type: "session_reconnect",
          message_id: "reconnect-1",
        },
        payload: {
          session: { reconnect_url: replacement.url + "?ticket=abc" },
        },
      }),
    );
    const [second] = (await transferred) as [WebSocket];
    expect(first.readyState).toBe(WebSocket.OPEN);
    first.send(JSON.stringify(notification("during-transfer")));
    await eventually(() => c.events.length === 1);
    const closed = once(first, "close");
    welcome(second, "new");
    await closed;
    second.send(JSON.stringify(notification("during-transfer")));
    second.send(JSON.stringify(notification("after-transfer")));
    await eventually(() => c.events.length === 2);
    expect(c.subscribed).toEqual(["old"]);
    expect(c.statuses.at(-1)).toMatchObject({
      phase: "connected",
      sessionId: "new",
    });
  });

  it("uses keepalives to reset the watchdog and reconnects when they stop", async () => {
    const { wss, url } = await server();
    let count = 0;
    wss.on("connection", (peer) => welcome(peer, `s${++count}`, 0.1));
    const c = client(url);
    await eventually(() => c.subscribed.length === 1);
    const peer = [...wss.clients][0]!;
    for (let i = 0; i < 3; i++) {
      await delay(50);
      peer.send(
        JSON.stringify({
          metadata: {
            message_type: "session_keepalive",
            message_id: `keep-${i}`,
          },
          payload: {},
        }),
      );
    }
    expect(c.subscribed).toHaveLength(1);
    await eventually(() => c.subscribed.length > 1);
  });

  it("allows keepalives at the advertised deadline without a reconnect loop", async () => {
    const { wss, url } = await server();
    let count = 0;
    wss.on("connection", (peer) => welcome(peer, `s${++count}`, 0.1));
    const c = client(url);
    await eventually(() => c.subscribed.length === 1);
    const peer = [...wss.clients][0]!;
    for (let i = 0; i < 3; i++) {
      await delay(100);
      peer.send(
        JSON.stringify({
          metadata: {
            message_type: "session_keepalive",
            message_id: `edge-${i}`,
          },
          payload: {},
        }),
      );
    }
    expect(c.subscribed).toEqual(["s1"]);
    expect(c.statuses.at(-1)?.phase).toBe("connected");
    await eventually(() => c.subscribed.length > 1);
  });

  it("reports revoked subscriptions without passing them into the game", async () => {
    const { wss, url } = await server();
    wss.on("connection", (peer) => welcome(peer));
    const c = client(url);
    await eventually(() => c.subscribed.length === 1);
    const message = {
      metadata: { message_type: "revocation", message_id: "revoked-1" },
      payload: {
        subscription: {
          type: "channel.follow",
          status: "authorization_revoked",
        },
      },
    };
    [...wss.clients][0]!.send(JSON.stringify(message));
    await eventually(() => c.revoked.length === 1);
    expect(c.events).toEqual([]);
    expect(c.statuses.at(-1)?.message).toContain("authorization_revoked");
  });

  it("recovers from subscription failure without unhandled rejections", async () => {
    const { wss, url } = await server();
    let count = 0;
    wss.on("connection", (peer) => welcome(peer, `s${++count}`));
    let attempts = 0;
    const c = client(url, {
      onWelcome: async () => {
        if (++attempts === 1) throw new Error("subscribe failed");
      },
    });
    await eventually(() => c.statuses.at(-1)?.phase === "connected");
    expect(attempts).toBe(2);
  });

  it("reconnects if welcome never arrives, and stop prevents further retries", async () => {
    const { wss, url } = await server();
    let count = 0;
    wss.on("connection", () => count++);
    const c = client(url, { handshakeTimeoutMs: 30 });
    await eventually(() => count >= 2);
    c.connection.stop();
    const stoppedAt = count;
    await delay(100);
    expect(count).toBe(stoppedAt);
    expect(c.statuses.at(-1)?.phase).toBe("stopped");
  });

  it("refuses external reconnect URLs in mock mode", async () => {
    const { wss, url } = await server();
    wss.on("connection", (peer) => welcome(peer));
    const c = client(url);
    await eventually(() => c.subscribed.length === 1);
    [...wss.clients][0]!.send(
      JSON.stringify({
        metadata: { message_type: "session_reconnect", message_id: "bad-url" },
        payload: { session: { reconnect_url: "ws://evil.example/ws" } },
      }),
    );
    await eventually(() =>
      c.logs.some((line) => line.includes("rejected reconnect")),
    );
    expect(c.subscribed).toHaveLength(1);
  });

  it("does not publish connected after stopping a pending subscription request", async () => {
    const { wss, url } = await server();
    wss.on("connection", (peer) => welcome(peer));
    let release!: () => void;
    let started = false;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const c = client(url, {
      onWelcome: async () => {
        started = true;
        await pending;
      },
    });
    await eventually(() => started);
    c.connection.stop();
    release();
    await delay(10);
    expect(c.statuses.at(-1)?.phase).toBe("stopped");
    expect(c.statuses.some((status) => status.phase === "connected")).toBe(
      false,
    );
  });
});
