import { describe, it, expect } from "vitest";
import {
  createGame,
  startRound,
  command,
  tick,
  twitchEvent,
  triggerRage,
  stopRound,
  type GameState,
  type TwitchEvent,
  type BossId,
  type ChatCommand,
} from "../src/game/index.js";

const round = (durationMs = 120_000) =>
  startRound(createGame(), { boss: "iron-colossus", durationMs });
const join = (s: GameState, id = "alice") => command(s, id, id, "!join");
const act = (s: GameState, action: ChatCommand, id = "alice") =>
  command(s, id, id, action);
const injured = () => ({
  ...join(join(round()), "bob"),
  knights: [
    { ...join(round()).knights[0]!, hp: 90 },
    { ...join(round(), "bob").knights[0]!, hp: 20 },
  ],
});

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe("joining and commands", () => {
  it("spawns a named viewer once per user ID and permits an immediate attack", () => {
    const s = round();
    const joined = command(s, "123", "Alice", "!join");
    expect(joined.knights).toHaveLength(1);
    expect(joined.knights[0]).toMatchObject({
      id: "viewer:123",
      username: "Alice",
      hp: 100,
    });
    expect(command(joined, "123", "Renamed", "!join")).toEqual(joined);
    expect(command(joined, "123", "Alice", "!attack").boss.hp).toBe(2975);
    expect(s.knights).toHaveLength(0);
  });
  it("keeps different IDs with identical display names separate", () => {
    const s = command(
      command(round(), "1", "Alice", "!join"),
      "2",
      "Alice",
      "!join",
    );
    expect(s.knights).toHaveLength(2);
  });
  it.each([
    ["", "Alice"],
    ["   ", "Alice"],
    ["1", "   "],
  ])("ignores invalid identity %j / %j", (id, name) => {
    const s = round();
    expect(command(s, id, name, "!join")).toEqual(s);
  });
  it("ignores commands before joining, while idle, or after the round", () => {
    expect(act(round(), "!attack").boss.hp).toBe(3000);
    expect(join(createGame()).knights).toHaveLength(0);
    const results = stopRound(join(round()));
    expect(act(results, "!attack")).toEqual(results);
    expect(join(results, "bob")).toEqual(results);
  });
  it("shares the 3-second cooldown across attack, defend, and heal", () => {
    const s = act(join(round()), "!attack");
    expect(s.boss.hp).toBe(2975);
    expect(act(s, "!defend")).toEqual(s);
    expect(act(s, "!heal")).toEqual(s);
    expect(act(tick(s, 2900), "!attack").boss.hp).toBe(2975);
    const ready = act(tick(s, 3000), "!defend");
    expect(ready.knights[0]?.defendedUntil).toBe(8000);
    expect(ready.knights[0]?.nextActionAt).toBe(6000);
  });
  it("cooldowns are independent for each viewer", () => {
    const s = act(act(join(join(round()), "bob"), "!attack"), "!attack", "bob");
    expect(s.boss.hp).toBe(2950);
  });
  it("duplicate join cannot reset a cooldown or revive a defeated knight", () => {
    const attacked = act(join(round()), "!attack");
    expect(act(join(attacked), "!attack").boss.hp).toBe(2975);
    const dead = tick(triggerRage(join(round())), 4000);
    expect(join(dead).knights[0]?.hp).toBe(0);
    expect(act(dead, "!attack")).toEqual(dead);
    expect(act(dead, "!heal")).toEqual(dead);
  });
  it("heals the most injured living ally and credits actual HP restored", () => {
    const healed = act(injured(), "!heal");
    expect(healed.knights.map((k) => k.hp)).toEqual([90, 50]);
    expect(healed.knights[0]?.heals).toBe(30);
    const capped = act(tick(act(join(round()), "!defend"), 5000), "!heal");
    expect(capped.knights[0]?.hp).toBe(100);
    expect(capped.knights[0]?.heals).toBe(10);
  });
  it("healing never resurrects a knocked-out ally or overheals", () => {
    const dead = tick(triggerRage(join(round())), 4000);
    const s = act(join(dead, "bob"), "!heal", "bob");
    expect(s.knights.map((k) => k.hp)).toEqual([0, 100]);
    expect(s.knights[1]?.heals).toBe(0);
  });
  it("unknown commands do not consume cooldown", () => {
    const s = join(round());
    expect(act(s, "!dance" as ChatCommand)).toEqual(s);
  });
});

describe("Twitch event effects", () => {
  it("follow shields attacks for exactly 10 seconds and credits blocks", () => {
    const s = twitchEvent(join(round()), { type: "follow" });
    expect(s.shieldUntil).toBe(10000);
    const protectedState = tick(s, 5000);
    expect(protectedState.knights[0]).toMatchObject({ hp: 100, blocks: 1 });
    expect(tick(s, 10000).knights[0]).toMatchObject({ hp: 90, blocks: 1 });
  });
  it("a subsequent follow refreshes the wall from the current time", () => {
    const s = twitchEvent(
      tick(twitchEvent(round(), { type: "follow" }), 9000),
      { type: "follow" },
    );
    expect(s.shieldUntil).toBe(19000);
  });
  it.each(["subscription", "gift"] as const)(
    "%s summons a durable champion that attacks automatically",
    (type) => {
      const s = twitchEvent(round(), { type, username: "Supporter" });
      expect(s.knights[0]).toMatchObject({
        kind: "champion",
        hp: 200,
        maxHp: 200,
      });
      const attacked = tick(s);
      expect(attacked.boss.hp).toBe(2960);
      expect(attacked.knights[0]?.damage).toBe(40);
      expect(tick(attacked, 2900).boss.hp).toBe(2960);
      expect(tick(attacked, 3000).boss.hp).toBe(2920);
    },
  );
  it("cheers deal one damage per bit with a fireball effect and viewer credit", () => {
    const s = twitchEvent(join(round()), {
      type: "cheer",
      bits: 200,
      userId: "alice",
    });
    expect(s.boss.hp).toBe(2800);
    expect(s.knights[0]?.damage).toBe(200);
    expect(s.effects.at(-1)).toMatchObject({ type: "fireball", amount: 200 });
  });
  it("anonymous cheers work and lethal fireballs are capped to remaining boss HP", () => {
    expect(twitchEvent(round(), { type: "cheer", bits: 100 }).boss.hp).toBe(
      2900,
    );
    const s = twitchEvent(join(round()), {
      type: "cheer",
      bits: 9999,
      userId: "alice",
    });
    expect(s.boss.hp).toBe(0);
    expect(s.leaderboard[0]?.damage).toBe(3000);
    expect(s.outcome).toBe("victory");
  });
  it.each([0, -1, 1.5, Infinity, NaN])(
    "rejects invalid cheer bits %s",
    (bits) => {
      const s = round();
      expect(twitchEvent(s, { type: "cheer", bits })).toEqual(s);
    },
  );
  it.each([
    [3, 3],
    [50, 50],
    [200, 50],
    [0, 0],
  ])("raid of %i spawns %i reinforcements", (viewers, expected) => {
    const s = twitchEvent(round(), {
      type: "raid",
      viewers,
      username: "Raider",
    });
    expect(s.knights).toHaveLength(expected);
    expect(new Set(s.knights.map((k) => k.id)).size).toBe(expected);
    expect(tick(s).boss.hp).toBe(3000 - expected * 10);
  });
  it.each([-1, 1.2, Infinity])("rejects invalid raid viewers %s", (viewers) => {
    const s = round();
    expect(
      twitchEvent(s, { type: "raid", viewers, username: "Raider" }),
    ).toEqual(s);
  });
  it.each(["subscription", "gift", "raid"] as const)(
    "rejects a blank %s username",
    (type) => {
      const s = round();
      expect(
        twitchEvent(s, { type, username: " ", viewers: 10 } as TwitchEvent),
      ).toEqual(s);
    },
  );
  it("ignores events outside a playing round and maintains unique NPC IDs across events", () => {
    const idle = createGame();
    expect(twitchEvent(idle, { type: "follow" })).toEqual(idle);
    const s = twitchEvent(
      twitchEvent(round(), { type: "gift", username: "A" }),
      { type: "raid", viewers: 2, username: "B" },
    );
    expect(new Set(s.knights.map((k) => k.id)).size).toBe(3);
    const results = stopRound(s);
    expect(twitchEvent(results, { type: "cheer", bits: 100 })).toEqual(results);
  });
});

describe("boss phases and rage", () => {
  it("changes phases at two-thirds and one-third HP and telegraphs phase-three rage", () => {
    const phase1 = twitchEvent(round(), { type: "cheer", bits: 999 });
    expect(phase1.boss.phase).toBe(1);
    const phase2 = twitchEvent(phase1, { type: "cheer", bits: 1 });
    expect(phase2.boss.phase).toBe(2);
    expect(phase2.rage).toBeNull();
    const phase3 = twitchEvent(phase2, { type: "cheer", bits: 1000 });
    expect(phase3.boss.phase).toBe(3);
    expect(phase3.rage?.hitsAt).toBe(4000);
  });
  it("manual rage gives 4 seconds warning and knocks out only unprotected knights in the area", () => {
    const s = triggerRage(act(join(join(round()), "bob"), "!defend"));
    expect(tick(s, 3900).knights.every((k) => k.hp === 100)).toBe(true);
    expect(
      tick(s, 4000).knights.map((k) => ({ hp: k.hp, blocks: k.blocks })),
    ).toEqual([
      { hp: 100, blocks: 1 },
      { hp: 0, blocks: 0 },
    ]);
    const outside = {
      ...s,
      knights: s.knights.map((k) => ({ ...k, x: 1800 })),
    };
    expect(tick(outside, 4000).knights.every((k) => k.hp === 100)).toBe(true);
  });
  it("shield wall protects the whole army from rage", () => {
    const s = triggerRage(twitchEvent(join(round()), { type: "follow" }));
    expect(tick(s, 4000).knights[0]).toMatchObject({ hp: 100, blocks: 1 });
  });
  it("defense expires at its exact deadline", () => {
    const defended = act(join(round()), "!defend");
    const s = triggerRage(tick(defended, 1000));
    expect(tick(s, 4000).knights[0]?.hp).toBe(0);
  });
  it("cannot reset an active telegraph and repeats rage in phase three", () => {
    const s = twitchEvent(round(), { type: "cheer", bits: 2000 });
    expect(triggerRage(tick(s, 1000)).rage?.hitsAt).toBe(4000);
    expect(tick(s, 11900).rage).toBeNull();
    expect(tick(s, 12000).rage?.hitsAt).toBe(16000);
    expect(triggerRage(createGame()).rage).toBeNull();
  });
  it("normal boss strikes scale with phase without reducing HP below zero", () => {
    const s = twitchEvent(join(round()), { type: "cheer", bits: 1000 });
    expect(tick(s, 5000).knights[0]?.hp).toBe(80);
    expect(tick(s, 30000).knights[0]?.hp).toBe(0);
  });
});

describe("round lifecycle and leaderboard", () => {
  it.each(["iron-colossus", "ember-drake", "void-king"] as const)(
    "starts %s with the selected health and duration",
    (boss) => {
      const s = startRound(tick(createGame(), 1000), {
        boss,
        durationMs: 60000,
      });
      expect(s.boss.id).toBe(boss);
      expect(s.boss.hp).toBe(
        { "iron-colossus": 3000, "ember-drake": 4500, "void-king": 6000 }[boss],
      );
      expect(s.endsAt).toBe(61000);
      expect(s.status).toBe("playing");
    },
  );
  it.each([0, 999, 3600001, NaN, 1000.1])(
    "rejects invalid duration %s",
    (durationMs) => {
      expect(() =>
        startRound(createGame(), { boss: "iron-colossus", durationMs }),
      ).toThrow();
    },
  );
  it("rejects unknown bosses", () => {
    expect(() =>
      startRound(createGame(), {
        boss: "missing" as BossId,
        durationMs: 10000,
      }),
    ).toThrow();
  });
  it("times out exactly on the deadline, then displays results for 15 seconds", () => {
    const s = join(round(1000));
    expect(tick(s, 900).status).toBe("playing");
    const ended = tick(s, 1000);
    expect(ended).toMatchObject({
      status: "results",
      outcome: "timeout",
      resultsUntil: 16000,
    });
    expect(tick(ended, 14900).status).toBe("results");
    const idle = tick(ended, 15000);
    expect(idle.status).toBe("idle");
    expect(idle.leaderboard).toEqual([]);
    const restarted = startRound(idle, { boss: "void-king", durationMs: 2000 });
    expect(restarted.knights).toEqual([]);
    expect(restarted.endsAt).toBe(18000);
  });
  it("cannot overwrite active rounds or the result display", () => {
    const playing = join(round());
    expect(
      startRound(playing, { boss: "void-king", durationMs: 5000 }),
    ).toEqual(playing);
    const results = stopRound(playing);
    expect(
      startRound(results, { boss: "void-king", durationMs: 5000 }),
    ).toEqual(results);
    expect(stopRound(results)).toEqual(results);
    expect(stopRound(createGame()).status).toBe("idle");
  });
  it("caps lethal attacks and includes the final damage in the frozen MVP leaderboard", () => {
    const low = twitchEvent(join(round()), { type: "cheer", bits: 2990 });
    const ended = act(low, "!attack");
    expect(ended.boss.hp).toBe(0);
    expect(ended.outcome).toBe("victory");
    expect(ended.leaderboard[0]).toMatchObject({
      username: "alice",
      damage: 10,
      score: 10,
    });
    expect(tick(ended, 5000).leaderboard).toEqual(ended.leaderboard);
  });
  it("ranks damage, actual healing, and blocks together with deterministic tie breaks", () => {
    const s = join(join(join(round(), "carol"), "bob"), "alice");
    const scored = {
      ...s,
      knights: s.knights.map((k) => ({
        ...k,
        damage: k.username === "alice" ? 50 : 0,
        heals: k.username === "bob" ? 50 : 0,
        blocks: k.username === "carol" ? 2 : 0,
      })),
    };
    const result = stopRound(scored);
    expect(result.leaderboard.map((k) => [k.username, k.score])).toEqual([
      ["alice", 50],
      ["bob", 50],
      ["carol", 50],
    ]);
    expect(result.leaderboard[2]).toMatchObject({
      damage: 0,
      heals: 0,
      blocks: 2,
    });
  });
  it("a deadline wins a tie with scheduled NPC damage", () => {
    const s = twitchEvent(round(1000), { type: "gift", username: "A" });
    const pending = {
      ...s,
      boss: { ...s.boss, hp: 1 },
      knights: s.knights.map((k) => ({ ...k, nextActionAt: 1000 })),
    };
    const ended = tick(pending, 1000);
    expect(ended.outcome).toBe("timeout");
    expect(ended.boss.hp).toBe(1);
  });
  it("NPC killing damage is included once and later NPCs cannot attack after victory", () => {
    const s = twitchEvent(round(), { type: "raid", username: "R", viewers: 3 });
    const ended = tick({ ...s, boss: { ...s.boss, hp: 5 } });
    expect(ended.outcome).toBe("victory");
    expect(ended.leaderboard.map((k) => k.damage)).toEqual([5, 0, 0]);
  });
});

describe("pure deterministic simulation", () => {
  it("all transitions accept deeply frozen input without changing it", () => {
    const s = freeze(join(round()));
    const snapshot = JSON.stringify(s);
    act(s, "!attack");
    act(s, "!defend");
    act(s, "!heal");
    join(s, "bob");
    twitchEvent(s, { type: "follow" });
    twitchEvent(s, { type: "gift", username: "A" });
    triggerRage(s);
    stopRound(s);
    tick(s, 5000);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
  it("batched ticks equal individual fixed ticks", () => {
    const s = triggerRage(twitchEvent(join(round()), { type: "follow" }));
    const individual = Array.from({ length: 60 }).reduce<GameState>(
      (state) => tick(state),
      s,
    );
    expect(tick(s, 6000)).toEqual(individual);
    expect(tick(s, 0)).toEqual(s);
  });
  it.each([-100, 1, 150, Infinity, NaN])(
    "rejects invalid elapsed time %s",
    (elapsed) => {
      expect(() => tick(round(), elapsed)).toThrow();
    },
  );
  it("expires transient effects and bounds their history", () => {
    const s = Array.from({ length: 30 }).reduce<GameState>(
      (state) => twitchEvent(state, { type: "follow" }),
      round(),
    );
    expect(s.effects).toHaveLength(20);
    expect(tick(s, 1500).effects).toEqual([]);
  });
});
