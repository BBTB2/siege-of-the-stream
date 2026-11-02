import { describe, expect, it } from "vitest";
import {
  command,
  createGame,
  startRound,
  tick,
  triggerRage,
  twitchEvent,
} from "../src/game/index.js";
import { mapNotification } from "../src/twitch/mapping.js";
import { readFileSync } from "node:fs";
import { chatInput, eventInput } from "../src/validation.js";

const round = () =>
  startRound(createGame(), { boss: "iron-colossus", durationMs: 60000 });
const join = (id: string) => command(round(), id, id, "!join");

describe("overlay battle contract", () => {
  it("retains optional visual metadata through mock HTTP input validation", () => {
    expect(
      chatInput({
        userId: "1",
        username: "Alice",
        action: "!join",
        color: "#abcdef",
      }),
    ).toMatchObject({ color: "#abcdef" });
    expect(
      chatInput({
        userId: "1",
        username: "Alice",
        action: "!join",
        color: "bad",
      }),
    ).not.toHaveProperty("color");
    expect(eventInput({ type: "follow", username: "Follower" })).toEqual({
      type: "follow",
      username: "Follower",
    });
    expect(
      eventInput({ type: "cheer", bits: 500, username: "Cheerer" }),
    ).toEqual({ type: "cheer", bits: 500, username: "Cheerer" });
    expect(() => eventInput({ type: "follow", username: "\n" })).toThrow();
  });

  it("refreshes a viewer's valid colour without spawning another knight or resetting cooldown", () => {
    const attacked = command(join("alice"), "alice", "alice", "!attack");
    const recolored = command(attacked, "alice", "alice", "!join", "#FF0000");
    expect(recolored.knights).toHaveLength(1);
    expect(recolored.knights[0]).toMatchObject({
      color: "#FF0000",
      nextActionAt: 3000,
      damage: 25,
    });
    expect(attacked.knights[0]).not.toHaveProperty("color");
  });
  it("allows a knocked-out viewer to heal themselves, with the shared cooldown", () => {
    const attacked = command(join("alice"), "alice", "alice", "!attack");
    const dead = tick(triggerRage(attacked), 2000);
    expect(dead.knights[0]?.hp).toBe(0);
    expect(command(dead, "alice", "alice", "!heal")).toEqual(dead);
    const revived = command(tick(dead, 1000), "alice", "alice", "!heal");
    expect(revived.knights[0]).toMatchObject({
      hp: 30,
      heals: 30,
      nextActionAt: 6000,
    });
    expect(command(revived, "alice", "alice", "!attack").boss.hp).toBe(2975);
    expect(revived.effects.at(-1)).toMatchObject({
      type: "heal",
      amount: 30,
      sourceId: "viewer:alice",
      targetId: "viewer:alice",
      createdAt: 3000,
    });
  });

  it("prioritizes self-revival even if another knocked-out ally joined first", () => {
    const both = command(join("alice"), "bob", "bob", "!join");
    const dead = tick(triggerRage(both), 2000);
    const healed = command(dead, "bob", "bob", "!heal");
    expect(healed.knights.map((k) => k.hp)).toEqual([0, 30]);
  });

  it("carries a validated chat colour from EventSub through to the knight", () => {
    const message = JSON.parse(
      readFileSync(
        new URL("./fixtures/eventsub/chat.json", import.meta.url),
        "utf8",
      ),
    );
    message.payload.event.color = "#aB12Ef";
    const input = mapNotification(message, "100")[0];
    expect(input).toMatchObject({ kind: "command", color: "#aB12Ef" });
    if (input?.kind !== "command") throw new Error("Missing command");
    expect(
      command(round(), input.userId, input.username, input.action, input.color)
        .knights[0]?.color,
    ).toBe("#aB12Ef");
  });

  it.each(["red", "#12", "#abcdef00", "url(evil)", "", null, {}])(
    "discards invalid colour %j while keeping the command",
    (color) => {
      const message = JSON.parse(
        readFileSync(
          new URL("./fixtures/eventsub/chat.json", import.meta.url),
          "utf8",
        ),
      );
      message.payload.event.color = color;
      const input = mapNotification(message, "100")[0];
      expect(input).toMatchObject({ kind: "command", action: "!join" });
      expect(input).not.toHaveProperty("color");
      expect(
        command(round(), "1", "alice", "!join", color as string).knights[0],
      ).not.toHaveProperty("color");
    },
  );

  it("preserves actual fireball damage and raw bits separately for the visual and ticker", () => {
    const state = twitchEvent(join("alice"), {
      type: "cheer",
      bits: 5000,
      userId: "alice",
      username: "Alice",
    });
    expect(state.effects.at(-1)).toMatchObject({
      type: "fireball",
      amount: 3000,
      bits: 5000,
      username: "Alice",
      createdAt: 0,
    });
    expect(state.events).toEqual([
      {
        id: state.effects.at(-1)?.id,
        type: "cheer",
        username: "Alice",
        amount: 5000,
      },
    ]);
  });

  it("keeps the latest four Twitch events after particles expire and excludes healing", () => {
    let state = join("alice");
    state = twitchEvent(state, { type: "follow", username: "Follower" });
    state = twitchEvent(state, { type: "subscription", username: "Subber" });
    state = twitchEvent(state, { type: "gift", username: "Gifter" });
    state = twitchEvent(state, {
      type: "cheer",
      bits: 10,
      username: "Cheerer",
    });
    state = twitchEvent(state, {
      type: "raid",
      viewers: 75,
      username: "Raider",
    });
    expect(
      state.events.map(({ type, username, amount }) => ({
        type,
        username,
        amount,
      })),
    ).toEqual([
      { type: "subscription", username: "Subber", amount: 1 },
      { type: "gift", username: "Gifter", amount: 1 },
      { type: "cheer", username: "Cheerer", amount: 10 },
      { type: "raid", username: "Raider", amount: 50 },
    ]);
    const later = command(tick(state, 2000), "alice", "alice", "!heal");
    expect(later.events).toEqual(state.events);
    expect(later.effects).toEqual([]);
  });
});
