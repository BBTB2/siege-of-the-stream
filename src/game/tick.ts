import { RULES, type GameState } from "./model.js";
import {
  beginRage,
  damage,
  effect,
  finish,
  hitKnight,
  updateKnight,
} from "./combat.js";

function resolveRage(state: GameState): GameState {
  const rage = state.rage;
  if (!rage || state.now < rage.hitsAt) return state;
  const knights = state.knights.map((knight) =>
    knight.x >= rage.x && knight.x <= rage.x + rage.width
      ? hitKnight(state, knight, true)
      : knight,
  );
  return effect(
    { ...state, knights, rage: null, nextRageAt: state.now + 8000 },
    "slam",
  );
}

function resolveStrikes(state: GameState): GameState {
  if (state.now < state.nextStrikeAt) return state;
  return {
    ...state,
    nextStrikeAt: state.now + 5000,
    knights: state.knights.map((knight) => hitKnight(state, knight, false)),
  };
}

function resolveNpcAttacks(state: GameState): GameState {
  return state.knights.reduce((current, knight) => {
    if (
      current.status !== "playing" ||
      knight.kind === "viewer" ||
      knight.hp <= 0 ||
      current.now < knight.nextActionAt
    )
      return current;
    const ready = updateKnight(current, knight.id, (npc) => ({
      ...npc,
      nextActionAt: current.now + RULES.cooldownMs,
    }));
    return damage(ready, knight.kind === "champion" ? 40 : 10, knight.id);
  }, state);
}

function step(state: GameState): GameState {
  const now = state.now + RULES.tickMs;
  const advanced: GameState = {
    ...state,
    now,
    effects: state.effects.filter((effect) => effect.until > now),
  };
  if (advanced.status === "results" && now >= advanced.resultsUntil) {
    return { ...advanced, status: "idle", leaderboard: [] };
  }
  if (advanced.status !== "playing") return advanced;
  // The round deadline wins a tie with an area attack or NPC damage.
  if (now >= advanced.endsAt) return finish(advanced, "timeout");
  const resolved = resolveRage(advanced);
  const enraged =
    resolved.boss.phase === 3 && !resolved.rage && now >= resolved.nextRageAt
      ? beginRage(resolved)
      : resolved;
  return resolveNpcAttacks(resolveStrikes(enraged));
}

/** Pure fixed-step simulation; elapsed time must be whole 100ms ticks. */
export function tick(
  state: GameState,
  elapsedMs: number = RULES.tickMs,
): GameState {
  if (
    !Number.isSafeInteger(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs % RULES.tickMs !== 0
  ) {
    throw new Error("Ticks must be nonnegative multiples of 100ms");
  }
  let next = state;
  for (let elapsed = 0; elapsed < elapsedMs; elapsed += RULES.tickMs)
    next = step(next);
  return next;
}
