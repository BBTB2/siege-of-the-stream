export interface SubscriptionRequest {
  type: string;
  version: string;
  condition: Record<string, string>;
  transport: { method: "websocket"; session_id: string };
}

/** Conditions are built from the resolved channel and validated OAuth user. */
export function subscriptionRequests(
  broadcasterId: string,
  userId: string,
  sessionId: string,
): SubscriptionRequest[] {
  const channel = { broadcaster_user_id: broadcasterId };
  const transport = { method: "websocket" as const, session_id: sessionId };
  return [
    {
      type: "channel.chat.message",
      version: "1",
      condition: { ...channel, user_id: userId },
      transport,
    },
    {
      type: "channel.follow",
      version: "2",
      condition: { ...channel, moderator_user_id: userId },
      transport,
    },
    ...["channel.subscribe", "channel.subscription.gift", "channel.cheer"].map(
      (type) => ({ type, version: "1", condition: { ...channel }, transport }),
    ),
    {
      type: "channel.raid",
      version: "1",
      condition: { to_broadcaster_user_id: broadcasterId },
      transport,
    },
  ];
}
