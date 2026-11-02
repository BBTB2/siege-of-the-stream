export type ChatRateDecision =
  "allowed" | "user_rate_limit" | "global_rate_limit";

interface Window {
  until: number;
  count: number;
}

/** Ingress protection; the engine independently enforces its 3s action cooldown. */
export function createChatRateLimiter() {
  const users = new Map<string, Window>();
  let global: Window = { until: 0, count: 0 };
  let previousTime = 0;

  function accept(userId: string, nowMs: number): ChatRateDecision {
    if (!Number.isFinite(nowMs)) return "global_rate_limit";
    const now = Math.max(previousTime, nowMs);
    previousTime = now;
    if (now >= global.until) {
      global = { until: now + 1000, count: 0 };
      for (const [id, window] of users)
        if (now >= window.until) users.delete(id);
    }
    // Check the aggregate budget before allocating a new sender entry.
    if (global.count >= 100) return "global_rate_limit";
    const existing = users.get(userId);
    const user =
      existing && now < existing.until
        ? existing
        : { until: now + 1000, count: 0 };
    if (user.count >= 5) return "user_rate_limit";
    users.set(userId, { ...user, count: user.count + 1 });
    global = { ...global, count: global.count + 1 };
    // At most two 100-command windows can have unexpired entries: <=200 users.
    return "allowed";
  }

  return { accept };
}
