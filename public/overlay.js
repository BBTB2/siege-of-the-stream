import { connectState } from "./stream.js";
import { armyPage } from "./army-page.js";

const canvas = document.querySelector("#battle");
const ctx = canvas.getContext("2d");
const colors = {
  panel: "rgba(13, 22, 29, .91)",
  white: "#f1f8f5",
  muted: "#a3b7b4",
  mint: "#83f8b5",
  orange: "#ff9267",
};
let state;
let previous;
let receivedAt = 0;
let status = "Connecting";
let lastFrame = 0;
let previousKnights = new Map();
ctx.imageSmoothingEnabled = false;
connectState(
  (next, at) => {
    previous = state;
    previousKnights = new Map(
      (previous?.knights ?? []).map((knight) => [knight.id, knight]),
    );
    state = next;
    receivedAt = at;
  },
  (next) => {
    status = next;
  },
);

function box(x, y, width, height, color = colors.panel) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}
function text(label, x, y, size = 24, color = colors.white, align = "left") {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.fillText(String(label), x, y);
}
function clock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function bar(x, y, width, height, ratio, color) {
  box(x, y, width, height, "#263b43");
  box(x, y, width * Math.max(0, Math.min(1, ratio)), height, color);
}
function hud(now, alpha) {
  box(40, 35, 1220, 137);
  box(40, 35, 7, 137, colors.mint);
  text("SIEGE OF THE STREAM", 65, 72, 22, colors.mint);
  text(state.boss.name.toUpperCase(), 65, 113, 31);
  const oldHp =
    previous?.boss.id === state.boss.id ? previous.boss.hp : state.boss.hp;
  const hp = oldHp + (state.boss.hp - oldHp) * alpha;
  bar(65, 133, 925, 14, hp / state.boss.maxHp, state.boss.color);
  text(
    `${state.boss.hp.toLocaleString()} / ${state.boss.maxHp.toLocaleString()}`,
    1235,
    145,
    22,
    colors.muted,
    "right",
  );
  text(
    `PHASE ${state.boss.phase} / 3`,
    1235,
    75,
    22,
    state.boss.phase === 3 ? colors.orange : colors.muted,
    "right",
  );
  box(1290, 35, 260, 137);
  text("TIME REMAINING", 1420, 75, 20, colors.muted, "center");
  text(clock(state.endsAt - now), 1420, 132, 47, colors.white, "center");
  box(1580, 35, 300, 137);
  text("KNIGHTS STANDING", 1730, 75, 20, colors.muted, "center");
  text(
    `${state.knights.filter((k) => k.hp > 0).length} / ${state.knights.length}`,
    1730,
    132,
    39,
    colors.mint,
    "center",
  );
}
function knight(k, now, alpha) {
  const old = previousKnights.get(k.id) ?? k;
  const x = old.x + (k.x - old.x) * alpha;
  const bob = k.hp > 0 ? Math.floor(Math.sin(now / 210 + k.x) * 2) * 2 : 0;
  const y = old.y + (k.y - old.y) * alpha + bob;
  const coat =
    k.kind === "champion"
      ? "#ffd980"
      : k.kind === "reinforcement"
        ? "#b4b0ff"
        : colors.mint;
  ctx.save();
  if (k.hp <= 0) ctx.globalAlpha = 0.35;
  box(x - 17, y - 36, 30, 22, "#c8dee1");
  box(x - 17, y - 26, 24, 6, "#21313c");
  box(x - 12, y - 14, 24, 24, coat);
  box(x - 12, y + 10, 8, 10, "#c8dee1");
  box(x + 4, y + 10, 8, 10, "#c8dee1");
  box(x + 20, y - 34, 5, 33, "#e9f7ff");
  box(x + 14, y - 7, 17, 5, "#ffd980");
  if (k.kind === "champion") {
    box(x - 17, y - 43, 30, 6, "#ffd980");
    for (let i = 0; i < 3; i++) box(x - 17 + i * 12, y - 49, 6, 6, "#ffd980");
  }
  if (k.defendedUntil > now || state.shieldUntil > now) {
    box(x - 27, y - 12, 17, 25, "#79c9ff");
    box(x - 22, y - 8, 6, 16, "#d7f3ff");
  }
  bar(
    x - 23,
    y - 56,
    46,
    4,
    k.hp / k.maxHp,
    k.hp > 30 ? colors.mint : colors.orange,
  );
  ctx.restore();
  const name =
    k.username.length > 10 ? `${k.username.slice(0, 9)}…` : k.username;
  box(x - 42, y + 23, 84, 22, colors.panel);
  text(
    k.hp <= 0 ? `${name} ×` : name,
    x,
    y + 39,
    14,
    k.hp <= 0 ? colors.muted : colors.white,
    "center",
  );
}
function boss(now) {
  const x = 1600;
  const y = 650 + Math.floor(Math.sin(now / 400) * 4);
  const color = state.boss.color;
  ctx.save();
  if (state.boss.hp === 0) ctx.globalAlpha = 0.3;
  box(x - 100, y - 110, 200, 150, "#172631");
  box(x - 80, y - 180, 160, 110, color);
  box(x - 120, y - 205, 40, 70, color);
  box(x + 80, y - 205, 40, 70, color);
  box(x - 55, y - 147, 35, 20, state.rage ? "#ff5f47" : "#f8f8ec");
  box(x + 20, y - 147, 35, 20, state.rage ? "#ff5f47" : "#f8f8ec");
  box(x - 30, y - 105, 60, 15, "#263645");
  box(x - 90, y - 60, 180, 120, color);
  box(x - 145, y - 65, 45, 105, color);
  box(x + 100, y - 65, 45, 105, color);
  box(x - 80, y + 60, 60, 50, "#526373");
  box(x + 20, y + 60, 60, 50, "#526373");
  box(x - 30, y - 20, 60, 50, "#263645");
  box(x - 12, y - 10, 24, 30, state.rage ? "#ff5f47" : colors.mint);
  ctx.restore();
  box(x - 180, y + 137, 360, 45);
  text(
    state.rage ? "RAGE ATTACK INCOMING" : state.boss.name.toUpperCase(),
    x,
    y + 168,
    22,
    state.rage ? colors.orange : color,
    "center",
  );
}
function effects(now) {
  if (state.rage) {
    const pulse = 0.13 + Math.abs(Math.sin(now / 130)) * 0.13;
    box(
      state.rage.x,
      715,
      state.rage.width,
      290,
      `rgba(255, 77, 53, ${pulse})`,
    );
    box(state.rage.x, 1000, state.rage.width, 6, colors.orange);
    box(480, 620, 770, 68);
    text(
      `!DEFEND NOW · SLAM IN ${Math.max(0, (state.rage.hitsAt - now) / 1000).toFixed(1)}s`,
      865,
      664,
      30,
      colors.orange,
      "center",
    );
  }
  if (state.shieldUntil > now) {
    box(40, 190, 510, 49, "rgba(32, 88, 115, .95)");
    text(
      `SHIELD WALL · ${Math.ceil((state.shieldUntil - now) / 1000)}s`,
      65,
      223,
      25,
      "#b0e6ff",
    );
  }
  const latest = state.effects.filter((e) => e.until > now).at(-1);
  if (!latest) return;
  const labels = {
    heal: `+${latest.amount} HEAL`,
    fireball: `${latest.amount} FIREBALL DAMAGE`,
    champion: "CHAMPION SUMMONED",
    raid: `+${latest.amount} REINFORCEMENTS`,
    shield: "SHIELD WALL RAISED",
    slam: "BOSS SLAM",
  };
  box(620, 205, 690, 55);
  text(
    labels[latest.type] ?? latest.type.toUpperCase(),
    965,
    242,
    27,
    latest.type === "fireball" ? colors.orange : colors.mint,
    "center",
  );
  if (latest.type === "fireball") {
    const progress = 1 - Math.max(0, latest.until - now) / 1500;
    const x = 250 + Math.min(1, progress * 2) * 1350;
    box(x - 60, 560, 75, 20, "#ff734f");
    box(x - 20, 545, 45, 48, "#ffc66b");
    box(x, 553, 25, 30, "#fff0c5");
  }
}
function results(now) {
  box(340, 280, 1240, 620, "rgba(10, 20, 27, .97)");
  box(
    340,
    280,
    1240,
    6,
    state.outcome === "victory" ? colors.mint : colors.orange,
  );
  text(
    state.outcome === "victory"
      ? "THE STREAM PREVAILS"
      : state.outcome === "timeout"
        ? "TIME IS UP"
        : "ROUND ENDED",
    960,
    350,
    43,
    colors.mint,
    "center",
  );
  text("HALL OF HEROES", 960, 399, 24, colors.muted, "center");
  const columns = [440, 930, 1090, 1250, 1440];
  ["KNIGHT", "DAMAGE", "HEALS", "BLOCKS", "SCORE"].forEach((label, i) =>
    text(label, columns[i], 460, 20, colors.muted, i ? "right" : "left"),
  );
  state.leaderboard.slice(0, 5).forEach((leader, i) => {
    const y = 515 + i * 55;
    if (i === 0) box(400, y - 31, 1120, 46, "#203e36");
    text(
      `${i === 0 ? "MVP" : `#${i + 1}`} ${leader.username}`,
      420,
      y,
      23,
      i === 0 ? colors.mint : colors.white,
    );
    [leader.damage, leader.heals, leader.blocks, leader.score].forEach(
      (value, index) =>
        text(value, columns[index + 1], y, 24, colors.white, "right"),
    );
  });
  if (!state.leaderboard.length)
    text(
      "Your army awaits the next round.",
      960,
      560,
      25,
      colors.muted,
      "center",
    );
  text(
    `Damage + healing + 25 per block · Next round in ${Math.max(0, Math.ceil((state.resultsUntil - now) / 1000))}s`,
    960,
    856,
    21,
    colors.muted,
    "center",
  );
}
function army(now, alpha) {
  const visible = armyPage(state.knights, now);
  visible.knights.forEach((k) => knight(k, now, alpha));
  const label = `Army ${visible.page}/${visible.pageCount} · all ${state.knights.length} knights participate`;
  if (visible.pageCount > 1) {
    box(40, 695, 760, 36);
    text(label, 56, 720, 21, colors.muted);
  }
  const description = `${state.boss.name}, phase ${state.boss.phase}. ${label}. Showing ${visible.knights.map((k) => k.username).join(", ")}.`;
  if (canvas.getAttribute("aria-label") !== description) {
    canvas.setAttribute("aria-label", description);
  }
}
function render(at) {
  requestAnimationFrame(render);
  if (at - lastFrame < 1000 / 30) return;
  lastFrame = at - ((at - lastFrame) % (1000 / 30));
  ctx.clearRect(0, 0, 1920, 1080);
  const alpha = Math.min(1, (at - receivedAt) / 100);
  const now = state ? state.now + Math.min(100, at - receivedAt) : 0;
  if (state?.status === "playing" || state?.status === "results") {
    hud(now, alpha);
    effects(now);
    boss(now);
    army(now, alpha);
    if (state.status === "results") results(now);
  } else {
    const idleDescription = "Siege of the Stream. Waiting for the next round.";
    if (canvas.getAttribute("aria-label") !== idleDescription) {
      canvas.setAttribute("aria-label", idleDescription);
    }
    box(40, 910, 920, 97);
    text("SIEGE OF THE STREAM", 65, 949, 29, colors.mint);
    text("The next siege is coming. Ready your chat.", 65, 985, 24);
  }
  box(40, 1020, 1840, 44);
  text(
    "!join  ENLIST     !attack  STRIKE     !defend  BLOCK     !heal  RESTORE",
    65,
    1050,
    23,
  );
  text("3s action cooldown", 1855, 1050, 21, colors.muted, "right");
  if (status !== "Connected") {
    box(1330, 190, 550, 49, "#643c28");
    text(
      `${status.toUpperCase()} · GAME MAY BE STALE`,
      1605,
      222,
      18,
      "#ffdfab",
      "center",
    );
  }
}
requestAnimationFrame(render);
