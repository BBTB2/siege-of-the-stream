import { fireballSize, isNewRound } from "./overlay-layout.js";
import { rect, text, palette } from "./overlay-kit.js";

/** Presentation-only pools. Bounded independently of chat/event volume. */
export class Feedback {
  particles = [];
  numbers = [];
  fireballs = [];
  shakeUntil = 0;
  shakePower = 0;
  banner = null;
  lastEffect = 0;
  burst(x, y, color, count, now) {
    const room = Math.max(0, 360 - this.particles.length);
    for (let i = 0; i < Math.min(count, room); i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 190;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 55,
        color,
        size: 3 + Math.floor(Math.random() * 3) * 2,
        until: now + 400 + Math.random() * 650,
      });
    }
  }
  number(value, x, y, color, now) {
    this.numbers.push({ value, x, y, color, born: now, until: now + 1200 });
    if (this.numbers.length > 40) this.numbers.shift();
  }
  shake(now, power = 5) {
    this.shakeUntil = now + 230;
    this.shakePower = power;
  }
  receive(state, previous, at) {
    const reset = isNewRound(state, previous);
    if (reset) {
      this.lastEffect = 0;
      this.particles = [];
      this.numbers = [];
      this.fireballs = [];
      this.banner = null;
      this.shakeUntil = 0;
      this.shakePower = 0;
    }
    const damage =
      !reset && previous.status === "playing"
        ? previous.boss.hp - state.boss.hp
        : 0;
    if (damage > 0) {
      this.number(
        `−${damage.toLocaleString()}`,
        1610 + Math.random() * 70,
        780,
        palette.gold,
        at,
      );
      this.burst(1560, 790, palette.gold, 14, at);
      this.shake(at, Math.min(9, 2 + damage / 100));
    }
    let healing = 0;
    for (const effect of state.effects) {
      if (effect.id <= this.lastEffect) continue;
      this.lastEffect = effect.id;
      if (effect.until <= state.now) continue;
      switch (effect.type) {
        case "fireball":
          this.fireballs = [
            ...this.fireballs.slice(-5),
            { born: at, size: fireballSize(effect.bits ?? effect.amount) },
          ];
          break;
        case "raid":
          this.banner = {
            label: `RAID! +${effect.amount} knights`,
            detail: `@${effect.username || "raiders"} joins the siege`,
            until: at + 4200,
            color: "#c4b5ff",
          };
          this.burst(120, 850, "#c4b5ff", 40, at);
          break;
        case "champion":
          this.banner = {
            label: "A CHAMPION ANSWERS",
            detail: `For @${effect.username || "the stream"}!`,
            until: at + 3000,
            color: palette.gold,
          };
          this.burst(650, 820, palette.gold, 35, at);
          break;
        case "heal":
          healing += effect.amount;
          break;
        case "slam":
          this.shake(at, 15);
          this.burst(700, 1000, palette.red, 100, at);
          break;
      }
    }
    if (healing) {
      this.number(
        `+${healing.toLocaleString()} HEAL`,
        725,
        805,
        palette.mint,
        at,
      );
      this.burst(725, 860, palette.mint, Math.min(30, healing), at);
    }
  }
  advance(now, dt) {
    this.particles = this.particles.filter((p) => p.until > now);
    this.numbers = this.numbers.filter((p) => p.until > now);
    this.fireballs = this.fireballs.filter((p) => now - p.born < 1100);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 180 * dt;
    }
  }
  draw(ctx, now) {
    for (const f of this.fireballs) {
      const progress = Math.min(1, (now - f.born) / 850);
      const x = 100 + progress * 1510,
        y = 880 - Math.sin(progress * Math.PI) * 240;
      if (progress < 1) {
        this.burst(x - f.size / 2, y, "#ff8749", 3, now);
        rect(ctx, x - f.size, y - f.size / 2, f.size * 1.7, f.size, "#e34438");
        rect(
          ctx,
          x - f.size * 0.6,
          y - f.size * 0.6,
          f.size,
          f.size,
          "#ffb350",
        );
        rect(
          ctx,
          x - f.size * 0.15,
          y - f.size * 0.35,
          f.size * 0.65,
          f.size * 0.65,
          "#fff3ba",
        );
      } else if (!f.hit) {
        f.hit = true;
        this.burst(x, y, palette.gold, 50, now);
        this.shake(now, 10);
      }
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, (p.until - now) / 250);
      rect(ctx, p.x, p.y, p.size, p.size, p.color);
    }
    ctx.globalAlpha = 1;
    for (const n of this.numbers) {
      ctx.globalAlpha = Math.min(1, (n.until - now) / 300);
      const y = n.y - (now - n.born) * 0.06;
      text(ctx, n.value, n.x + 2, y + 3, 30, palette.ink, "center");
      text(ctx, n.value, n.x, y, 30, n.color, "center");
    }
    ctx.globalAlpha = 1;
  }
}
