import { describe, expect, it } from "vitest";
import { createDemo, tickDemo } from "../src/demo.js";

describe("isolated 60-second overlay demo", () => {
  it("starts immediately, grows beyond 200 knights and shows every Twitch event", () => {
    let demo = createDemo();
    expect(demo.status).toBe("playing");
    expect(demo.knights.length).toBeGreaterThan(0);
    const types = new Set<string>();
    const phases = new Set<number>();
    let peakArmy = 0;
    let sawKnockout = false;
    let sawRevive = false;
    const knockedOut = new Set<string>();
    for (let step = 0; step < 450; step++) {
      demo = tickDemo(demo, 100);
      for (const event of demo.events) types.add(event.type);
      phases.add(demo.boss.phase);
      peakArmy = Math.max(peakArmy, demo.knights.length);
      for (const knight of demo.knights) {
        if (knight.hp === 0) {
          sawKnockout = true;
          knockedOut.add(knight.id);
        } else if (knockedOut.has(knight.id)) sawRevive = true;
      }
    }
    expect([...types].sort()).toEqual([
      "cheer",
      "follow",
      "gift",
      "raid",
      "subscription",
    ]);
    expect([...phases].sort()).toEqual([1, 2, 3]);
    expect(peakArmy).toBeGreaterThanOrEqual(200);
    expect(sawKnockout).toBe(true);
    expect(sawRevive).toBe(true);
    expect(demo).toMatchObject({
      status: "results",
      outcome: "victory",
      now: 45000,
    });
    expect(demo.resultsUntil).toBe(60000);
    expect(demo.leaderboard.length).toBeGreaterThan(0);
  });

  it("holds the leaderboard for 15 seconds, then loops without retaining the old army", () => {
    const result = tickDemo(createDemo(), 45000);
    expect(result.status).toBe("results");
    const beforeLoop = tickDemo(result, 14900);
    expect(beforeLoop.status).toBe("results");
    expect(beforeLoop.demo.elapsedMs).toBe(59900);
    const next = tickDemo(beforeLoop, 100);
    expect(next.demo).toEqual({ elapsedMs: 0, durationMs: 60000, cycle: 2 });
    expect(next.status).toBe("playing");
    expect(next.knights).toHaveLength(32);
    expect(next.events).toEqual([]);
  });

  it("is deterministic and rejects partial or invalid simulation ticks", () => {
    const initial = createDemo();
    const snapshot = structuredClone(initial);
    expect(tickDemo(initial, 10000)).toEqual(
      tickDemo(tickDemo(initial, 4000), 6000),
    );
    expect(initial).toEqual(snapshot);
    for (const ms of [-100, 5, NaN, Infinity]) {
      expect(() => tickDemo(initial, ms)).toThrow();
    }
  });
});
