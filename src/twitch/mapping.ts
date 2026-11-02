import {
  chatColor,
  type ChatCommand,
  type TwitchEvent,
} from "../game/index.js";

export type GameInput =
  | {
      kind: "command";
      userId: string;
      username: string;
      action: ChatCommand;
      color?: string;
    }
  | { kind: "event"; event: TwitchEvent };

const versions: Record<string, string> = {
  "channel.chat.message": "1",
  "channel.follow": "2",
  "channel.subscribe": "1",
  "channel.subscription.gift": "1",
  "channel.cheer": "1",
  "channel.raid": "1",
};
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function identity(value: unknown, max = 64): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
function integer(value: unknown, min: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= min
  );
}

/** A message must contain one command only; no arguments or combined actions. */
export function parseCommand(text: unknown): ChatCommand | null {
  if (typeof text !== "string") return null;
  const normalized = text.trim().toLowerCase();
  return ["!join", "!attack", "!defend", "!heal"].includes(normalized)
    ? (normalized as ChatCommand)
    : null;
}

function chat(
  event: Record<string, unknown>,
  broadcasterId: string,
): GameInput[] {
  const source = event.source_broadcaster_user_id;
  if (source != null && source !== broadcasterId) return [];
  const action = parseCommand(record(event.message)?.text);
  if (
    !action ||
    !identity(event.chatter_user_id) ||
    !identity(event.chatter_user_name, 25)
  )
    return [];
  return [
    {
      kind: "command",
      userId: event.chatter_user_id,
      username: event.chatter_user_name,
      action,
      ...(chatColor(event.color) ? { color: chatColor(event.color) } : {}),
    },
  ];
}
function gameEvent(
  type: string,
  event: Record<string, unknown>,
): TwitchEvent | null {
  switch (type) {
    case "channel.follow":
      return {
        type: "follow",
        ...(identity(event.user_name, 25) ? { username: event.user_name } : {}),
      };
    case "channel.subscribe":
      return event.is_gift === false && identity(event.user_name, 25)
        ? { type: "subscription", username: event.user_name }
        : null;
    case "channel.subscription.gift": {
      if (typeof event.is_anonymous !== "boolean" || !integer(event.total, 1))
        return null;
      const username = event.is_anonymous ? "Anonymous" : event.user_name;
      return identity(username, 25) ? { type: "gift", username } : null;
    }
    case "channel.cheer": {
      if (typeof event.is_anonymous !== "boolean" || !integer(event.bits, 1))
        return null;
      if (event.is_anonymous) return { type: "cheer", bits: event.bits };
      return identity(event.user_id)
        ? {
            type: "cheer",
            bits: event.bits,
            userId: event.user_id,
            ...(identity(event.user_name, 25)
              ? { username: event.user_name }
              : {}),
          }
        : null;
    }
    case "channel.raid":
      return integer(event.viewers, 0) &&
        identity(event.from_broadcaster_user_name, 25)
        ? {
            type: "raid",
            viewers: event.viewers,
            username: event.from_broadcaster_user_name,
          }
        : null;
    default:
      return null;
  }
}

/** Validate the notification boundary before turning external payloads into game inputs. */
export function mapNotification(
  message: unknown,
  broadcasterId: string,
): GameInput[] {
  const envelope = record(message);
  const metadata = record(envelope?.metadata);
  const payload = record(envelope?.payload);
  const subscription = record(payload?.subscription);
  const event = record(payload?.event);
  const type = metadata?.subscription_type;
  if (
    !metadata ||
    !subscription ||
    !event ||
    metadata.message_type !== "notification" ||
    typeof type !== "string"
  )
    return [];
  if (
    !Object.hasOwn(versions, type) ||
    subscription.type !== type ||
    metadata.subscription_version !== versions[type] ||
    subscription.version !== versions[type]
  )
    return [];
  const channel =
    type === "channel.raid"
      ? event.to_broadcaster_user_id
      : event.broadcaster_user_id;
  if (!identity(broadcasterId) || channel !== broadcasterId) return [];
  if (type === "channel.chat.message") return chat(event, broadcasterId);
  const mapped = gameEvent(type, event);
  return mapped ? [{ kind: "event", event: mapped }] : [];
}
