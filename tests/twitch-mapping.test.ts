import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapNotification, parseCommand } from "../src/twitch/mapping.js";
import { subscriptionRequests } from "../src/twitch/subscriptions.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/eventsub/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

describe("chat command parsing", () => {
  it.each(["!join", "!attack", "!defend", "!heal"])(
    "recognizes %s regardless of casing or outer whitespace",
    (command) => {
      expect(parseCommand(`  ${command.toUpperCase()}\n`)).toBe(command);
    },
  );
  it.each([
    "hello !join",
    "!join now",
    "!attack!",
    "!join !attack",
    "!heal\n!defend",
    "",
    "   ",
    "!dance",
    null,
    undefined,
    {},
    ["!join"],
    42,
  ])("ignores non-command input %j", (value) => {
    expect(parseCommand(value)).toBeNull();
  });
});

describe("recorded EventSub payload mapping", () => {
  it.each([
    ["follow", { type: "follow", username: "testFromUser" }],
    ["subscribe", { type: "subscription", username: "testFromUser" }],
    ["gift", { type: "gift", username: "testFromUser" }],
    [
      "cheer",
      { type: "cheer", bits: 500, userId: "200", username: "testFromUser" },
    ],
    ["raid", { type: "raid", viewers: 79875, username: "testFromUser" }],
  ])(
    "replays the actual Twitch CLI %s recording inside a WebSocket envelope",
    (name, event) => {
      const payload = fixture(`cli-${name}`);
      const message = {
        metadata: {
          message_type: "notification",
          message_id: `cli-${name}`,
          subscription_type: payload.subscription.type,
          subscription_version: payload.subscription.version,
        },
        payload,
      };
      expect(mapNotification(message, "100")).toEqual([
        { kind: "event", event },
      ]);
    },
  );
  it("maps a chat message to stable viewer identity and command", () => {
    expect(mapNotification(fixture("chat"), "100")).toEqual([
      {
        kind: "command",
        userId: "200",
        username: "Alice",
        action: "!join",
        color: "#00FF00",
      },
    ]);
  });
  it.each([
    ["follow", { type: "follow", username: "Alice" }],
    ["subscribe", { type: "subscription", username: "Alice" }],
    ["gift", { type: "gift", username: "Alice" }],
    ["anonymous-gift", { type: "gift", username: "Anonymous" }],
    ["cheer", { type: "cheer", bits: 500, userId: "200", username: "Alice" }],
    ["anonymous-cheer", { type: "cheer", bits: 100 }],
    ["raid", { type: "raid", viewers: 75, username: "Raider" }],
  ])("maps %s to a typed engine event", (name, event) => {
    expect(mapNotification(fixture(name as string), "100")).toEqual([
      { kind: "event", event },
    ]);
  });
  it("does not double-count gifted subscribe recipients alongside the aggregate gift event", () => {
    expect(mapNotification(fixture("gifted-subscribe"), "100")).toEqual([]);
    expect(mapNotification(fixture("gift"), "100")).toHaveLength(1);
  });
  it("never attributes anonymous cheer or gift payloads to an exposed identity", () => {
    const cheer = fixture("cheer");
    cheer.payload.event.is_anonymous = true;
    expect(mapNotification(cheer, "100")).toEqual([
      { kind: "event", event: { type: "cheer", bits: 500 } },
    ]);
    const gift = fixture("gift");
    gift.payload.event.is_anonymous = true;
    expect(mapNotification(gift, "100")).toEqual([
      { kind: "event", event: { type: "gift", username: "Anonymous" } },
    ]);
  });
  it.each(["chat", "follow", "subscribe", "gift", "cheer", "raid"])(
    "ignores %s for a different broadcaster",
    (name) => {
      expect(mapNotification(fixture(name), "999")).toEqual([]);
    },
  );
  it("ignores shared-chat messages originating in another channel", () => {
    const chat = fixture("chat");
    chat.payload.event.source_broadcaster_user_id = "999";
    expect(mapNotification(chat, "100")).toEqual([]);
    chat.payload.event.source_broadcaster_user_id = "100";
    expect(mapNotification(chat, "100")).toHaveLength(1);
  });
  it("ignores chatter messages that do not contain a standalone command", () => {
    const chat = fixture("chat");
    chat.payload.event.message.text = "I think we should !attack";
    expect(mapNotification(chat, "100")).toEqual([]);
  });
  it.each([
    null,
    undefined,
    {},
    [],
    "bad",
    { payload: {} },
    { metadata: { message_type: "notification" }, payload: { event: {} } },
  ])("ignores malformed envelope %j without throwing", (input) => {
    expect(mapNotification(input, "100")).toEqual([]);
  });
  it("rejects inconsistent event types, versions, and non-notification frames", () => {
    const chat = fixture("chat");
    chat.metadata.message_type = "revocation";
    expect(mapNotification(chat, "100")).toEqual([]);
    chat.metadata.message_type = "notification";
    chat.metadata.subscription_type = "channel.cheer";
    expect(mapNotification(chat, "100")).toEqual([]);
    chat.metadata.subscription_type = "channel.chat.message";
    chat.metadata.subscription_version = "2";
    expect(mapNotification(chat, "100")).toEqual([]);
  });
  it.each([0, -1, 1.5, "100", null, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid cheer amount %j",
    (bits) => {
      const cheer = fixture("cheer");
      cheer.payload.event.bits = bits;
      expect(mapNotification(cheer, "100")).toEqual([]);
    },
  );
  it.each([-1, 1.5, "50", null, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid raid size %j",
    (viewers) => {
      const raid = fixture("raid");
      raid.payload.event.viewers = viewers;
      expect(mapNotification(raid, "100")).toEqual([]);
    },
  );
  it("accepts zero-viewer raids and lets the engine apply the 50-knight cap", () => {
    const raid = fixture("raid");
    raid.payload.event.viewers = 0;
    expect(mapNotification(raid, "100")).toEqual([
      {
        kind: "event",
        event: { type: "raid", username: "Raider", viewers: 0 },
      },
    ]);
  });
  it.each([null, "", "   ", "Alice\nerror", {}, "x".repeat(100)])(
    "rejects unusable viewer identities %j",
    (value) => {
      const chat = fixture("chat");
      chat.payload.event.chatter_user_name = value;
      expect(mapNotification(chat, "100")).toEqual([]);
      chat.payload.event.chatter_user_name = "Alice";
      chat.payload.event.chatter_user_id = value;
      expect(mapNotification(chat, "100")).toEqual([]);
    },
  );
  it("requires boolean gift/anonymous flags and positive gift counts", () => {
    for (const name of ["subscribe", "gift", "cheer"]) {
      const message = fixture(name);
      delete message.payload.event[
        name === "subscribe" ? "is_gift" : "is_anonymous"
      ];
      expect(mapNotification(message, "100")).toEqual([]);
    }
    const gift = fixture("gift");
    gift.payload.event.total = -5;
    expect(mapNotification(gift, "100")).toEqual([]);
  });
});

describe("EventSub subscription requests", () => {
  it("uses authenticated user conditions, follow v2, and incoming raids", () => {
    const requests = subscriptionRequests("100", "200", "session-123");
    expect(requests).toEqual([
      {
        type: "channel.chat.message",
        version: "1",
        condition: { broadcaster_user_id: "100", user_id: "200" },
        transport: { method: "websocket", session_id: "session-123" },
      },
      {
        type: "channel.follow",
        version: "2",
        condition: { broadcaster_user_id: "100", moderator_user_id: "200" },
        transport: { method: "websocket", session_id: "session-123" },
      },
      {
        type: "channel.subscribe",
        version: "1",
        condition: { broadcaster_user_id: "100" },
        transport: { method: "websocket", session_id: "session-123" },
      },
      {
        type: "channel.subscription.gift",
        version: "1",
        condition: { broadcaster_user_id: "100" },
        transport: { method: "websocket", session_id: "session-123" },
      },
      {
        type: "channel.cheer",
        version: "1",
        condition: { broadcaster_user_id: "100" },
        transport: { method: "websocket", session_id: "session-123" },
      },
      {
        type: "channel.raid",
        version: "1",
        condition: { to_broadcaster_user_id: "100" },
        transport: { method: "websocket", session_id: "session-123" },
      },
    ]);
  });
});
