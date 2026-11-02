interface HelixOptions {
  clientId: string;
  mockMode: boolean;
  getAccessToken: (forceRefresh?: boolean) => Promise<string>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export class HelixClient {
  constructor(private readonly options: HelixOptions) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    const { mockMode, clientId, getAccessToken } = this.options;
    const base = mockMode
      ? "http://127.0.0.1:8080"
      : "https://api.twitch.tv/helix";
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = new Headers(init.headers);
      headers.set("Content-Type", "application/json");
      if (mockMode) headers.set("Client-Id", "siege-mock");
      if (!mockMode) {
        headers.set("Client-Id", clientId);
        headers.set(
          "Authorization",
          `Bearer ${await getAccessToken(attempt > 0)}`,
        );
      }
      const timeout = AbortSignal.timeout(8000);
      const signal = this.options.signal
        ? AbortSignal.any([timeout, this.options.signal])
        : timeout;
      const response = await (this.options.fetch ?? fetch)(`${base}${path}`, {
        ...init,
        headers,
        signal,
        redirect: "error",
      });
      if (response.status !== 401 || mockMode || attempt === 1) return response;
      await response.body?.cancel();
    }
    throw new Error("Twitch authorization failed.");
  }

  async resolveBroadcaster(login: string): Promise<string> {
    const normalized = login.trim().toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(normalized))
      throw new Error("Invalid broadcaster login.");
    const response = await this.request(
      `/users?login=${encodeURIComponent(normalized)}`,
      { method: "GET" },
    );
    if (!response.ok)
      throw new Error(`Cannot resolve broadcaster (HTTP ${response.status}).`);
    const body = (await response.json()) as {
      data?: { id?: unknown; login?: unknown }[];
    };
    const user = Array.isArray(body?.data) ? body.data[0] : undefined;
    if (
      !user ||
      typeof user.id !== "string" ||
      !/^\d+$/.test(user.id) ||
      user.login !== normalized
    )
      throw new Error("Configured broadcaster was not found.");
    return user.id;
  }

  async subscribe(subscription: object): Promise<void> {
    const response = await this.request("/eventsub/subscriptions", {
      method: "POST",
      body: JSON.stringify(subscription),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 409) {
      if (
        this.options.mockMode &&
        response.status === 400 &&
        "type" in subscription &&
        subscription.type === "channel.chat.message"
      )
        throw new Error(
          "Subscription failed (HTTP 400). This Twitch CLI version cannot mock chat; use npm run mock:chat.",
        );
      const hint =
        response.status === 403
          ? " Check broadcaster permissions and scopes."
          : response.status === 429
            ? " Twitch rate limit reached."
            : "";
      throw new Error(`Subscription failed (HTTP ${response.status}).${hint}`);
    }
  }
}
