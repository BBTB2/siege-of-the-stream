import {
  RULES,
  chatColor,
  type BattleEffect,
  type GameState,
  type Knight,
} from "./model.js";

export function updateKnight(
  state: GameState,
  id: string,
  change: (knight: Knight) => Knight,
): GameState {
  return {
    ...state,
    knights: state.knights.map((knight) =>
      knight.id === id ? change(knight) : knight,
    ),
  };
}

export function spawn(
  state: GameState,
  id: string,
  username: string,
  kind: Knight["kind"],
  color?: string,
): GameState {
  const index = state.knights.length;
  const maxHp = kind === "champion" ? 200 : 100;
  return {
    ...state,
    knights: [
      ...state.knights,
      {
        id,
        username: username.slice(0, 25),
        kind,
        ...(chatColor(color) ? { color } : {}),
        hp: maxHp,
        maxHp,
        damage: 0,
        heals: 0,
        blocks: 0,
        nextActionAt: state.now,
        defendedUntil: 0,
        x: 100 + (index % 15) * 85,
        y: 790 + (Math.floor(index / 15) % 4) * 60,
      },
    ],
  };
}

export function effect(
  state: GameState,
  type: string,
  amount = 0,
  metadata: Pick<
    BattleEffect,
    "username" | "bits" | "sourceId" | "targetId"
  > = {},
): GameState {
  const sequence = state.sequence + 1;
  return {
    ...state,
    sequence,
    effects: [
      ...state.effects,
      {
        id: sequence,
        type,
        amount,
        ...metadata,
        createdAt: state.now,
        until: state.now + 1500,
      },
    ].slice(-20),
  };
}

export function finish(
  state: GameState,
  outcome: GameState["outcome"],
): GameState {
  const leaderboard = state.knights
    .map((knight) => ({
      id: knight.id,
      username: knight.username,
      damage: knight.damage,
      heals: knight.heals,
      blocks: knight.blocks,
      score: knight.damage + knight.heals + knight.blocks * 25,
    }))
    .sort(
      (a, b) =>
        b.score - a.score || b.damage - a.damage || a.id.localeCompare(b.id),
    );
  return {
    ...state,
    status: "results",
    outcome,
    resultsUntil: state.now + RULES.leaderboardMs,
    rage: null,
    leaderboard,
  };
}

export function beginRage(state: GameState): GameState {
  return {
    ...state,
    rage: { hitsAt: state.now + RULES.telegraphMs, x: 40, width: 1360 },
  };
}

export function damage(
  state: GameState,
  amount: number,
  sourceId?: string,
): GameState {
  const dealt = Math.min(state.boss.hp, amount);
  const hp = state.boss.hp - dealt;
  const phase =
    hp <= state.boss.maxHp / 3 ? 3 : hp <= (state.boss.maxHp * 2) / 3 ? 2 : 1;
  const credited = sourceId
    ? updateKnight(state, sourceId, (knight) => ({
        ...knight,
        damage: knight.damage + dealt,
      }))
    : state;
  const next: GameState = { ...credited, boss: { ...state.boss, hp, phase } };
  if (hp === 0) return finish(next, "victory");
  return state.boss.phase < 3 && phase === 3 && !state.rage
    ? beginRage(next)
    : next;
}

export function hitKnight(
  state: GameState,
  knight: Knight,
  lethal: boolean,
): Knight {
  if (knight.hp <= 0) return knight;
  if (state.shieldUntil > state.now || knight.defendedUntil > state.now) {
    return { ...knight, blocks: knight.blocks + 1 };
  }
  return {
    ...knight,
    hp: lethal ? 0 : Math.max(0, knight.hp - state.boss.phase * 10),
  };
}
