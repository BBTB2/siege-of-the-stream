import { describe, expect, it } from "vitest";
// Browser helpers are ordinary ESM; no canvas mock is needed for their contracts.
// @ts-expect-error plain browser JavaScript
import {
  company,
  shortName,
  fireballSize,
  eventLabel,
} from "../public/overlay-layout.js";
// @ts-expect-error plain browser JavaScript
import { Feedback } from "../public/overlay-feedback.js";

describe("overlay presentation bounds", () => {
  it("coalesces simultaneous healing so a mass revive does not cover the army in text", () => {
    const fx = new Feedback();
    const state = {
      status: "playing",
      now: 25000,
      endsAt: 60000,
      boss: { id: "void-king", hp: 2500 },
      effects: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        type: "heal",
        amount: 30,
        until: 26500,
      })),
    };
    fx.receive(state, undefined, 1000);
    expect(fx.numbers).toHaveLength(1);
    expect(fx.numbers[0].value).toBe("+600 HEAL");
  });
  const snapshot = (changes = {}) => ({
    status: "playing",
    now: 1000,
    endsAt: 60000,
    boss: { id: "void-king", hp: 3000 },
    effects: [{ id: 10, type: "fireball", amount: 100, until: 2500 }],
    ...changes,
  });

  it.each([
    { now: 70000, endsAt: 130000 },
    { boss: { id: "ember-drake", hp: 2000 } },
    { demo: { cycle: 2 } },
    { now: 0 },
  ])(
    "replays fresh effects after a round boundary hidden by reconnect: %j",
    (changes) => {
      const fx = new Feedback();
      const previous = snapshot({ demo: { cycle: 1 } });
      fx.receive(previous, undefined, 0);
      fx.number("old round", 0, 0, "#fff", 0);
      fx.shake(0, 10);
      const next = snapshot({
        demo: { cycle: 1 },
        ...changes,
        effects: [{ id: 1, type: "fireball", amount: 500, until: 140000 }],
      });
      fx.receive(next, previous, 100);
      expect(fx.fireballs).toHaveLength(1);
      expect(fx.fireballs[0].size).toBeGreaterThan(fireballSize(100));
      expect(fx.numbers).toHaveLength(0);
      expect(fx.shakeUntil).toBe(0);
    },
  );

  it("does not replay effects or discard existing particles for ordinary snapshots", () => {
    const fx = new Feedback();
    const previous = snapshot();
    fx.receive(previous, undefined, 0);
    fx.burst(0, 0, "#fff", 5, 0);
    fx.receive(snapshot({ now: 1100 }), previous, 100);
    expect(fx.fireballs).toHaveLength(1);
    expect(fx.particles).toHaveLength(5);
  });

  it("rotates readable nameplates without losing the rest of a 220 knight army", () => {
    const knights = Array.from({ length: 220 }, (_, i) => ({ id: String(i) }));
    const first = company(knights, 0);
    expect(first.front.length).toBe(24);
    expect(first.reserve.length).toBe(196);
    const seen = new Set();
    for (let t = 0; t < 60000; t += 6000)
      for (const k of company(knights, t).front) seen.add(k.id);
    expect(seen.size).toBe(220);
  });
  it("truncates names by code point and sizes bits safely", () => {
    expect(shortName("abcdefghijklmnop")).toBe("abcdefghijk…");
    expect([...shortName("😀".repeat(20))]).toHaveLength(12);
    expect(fireballSize(500)).toBeGreaterThan(fireballSize(1));
    expect(fireballSize(1e12)).toBeLessThanOrEqual(64);
    expect(
      eventLabel({ type: "cheer", username: "alice", amount: 500 }),
    ).toContain("@alice cheered 500");
  });
  it("bounds particles and floating text under a burst and expires both", () => {
    const fx = new Feedback();
    for (let i = 0; i < 1000; i++) {
      fx.burst(100, 800, "#fff", 20, 0);
      fx.number("25", 1500, 700, "#fff", 0);
    }
    expect(fx.particles.length).toBeLessThanOrEqual(360);
    expect(fx.numbers.length).toBeLessThanOrEqual(40);
    fx.advance(5000, 0.016);
    expect(fx.particles).toHaveLength(0);
    expect(fx.numbers).toHaveLength(0);
  });
});
