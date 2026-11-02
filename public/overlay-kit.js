export const palette = {
  ink: "#101521",
  panel: "rgba(13, 18, 30, .94)",
  white: "#fff3d8",
  muted: "#b5bac9",
  gold: "#ffd073",
  mint: "#8ce8ba",
  red: "#ff6b67",
  blue: "#85d9ff",
};
export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
export function text(
  ctx,
  value,
  x,
  y,
  size = 24,
  color = palette.white,
  align = "left",
  maxWidth = 10000,
) {
  ctx.font = `bold ${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(String(value), x, y, maxWidth);
}
export function panel(ctx, x, y, w, h, color = palette.gold) {
  rect(ctx, x, y, w, h, palette.ink);
  rect(ctx, x + 2, y + 2, w - 4, h - 4, palette.panel);
  rect(ctx, x, y, 4, h, color);
}
export function bar(ctx, x, y, w, h, ratio, color) {
  rect(ctx, x, y, w, h, "#101521");
  rect(
    ctx,
    x + 3,
    y + 3,
    (w - 6) * Math.max(0, Math.min(1, ratio)),
    h - 6,
    color,
  );
}
export function clock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
