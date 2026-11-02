/** Reconnects can skip idle/results, so status alone cannot identify a round. */
export function isNewRound(next, previous) {
  return (
    !previous ||
    next.now < previous.now ||
    next.endsAt !== previous.endsAt ||
    next.boss.id !== previous.boss.id ||
    next.demo?.cycle !== previous.demo?.cycle ||
    (next.status === "playing" && previous.status !== "playing")
  );
}

export function shortName(name) {
  const chars = Array.from(name);
  return chars.length > 12 ? chars.slice(0, 11).join("") + "…" : name;
}
export function company(knights, now) {
  const pages = Math.max(1, Math.ceil(knights.length / 24));
  const page = Math.floor(now / 6000) % pages;
  const start = page * 24;
  return {
    page: page + 1,
    pages,
    front: knights.slice(start, start + 24),
    reserve: knights.filter((_, i) => i < start || i >= start + 24),
  };
}
export function position(index) {
  return { x: 110 + (index % 8) * 164, y: 865 + Math.floor(index / 8) * 84 };
}
export function nameplateColor(color) {
  const rgb = [1, 3, 5].map(
    (offset) => parseInt(color.slice(offset, offset + 2), 16) / 255,
  );
  const linear = rgb.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  const luminance =
    0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance < 0.19 ? "#fff3d8" : "#151d2d";
}
export function fireballSize(bits) {
  return Math.min(64, 16 + Math.log2(Math.max(1, bits)) * 3);
}
export function eventLabel(event) {
  const user = `@${shortName(event.username || "Anonymous")}`;
  switch (event.type) {
    case "follow":
      return `${user} followed → SHIELD WALL`;
    case "subscription":
      return `${user} subscribed → CHAMPION`;
    case "gift":
      return `${user} gifted → CHAMPION`;
    case "cheer":
      return `${user} cheered ${event.amount.toLocaleString()} → FIREBALL 🔥`;
    case "raid":
      return `${user} raided → +${event.amount} KNIGHTS`;
    default:
      return "The army is gathering…";
  }
}
