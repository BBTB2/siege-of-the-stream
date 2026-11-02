import { connectState } from "./stream.js";
import { courtyard, knightSprites, dragonSprite } from "./overlay-art.js";
import {
  company,
  position,
  shortName,
  isNewRound,
  nameplateColor,
} from "./overlay-layout.js";
import { Feedback } from "./overlay-feedback.js";
import { rect, text, bar, palette as c } from "./overlay-kit.js";
import {
  ticker,
  battleHud,
  alerts,
  instructions,
  results,
} from "./overlay-hud.js";

const canvas = document.querySelector("#battle");
const ctx = canvas.getContext("2d", { alpha: true });
ctx.imageSmoothingEnabled = false;
const ground = courtyard(),
  sprites = knightSprites(),
  fx = new Feedback();
let state,
  previous,
  receivedAt = 0,
  status = "Connecting",
  lastFrame = 0;
let roster = company([], 0),
  previousKnights = new Map();
let dragon, dragonRage, dragonColor;
let arrivals = new Map(),
  fallen = new Map();
let frameCount = 0,
  lastMeasure = 0,
  drawTotal = 0;

connectState(
  (next, at) => {
    const reset = isNewRound(next, state);
    previous = reset ? undefined : state;
    previousKnights = new Map((previous?.knights ?? []).map((k) => [k.id, k]));
    if (reset) {
      arrivals = new Map();
      fallen = new Map();
    }
    for (const k of next.knights) {
      const old = previousKnights.get(k.id);
      if (!old) arrivals.set(k.id, at);
      if (k.hp <= 0 && old?.hp > 0) fallen.set(k.id, at);
      if (k.hp > 0) fallen.delete(k.id);
      if (at - (arrivals.get(k.id) ?? 0) > 4000) arrivals.delete(k.id);
    }
    fx.receive(next, previous, at);
    state = next;
    receivedAt = at;
    canvas.dataset.demoMs = String(state.demo?.elapsedMs ?? 0);
    roster = company(state.knights, state.now);
    if (dragonColor !== state.boss.color) {
      dragonColor = state.boss.color;
      dragon = dragonSprite(dragonColor);
      dragonRage = dragonSprite(dragonColor, true);
    }
    canvas.setAttribute(
      "aria-label",
      `${state.demo ? "Demo. " : ""}${state.status}. ${state.boss.name}, phase ${state.boss.phase}, ${state.boss.hp} HP. ${state.knights.length} knights. ${state.rage ? "Defend now!" : ""}`,
    );
  },
  (next) => {
    status = next;
  },
);

function drawKnight(k, x, y, scale, at, now, named) {
  const age = at - (arrivals.get(k.id) ?? -10000);
  const progress = Math.max(
    0,
    Math.min(1, age / (k.kind === "reinforcement" ? 2600 : 1500)),
  );
  x -= (1 - progress) * (x + 100);
  const old = previousKnights.get(k.id);
  const alpha = Math.min(1, (at - receivedAt) / 100);
  if (k.hp > 0 && old && k.damage > old.damage)
    x += Math.sin(alpha * Math.PI) * 9;
  const bob =
    k.hp > 0
      ? (Math.floor(Math.sin(now / 150 + x) * (progress < 1 ? 2 : 1)) * scale) /
        2
      : 0;
  const defended = k.defendedUntil > now || state.shieldUntil > now;
  const sprite =
    sprites.get(`${k.kind}:${defended}`) ?? sprites.get("viewer:false");
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y + bob));
  if (k.hp <= 0) {
    const fall = Math.min(1, (at - (fallen.get(k.id) ?? at - 350)) / 350);
    ctx.rotate((-Math.PI / 2) * fall);
    ctx.globalAlpha = 0.48;
  }
  ctx.drawImage(sprite, -12 * scale, -28 * scale, 24 * scale, 29 * scale);
  ctx.restore();
  if (!named || progress < 0.8) return;
  const nameY = y - 58;
  const color =
    k.color ||
    (k.kind === "champion"
      ? c.gold
      : k.kind === "reinforcement"
        ? "#c4b5ff"
        : c.white);
  rect(ctx, x - 78, nameY - 21, 156, 27, nameplateColor(color));
  text(ctx, shortName(k.username), x, nameY, 20, color, "center", 144);
  bar(ctx, x - 25, y - 49, 50, 8, k.hp / k.maxHp, k.hp > 30 ? c.mint : c.red);
  if (k.hp <= 0) text(ctx, "!heal ↑", x + 35, y - 12, 15, c.mint);
}
function army(at, now) {
  const columns = Math.max(65, Math.ceil(roster.reserve.length / 4));
  const spacing = 1300 / columns;
  roster.reserve.forEach((k, i) => {
    const x = 52 + (i % columns) * spacing,
      y = 743 + Math.floor(i / columns) * 11;
    drawKnight(k, x, y, Math.min(0.75, spacing / 24), at, now, false);
  });
  roster.front.forEach((k, i) => {
    const { x, y } = position(i);
    drawKnight(k, x, y, k.kind === "champion" ? 2.35 : 2, at, now, true);
  });
  const champion = state.knights.findLast(
    (k) => k.kind === "champion" && k.hp > 0,
  );
  if (champion && !roster.front.some((k) => k.id === champion.id))
    drawKnight(champion, 1370, 995, 3, at, now, false);
}
function zones(now) {
  if (state.rage) {
    const pulse = 0.12 + Math.abs(Math.sin(now / 100)) * 0.12;
    rect(ctx, 0, 720, 1920, 320, `rgba(185, 23, 42, ${pulse})`);
    ctx.strokeStyle = c.red;
    ctx.lineWidth = 4;
    ctx.strokeRect(state.rage.x, 725, state.rage.width, 309);
    for (let x = state.rage.x; x < state.rage.x + state.rage.width; x += 50) {
      rect(ctx, x, 1023, 25, 9, c.red);
      rect(ctx, x, 725, 25, 7, c.red);
    }
  }
  if (state.shieldUntil > now) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(704, 1025, 680, 300, 0, Math.PI, 2 * Math.PI);
    ctx.closePath();
    ctx.fillStyle = "rgba(71, 166, 224, .09)";
    ctx.fill();
    ctx.strokeStyle = `rgba(137, 221, 255, ${0.65 + Math.sin(now / 250) * 0.2})`;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.setLineDash([12, 20]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(704, 1025, 662, 283, 0, Math.PI, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }
}
function drawBoss(now) {
  ctx.save();
  const dead = state.boss.hp === 0;
  if (dead) ctx.globalAlpha = 0.35;
  const bob = dead ? 20 : Math.sin(now / 470) * 6;
  ctx.drawImage(state.rage ? dragonRage : dragon, 1375, 705 + bob, 504, 340);
  if (state.rage)
    for (let i = 0; i < 5; i++)
      rect(ctx, 1400 - i * 13, 830 + Math.sin(now / 80 + i) * 8, 8, 8, c.red);
  ctx.restore();
}
function render(at) {
  requestAnimationFrame(render);
  const started = performance.now();
  const dt = Math.min(0.05, (at - lastFrame) / 1000 || 0);
  lastFrame = at;
  const now = state ? state.now + Math.min(100, at - receivedAt) : 0;
  fx.advance(at, dt);
  ctx.clearRect(0, 0, 1920, 1080);
  ctx.save();
  // Shake cannot spill opaque scenery into the transparent stream area.
  ctx.beginPath();
  ctx.rect(0, 720, 1920, 360);
  ctx.clip();
  if (fx.shakeUntil > at) {
    const power = (fx.shakePower * (fx.shakeUntil - at)) / 230;
    ctx.translate(Math.sin(at * 0.13) * power, Math.cos(at * 0.17) * power);
  }
  ctx.drawImage(ground, 0, 720);
  if (state) {
    zones(now);
    army(at, now);
    drawBoss(now);
  }
  ctx.restore();
  ticker(ctx, state, status);
  if (state && state.status !== "idle") {
    const alpha = Math.min(1, (at - receivedAt) / 100);
    const hp = previous
      ? previous.boss.hp + (state.boss.hp - previous.boss.hp) * alpha
      : state.boss.hp;
    battleHud(ctx, state, now, hp, roster);
    alerts(ctx, state, now, at, fx);
  }
  fx.draw(ctx, at);
  if (state?.status === "results") results(ctx, state, now);
  instructions(ctx, state);
  drawTotal += performance.now() - started;
  frameCount++;
  if (at - lastMeasure >= 1000) {
    canvas.dataset.fps = ((frameCount * 1000) / (at - lastMeasure)).toFixed(1);
    canvas.dataset.drawMs = (drawTotal / frameCount).toFixed(2);
    canvas.dataset.knights = String(state?.knights.length ?? 0);
    canvas.dataset.particles = String(fx.particles.length);
    lastMeasure = at;
    frameCount = 0;
    drawTotal = 0;
  }
}
requestAnimationFrame(render);
