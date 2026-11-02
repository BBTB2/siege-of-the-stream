import { rect, text, panel, bar, clock, palette as c } from "./overlay-kit.js";
import { eventLabel, shortName } from "./overlay-layout.js";

export function ticker(ctx, state, status) {
  panel(ctx, 32, 26, 720, 42);
  text(ctx, "SIEGE / LIVE FROM THE COURTYARD", 50, 54, 21, c.gold);
  const events = state?.events || [];
  events.forEach((event, index) => {
    const y = 76 + index * 36;
    rect(ctx, 32, y, 720, 32, c.panel);
    rect(ctx, 32, y, 4, 32, event.type === "cheer" ? c.red : c.mint);
    text(ctx, eventLabel(event), 50, y + 23, 20);
  });
  if (!events.length) {
    rect(ctx, 32, 76, 720, 35, c.panel);
    text(
      ctx,
      "One chat. One army. One very angry dragon.",
      50,
      101,
      20,
      c.muted,
    );
  }
  if (state?.demo) {
    panel(ctx, 1470, 26, 420, 48, c.mint);
    text(
      ctx,
      `DEMO · ${clock(state.demo.elapsedMs)} / 1:00`,
      1680,
      58,
      23,
      c.mint,
      "center",
    );
  } else if (status !== "Connected") {
    panel(ctx, 1440, 26, 450, 48, c.red);
    text(
      ctx,
      `${status.toUpperCase()} · WAITING FOR STATE`,
      1665,
      56,
      17,
      c.red,
      "center",
    );
  }
}
export function battleHud(ctx, state, now, hp, company) {
  panel(ctx, 38, 660, 1300, 52);
  text(ctx, "SIEGE OF THE STREAM", 58, 694, 25, c.gold);
  text(
    ctx,
    `${state.knights.filter((k) => k.hp > 0).length}/${state.knights.length} STANDING`,
    550,
    693,
    23,
    c.mint,
  );
  text(ctx, `COMPANY ${company.page}/${company.pages}`, 887, 693, 20, c.muted);
  text(ctx, clock(state.endsAt - now), 1318, 695, 28, c.white, "right");
  panel(ctx, 1390, 572, 492, 136, state.boss.color);
  text(ctx, state.boss.name.toUpperCase(), 1410, 604, 26, c.gold);
  text(
    ctx,
    `PHASE ${state.boss.phase} / 3`,
    1860,
    634,
    20,
    state.boss.phase === 3 ? c.red : c.muted,
    "right",
  );
  text(ctx, `${state.boss.hp.toLocaleString()} HP`, 1410, 634, 21);
  bar(
    ctx,
    1410,
    650,
    450,
    25,
    hp / state.boss.maxHp,
    state.boss.phase === 3 ? c.red : state.boss.color,
  );
  for (let i = 1; i < 3; i++)
    rect(ctx, 1410 + (450 * i) / 3, 650, 3, 25, c.ink);
  text(
    ctx,
    state.rage ? "RAGE / BRACE YOUR SHIELDS" : "CHAT VS. THE ANCIENT ONE",
    1635,
    695,
    16,
    state.rage ? c.red : c.muted,
    "center",
  );
}
export function alerts(ctx, state, now, at, fx) {
  if (state.rage) {
    panel(ctx, 345, 566, 760, 75, c.red);
    text(
      ctx,
      `!DEFEND NOW · ${Math.max(0, (state.rage.hitsAt - now) / 1000).toFixed(1)}s`,
      725,
      601,
      31,
      c.red,
      "center",
    );
    text(ctx, "DRAGONFIRE IN THE MARKED ZONE", 725, 628, 19, c.white, "center");
  } else if (fx.banner?.until > at) {
    panel(ctx, 345, 566, 760, 75, fx.banner.color);
    text(ctx, fx.banner.label, 725, 600, 31, fx.banner.color, "center");
    text(ctx, fx.banner.detail, 725, 628, 19, c.white, "center");
  } else if (state.shieldUntil > now) {
    panel(ctx, 450, 590, 550, 51, c.blue);
    text(
      ctx,
      `SHIELD WALL · ${Math.ceil((state.shieldUntil - now) / 1000)}s`,
      725,
      624,
      27,
      c.blue,
      "center",
    );
  }
}
export function instructions(ctx, state) {
  rect(ctx, 0, 1040, 1920, 40, "#121a29");
  text(
    ctx,
    "!join ENLIST     !attack STRIKE     !defend BLOCK     !heal REVIVE",
    40,
    1068,
    23,
    c.white,
  );
  text(ctx, "3s cooldown", 1878, 1068, 21, c.gold, "right");
  if (state?.status === "idle") {
    panel(ctx, 390, 840, 1140, 120);
    text(ctx, "THE NEXT SIEGE IS COMING", 960, 889, 40, c.gold, "center");
    text(
      ctx,
      "Ready your chat. A kingdom needs its knights.",
      960,
      932,
      25,
      c.white,
      "center",
    );
  }
}
export function results(ctx, state, now) {
  panel(ctx, 350, 270, 1220, 586, c.gold);
  rect(ctx, 375, 289, 1170, 2, "#725f43");
  text(
    ctx,
    state.outcome === "victory"
      ? "THE STREAM PREVAILS"
      : state.outcome === "timeout"
        ? "THE DRAGON HOLDS"
        : "THE SIEGE HAS ENDED",
    960,
    345,
    44,
    c.gold,
    "center",
  );
  text(ctx, "HALL OF HEROES / ROUND MVP", 960, 386, 23, c.muted, "center");
  const columns = [420, 990, 1145, 1300, 1500];
  ["KNIGHT", "DAMAGE", "HEALS", "BLOCKS", "SCORE"].forEach((label, i) =>
    text(ctx, label, columns[i], 446, 20, c.muted, i ? "right" : "left"),
  );
  state.leaderboard.slice(0, 5).forEach((leader, i) => {
    const y = 496 + i * 55;
    if (i === 0) rect(ctx, 391, y - 33, 1135, 46, "#443a29");
    text(
      ctx,
      `${i ? `0${i + 1}` : "★ MVP"}  ${shortName(leader.username)}`,
      420,
      y,
      25,
      i ? c.white : c.gold,
    );
    [leader.damage, leader.heals, leader.blocks, leader.score].forEach(
      (value, j) =>
        text(
          ctx,
          value.toLocaleString(),
          columns[j + 1],
          y,
          25,
          c.white,
          "right",
        ),
    );
  });
  text(
    ctx,
    `Damage + heals + 25×blocks  ·  Next siege in ${Math.max(0, Math.ceil((state.resultsUntil - now) / 1000))}s`,
    960,
    813,
    22,
    c.muted,
    "center",
  );
}
