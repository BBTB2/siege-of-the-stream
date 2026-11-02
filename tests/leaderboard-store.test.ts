import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Leader } from "../src/game/model.js";
import { LeaderboardStore } from "../src/leaderboard-store.js";

const directories: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), "siege-leaders-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const alice: Leader = {
  id: "viewer:1",
  username: "Alice",
  damage: 25,
  heals: 30,
  blocks: 2,
  score: 105,
};

describe("all-time leaderboard storage", () => {
  it("merges viewer totals by stable ID, updates names and excludes NPCs", () => {
    const store = new LeaderboardStore();
    store.addRound([alice, { ...alice, id: "champion:1" }]);
    store.addRound([
      { ...alice, username: "Renamed" },
      { ...alice, id: "viewer:2", username: "Bob" },
    ]);
    expect(store.get()).toEqual([
      {
        id: "viewer:1",
        username: "Renamed",
        damage: 50,
        heals: 60,
        blocks: 4,
        score: 210,
      },
      { ...alice, id: "viewer:2", username: "Bob" },
    ]);
    store.get()[0]!.damage = 999;
    expect(store.get()[0]!.damage).toBe(50);
  });

  it("creates owner-only JSON and reloads totals across process lifetimes", async () => {
    const path = join(directory(), "data", "leaderboard.json");
    const store = new LeaderboardStore(path);
    store.addRound([alice]);
    await store.flush();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      version: 1,
      leaders: [alice],
    });
    expect(new LeaderboardStore(path).get()).toEqual([alice]);
  });

  it("serializes rapid updates and resets so a stale write cannot restore cleared scores", async () => {
    const path = join(directory(), "leaderboard.json");
    const store = new LeaderboardStore(path);
    store.addRound([alice]);
    store.addRound([alice]);
    store.reset();
    await store.flush();
    expect(new LeaderboardStore(path).get()).toEqual([]);
    store.addRound([alice]);
    await store.flush();
    expect(new LeaderboardStore(path).get()).toEqual([alice]);
  });

  it.each([
    "not json",
    JSON.stringify({ version: 2, leaders: [] }),
    JSON.stringify({ version: 1, leaders: [{ ...alice, damage: -1 }] }),
    JSON.stringify({ version: 1, leaders: [{ ...alice, score: 500 }] }),
    JSON.stringify({ version: 1, leaders: [alice, alice] }),
    JSON.stringify({ version: 1, leaders: [{ ...alice, id: "champion:1" }] }),
  ])("refuses invalid persisted data without overwriting it", (contents) => {
    const path = join(directory(), "leaderboard.json");
    writeFileSync(path, contents);
    expect(() => new LeaderboardStore(path)).toThrow(/leaderboard/i);
    expect(readFileSync(path, "utf8")).toBe(contents);
  });

  it("reports disk failure safely while preserving totals in memory", async () => {
    const path = join(directory(), "blocked");
    const store = new LeaderboardStore(path);
    mkdirSync(path);
    store.addRound([alice]);
    await expect(store.flush()).rejects.toThrow(/save.*leaderboard/i);
    expect(store.getError()).toMatch(/save.*leaderboard/i);
    expect(store.get()).toEqual([alice]);
  });

  it("recovers from a failed save on the next update without losing earlier totals", async () => {
    const path = join(directory(), "blocked");
    const store = new LeaderboardStore(path);
    mkdirSync(path);
    store.addRound([alice]);
    await expect(store.flush()).rejects.toThrow(/save.*leaderboard/i);
    await rm(path, { recursive: true });
    store.addRound([alice]);
    await store.flush();
    expect(store.getError()).toBeUndefined();
    expect(new LeaderboardStore(path).get()).toEqual([
      { ...alice, damage: 50, heals: 60, blocks: 4, score: 210 },
    ]);
  });

  it("rejects malformed round entries without partially updating the leaderboard", () => {
    const store = new LeaderboardStore();
    expect(() =>
      store.addRound([alice, { ...alice, id: "viewer:2", damage: NaN }]),
    ).toThrow();
    expect(store.get()).toEqual([]);
  });

  it("saturates accumulating counters at safe integers", () => {
    const store = new LeaderboardStore();
    const maximum = {
      ...alice,
      damage: Number.MAX_SAFE_INTEGER,
      heals: 0,
      blocks: 0,
      score: Number.MAX_SAFE_INTEGER,
    };
    store.addRound([maximum]);
    store.addRound([alice]);
    expect(store.get()[0]).toMatchObject({
      damage: Number.MAX_SAFE_INTEGER,
      score: Number.MAX_SAFE_INTEGER,
    });
  });
});
