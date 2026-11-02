import {
  BOSSES,
  type BossId,
  type ChatCommand,
  type TwitchEvent,
} from "./game/index.js";

export class InputError extends Error {}
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Expected a JSON object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 64): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw new InputError(`Invalid ${label}.`);
  return value.trim();
}
function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new InputError(`Invalid ${label}.`);
  return value;
}
export function roundOptions(body: unknown): {
  boss: BossId;
  durationMs: number;
} {
  const data = object(body);
  if (typeof data.boss !== "string" || !Object.hasOwn(BOSSES, data.boss))
    throw new InputError("Choose a known boss.");
  return {
    boss: data.boss as BossId,
    durationMs: integer(data.durationMs, "round length", 1000, 3_600_000),
  };
}
export function chatInput(body: unknown) {
  const data = object(body);
  if (
    typeof data.action !== "string" ||
    !["!join", "!attack", "!defend", "!heal"].includes(data.action)
  )
    throw new InputError("Unknown chat command.");
  return {
    userId: text(data.userId, "user ID"),
    username: text(data.username, "username", 25),
    action: data.action as ChatCommand,
  };
}
export function eventInput(body: unknown): TwitchEvent {
  const data = object(body);
  switch (data.type) {
    case "follow":
      return { type: "follow" };
    case "subscription":
    case "gift":
      return { type: data.type, username: text(data.username, "username", 25) };
    case "raid":
      return {
        type: "raid",
        username: text(data.username, "username", 25),
        viewers: integer(data.viewers, "raid size", 0, Number.MAX_SAFE_INTEGER),
      };
    case "cheer":
      return {
        type: "cheer",
        bits: integer(data.bits, "bits", 1, Number.MAX_SAFE_INTEGER),
        ...(data.userId === undefined
          ? {}
          : { userId: text(data.userId, "user ID") }),
      };
    default:
      throw new InputError("Unknown Twitch event.");
  }
}
