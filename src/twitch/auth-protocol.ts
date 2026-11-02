export const TWITCH_SCOPES = [
  "user:read:chat",
  "moderator:read:followers",
  "channel:read:subscriptions",
  "bits:read",
] as const;

export class AuthFailure extends Error {
  constructor(
    public readonly kind:
      "invalid" | "transient" | "denied" | "expired" | "pending" | "slow",
    message: string,
  ) {
    super(message);
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthFailure("transient", "Twitch returned an invalid response.");
  return value as Record<string, unknown>;
}
export function requiredText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 8192 ||
    /[\x00-\x1f]/.test(value)
  )
    throw new AuthFailure("transient", "Twitch returned an invalid response.");
  return value;
}
export function seconds(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 31_536_000
  )
    throw new AuthFailure("transient", "Twitch returned an invalid expiry.");
  return value;
}

/** Only known protocol errors are exposed; remote bodies can contain credentials. */
export async function oauthRequest(
  fetcher: typeof fetch,
  endpoint: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(`https://id.twitch.tv/oauth2/${endpoint}`, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: "error",
    });
  } catch {
    signal.throwIfAborted();
    throw new AuthFailure(
      "transient",
      "Cannot reach Twitch authentication. Retry shortly.",
    );
  }
  signal.throwIfAborted();
  let data: Record<string, unknown>;
  try {
    data = record(await response.json());
  } catch {
    throw new AuthFailure(
      "transient",
      "Twitch returned an invalid authentication response.",
    );
  }
  signal.throwIfAborted();
  if (response.ok) return data;
  const code = typeof data.message === "string" ? data.message : data.error;
  if (code === "authorization_pending")
    throw new AuthFailure("pending", "Waiting for Twitch authorization.");
  if (code === "slow_down")
    throw new AuthFailure("slow", "Waiting before polling Twitch again.");
  if (code === "access_denied")
    throw new AuthFailure(
      "denied",
      "Twitch authorization was denied. Start authorization again.",
    );
  if (code === "expired_token" || code === "invalid device code")
    throw new AuthFailure(
      "expired",
      "Twitch device code expired. Start authorization again.",
    );
  if (response.status === 401 || code === "Invalid refresh token")
    throw new AuthFailure(
      "invalid",
      "Twitch authorization expired or was revoked. Authorize again.",
    );
  throw new AuthFailure(
    response.status >= 500 || response.status === 429 ? "transient" : "denied",
    `Twitch authentication failed (HTTP ${response.status}). Check the public client configuration and retry.`,
  );
}

export function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
