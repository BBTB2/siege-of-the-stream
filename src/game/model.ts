/** Pure deterministic state transitions. All time is simulation milliseconds. */
export const RULES = {
  tickMs: 100,
  cooldownMs: 3000,
  defendMs: 5000,
  shieldMs: 10000,
  telegraphMs: 2000,
  leaderboardMs: 15000,
  attackDamage: 25,
  healAmount: 30,
} as const;
export const BOSSES = {
  "iron-colossus": { name: "Iron Colossus", hp: 3000, color: "#b9a7f4" },
  "ember-drake": { name: "Ember Drake", hp: 4500, color: "#ff8866" },
  "void-king": { name: "Void King", hp: 6000, color: "#80dbce" },
} as const;
export type BossId = keyof typeof BOSSES;
export type ChatCommand = "!join" | "!attack" | "!defend" | "!heal";
export type TwitchEvent =
  | { type: "follow"; username?: string }
  | { type: "subscription" | "gift"; username: string }
  | { type: "cheer"; bits: number; userId?: string; username?: string }
  | { type: "raid"; viewers: number; username: string };
export interface Knight {
  id: string;
  username: string;
  color?: string;
  kind: "viewer" | "champion" | "reinforcement";
  hp: number;
  maxHp: number;
  damage: number;
  heals: number;
  blocks: number;
  nextActionAt: number;
  defendedUntil: number;
  x: number;
  y: number;
}
export interface Leader {
  id: string;
  username: string;
  damage: number;
  heals: number;
  blocks: number;
  score: number;
}
export interface BattleEffect {
  id: number;
  type: string;
  amount: number;
  createdAt: number;
  until: number;
  username?: string;
  bits?: number;
  sourceId?: string;
  targetId?: string;
}
export interface BattleEvent {
  id: number;
  type: TwitchEvent["type"];
  username: string;
  amount: number;
}
/** Twitch chat colours are hex RGB, never arbitrary CSS. */
export function chatColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : undefined;
}
export interface GameState {
  status: "idle" | "playing" | "results";
  now: number;
  endsAt: number;
  resultsUntil: number;
  outcome: "victory" | "timeout" | "stopped" | null;
  boss: {
    id: BossId;
    name: string;
    hp: number;
    maxHp: number;
    phase: 1 | 2 | 3;
    color: string;
  };
  knights: Knight[];
  shieldUntil: number;
  rage: { hitsAt: number; x: number; width: number } | null;
  nextRageAt: number;
  nextStrikeAt: number;
  sequence: number;
  leaderboard: Leader[];
  effects: BattleEffect[];
  events: BattleEvent[];
}
export function createGame(): GameState {
  const b = BOSSES["iron-colossus"];
  return {
    status: "idle",
    now: 0,
    endsAt: 0,
    resultsUntil: 0,
    outcome: null,
    boss: {
      id: "iron-colossus",
      name: b.name,
      hp: b.hp,
      maxHp: b.hp,
      phase: 1,
      color: b.color,
    },
    knights: [],
    shieldUntil: 0,
    rage: null,
    nextRageAt: 0,
    nextStrikeAt: 5000,
    sequence: 0,
    leaderboard: [],
    effects: [],
    events: [],
  };
}
