/** A deterministic showcase using the same engine as the live battle. No I/O. */
import {
  command,
  createGame,
  RULES,
  startRound,
  tick,
  triggerRage,
  twitchEvent,
  type ChatCommand,
  type GameState,
} from "./game/index.js";

export type DemoState = GameState & {
  demo: { elapsedMs: number; durationMs: number; cycle: number };
};
const DURATION = 60000;
const COLORS = ["#83f8b5", "#ffb86c", "#bb9aff", "#75d7ff", "#ff89bd"];
const NAMES = [
  "PixelPaladin",
  "MoonMage",
  "TinyTank",
  "EmberFox",
  "CriticalKit",
  "ShieldMaiden",
  "SirSpamsalot",
  "HealYeah",
];

function crowd(
  state: GameState,
  action: ChatCommand,
  from: number,
  to: number,
): GameState {
  let next = state;
  for (let index = from; index < to; index++) {
    next = command(
      next,
      `demo-${index}`,
      `${NAMES[index % NAMES.length]}${index < 8 ? "" : index}`,
      action,
      COLORS[index % COLORS.length],
    );
  }
  return next;
}

/** Each viewer gets an independent timeline; reconnecting restarts the show. */
export function createDemo(cycle = 1): DemoState {
  const initial = startRound(createGame(), {
    boss: "void-king",
    durationMs: DURATION,
  });
  return {
    ...crowd(initial, "!join", 0, 32),
    demo: { elapsedMs: 0, durationMs: DURATION, cycle },
  };
}

const strikes = new Set([
  3000, 6000, 9000, 12000, 16000, 21000, 27000, 31000, 36000, 39000, 42000,
]);
function scene(state: GameState): GameState {
  const at = state.now;
  if (strikes.has(at)) return crowd(state, "!attack", 0, 8);
  switch (at) {
    case 2000:
      return crowd(state, "!join", 32, 200);
    case 4000:
      return twitchEvent(state, { type: "follow", username: "DawnGuard" });
    case 7000:
      return twitchEvent(state, {
        type: "subscription",
        username: "GoldenFox",
      });
    case 10000:
      return twitchEvent(state, { type: "gift", username: "GiftGoblin" });
    case 14000:
      return twitchEvent(state, {
        type: "cheer",
        bits: 500,
        username: "EmberFox",
        userId: "demo-3",
      });
    case 18000:
      return twitchEvent(state, {
        type: "raid",
        viewers: 50,
        username: "PixelLegion",
      });
    case 22000:
      return triggerRage(crowd(state, "!defend", 8, 16));
    case 25000:
      return crowd(state, "!heal", 0, 200);
    case 29000:
      return twitchEvent(state, {
        type: "cheer",
        bits: 500,
        username: "CriticalKit",
        userId: "demo-4",
      });
    case 32000:
      return crowd(state, "!defend", 8, 16);
    case 34000:
      return twitchEvent(crowd(state, "!heal", 0, 8), {
        type: "follow",
        username: "LastStand",
      });
    case 45000:
      return twitchEvent(state, {
        type: "cheer",
        bits: state.boss.hp,
        username: "PixelPaladin",
        userId: "demo-0",
      });
    default:
      return state;
  }
}

/** The 45s battle ends in victory; its MVP card remains for the final 15s. */
export function tickDemo(state: DemoState, elapsedMs: number): DemoState {
  if (
    !Number.isSafeInteger(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs % RULES.tickMs !== 0
  ) {
    throw new Error("Demo ticks must be nonnegative multiples of 100ms");
  }
  let next = state;
  for (let elapsed = 0; elapsed < elapsedMs; elapsed += RULES.tickMs) {
    const nextTime = next.demo.elapsedMs + RULES.tickMs;
    if (nextTime >= DURATION) next = createDemo(next.demo.cycle + 1);
    else
      next = {
        ...scene(tick(next)),
        demo: { ...next.demo, elapsedMs: nextTime },
      };
  }
  return next;
}
