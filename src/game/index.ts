/** Public API: deterministic state transitions with no clock, randomness, or I/O. */
import {
  BOSSES,
  RULES,
  createGame,
  chatColor,
  type BossId,
  type ChatCommand,
  type GameState,
  type TwitchEvent,
} from "./model.js";
import {
  beginRage,
  damage,
  effect,
  finish,
  spawn,
  updateKnight,
} from "./combat.js";
export * from "./model.js";
export { tick } from "./tick.js";

export function startRound(
  state: GameState,
  options: { boss: BossId; durationMs: number },
): GameState {
  if (state.status !== "idle") return state;
  if (
    !Object.hasOwn(BOSSES, options.boss) ||
    !Number.isInteger(options.durationMs) ||
    options.durationMs < 1000 ||
    options.durationMs > 3600000
  ) {
    throw new Error("Invalid round options");
  }
  const boss = BOSSES[options.boss];
  return {
    ...createGame(),
    now: state.now,
    status: "playing",
    endsAt: state.now + options.durationMs,
    nextStrikeAt: state.now + 5000,
    boss: {
      id: options.boss,
      name: boss.name,
      hp: boss.hp,
      maxHp: boss.hp,
      phase: 1,
      color: boss.color,
    },
  };
}

function heal(state: GameState, healerId: string): GameState {
  const healer = state.knights.find((knight) => knight.id === healerId);
  const target =
    healer?.hp === 0
      ? healer
      : state.knights
          .filter((knight) => knight.hp < knight.maxHp)
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (!target) return state;
  const amount = Math.min(RULES.healAmount, target.maxHp - target.hp);
  const healed = updateKnight(state, target.id, (knight) => ({
    ...knight,
    hp: knight.hp + amount,
  }));
  const credited = updateKnight(healed, healerId, (knight) => ({
    ...knight,
    heals: knight.heals + amount,
  }));
  return effect(credited, "heal", amount, {
    sourceId: healerId,
    targetId: target.id,
  });
}

export function command(
  state: GameState,
  userId: string,
  username: string,
  action: ChatCommand,
  color?: string,
): GameState {
  if (state.status !== "playing" || !userId.trim() || !username.trim())
    return state;
  const id = `viewer:${userId}`;
  const knight = state.knights.find((knight) => knight.id === id);
  const validColor = chatColor(color);
  const colored =
    knight && validColor && validColor !== knight.color
      ? updateKnight(state, id, (current) => ({
          ...current,
          color: validColor,
        }))
      : state;
  if (action === "!join")
    return knight ? colored : spawn(state, id, username, "viewer", validColor);
  if (
    !knight ||
    (knight.hp <= 0 && action !== "!heal") ||
    state.now < knight.nextActionAt
  )
    return state;
  if (!["!attack", "!defend", "!heal"].includes(action)) return state;
  const ready = updateKnight(colored, id, (knight) => ({
    ...knight,
    nextActionAt: state.now + RULES.cooldownMs,
  }));
  if (action === "!attack") return damage(ready, RULES.attackDamage, id);
  if (action === "!defend")
    return updateKnight(ready, id, (knight) => ({
      ...knight,
      defendedUntil: state.now + RULES.defendMs,
    }));
  return heal(ready, id);
}

export function triggerRage(state: GameState): GameState {
  return state.status !== "playing" || state.rage ? state : beginRage(state);
}

export function stopRound(state: GameState): GameState {
  return state.status !== "playing" ? state : finish(state, "stopped");
}

function summon(
  state: GameState,
  username: string,
  kind: "champion" | "reinforcement",
): GameState {
  const sequence = state.sequence + 1;
  return spawn({ ...state, sequence }, `npc:${sequence}`, username, kind);
}

export function twitchEvent(state: GameState, event: TwitchEvent): GameState {
  if (state.status !== "playing") return state;
  if (
    "username" in event &&
    event.username !== undefined &&
    !event.username.trim()
  )
    return state;
  switch (event.type) {
    case "follow":
      return eventEffect(
        { ...state, shieldUntil: state.now + RULES.shieldMs },
        event,
        "shield",
        0,
      );
    case "subscription":
    case "gift":
      return eventEffect(
        summon(state, `${event.username}'s champion`, "champion"),
        event,
        "champion",
        1,
      );
    case "cheer": {
      if (!Number.isSafeInteger(event.bits) || event.bits <= 0) return state;
      const amount = Math.min(event.bits, state.boss.hp);
      return eventEffect(
        damage(
          state,
          amount,
          event.userId ? `viewer:${event.userId}` : undefined,
        ),
        event,
        "fireball",
        amount,
      );
    }
    case "raid": {
      if (!Number.isSafeInteger(event.viewers) || event.viewers < 0)
        return state;
      const count = Math.min(event.viewers, 50);
      const reinforced = Array.from({ length: count }).reduce<GameState>(
        (current, _, index) =>
          summon(current, `${event.username} #${index + 1}`, "reinforcement"),
        state,
      );
      return eventEffect(reinforced, event, "raid", count);
    }
    default:
      return state;
  }
}

function eventEffect(
  state: GameState,
  event: TwitchEvent,
  type: string,
  amount: number,
): GameState {
  const username = event.username ?? "Anonymous";
  const next = effect(state, type, amount, {
    username,
    ...(event.type === "cheer" ? { bits: event.bits } : {}),
  });
  return {
    ...next,
    events: [
      ...state.events,
      {
        id: next.sequence,
        type: event.type,
        username,
        amount: event.type === "cheer" ? event.bits : amount,
      },
    ].slice(-4),
  };
}
