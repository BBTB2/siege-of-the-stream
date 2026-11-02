import { TwitchAuth, type AuthStatus } from "./auth.js";
import { EventSubConnection } from "./eventsub.js";
import { HelixClient } from "./helix.js";
import { mapNotification, type GameInput } from "./mapping.js";
import { subscriptionRequests } from "./subscriptions.js";

export interface TwitchConfig {
  clientId?: string;
  broadcasterLogin?: string;
  mockBroadcasterId?: string;
}
export interface TwitchStatus {
  mode: "mock" | "live";
  phase:
    | "idle"
    | "authorizing"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "degraded"
    | "error"
    | "stopped";
  broadcasterId?: string;
  sessionId?: string;
  auth?: AuthStatus;
  message?: string;
  subscriptions: {
    type: string;
    status: "enabled" | "failed" | "revoked";
    message?: string;
  }[];
}
interface Options extends TwitchConfig {
  mockMode: boolean;
  dispatch: (input: GameInput) => string;
  log?: (line: string) => void;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Owns auth and the incoming Twitch connection; game state remains in app.ts. */
export class TwitchService {
  private status: TwitchStatus;
  private auth?: TwitchAuth;
  private connection?: EventSubConnection;
  private controller = new AbortController();
  private generation = 0;
  private subscriptionEpoch = 0;
  private starting = false;
  private retry?: ReturnType<typeof setTimeout>;
  private readonly seen = new Map<string, number>();
  constructor(private readonly options: Options) {
    this.status = {
      mode: options.mockMode ? "mock" : "live",
      phase: "idle",
      subscriptions: [],
    };
  }
  getStatus(): TwitchStatus {
    return structuredClone(this.status);
  }
  private log(fields: Record<string, unknown>) {
    this.options.log?.(JSON.stringify(fields));
  }
  private patch(change: Partial<TwitchStatus>) {
    this.status = { ...this.status, ...change };
  }

  start(): void {
    if (
      this.starting ||
      ["connected", "connecting", "reconnecting"].includes(this.status.phase)
    )
      return;
    this.stop();
    this.starting = true;
    this.controller = new AbortController();
    const generation = this.generation;
    this.status = {
      mode: this.options.mockMode ? "mock" : "live",
      phase: "connecting",
      subscriptions: [],
    };
    void this.connect(generation)
      .catch(() => {
        if (generation !== this.generation) return;
        this.patch({
          phase: "error",
          message:
            this.auth?.getStatus().message ??
            "Cannot connect to Twitch. Check your connection and retry.",
        });
        this.log({ twitch: "connection", effect: "error" });
      })
      .finally(() => {
        if (generation === this.generation) this.starting = false;
      });
  }

  private async connect(generation: number) {
    const { mockMode, clientId = "", broadcasterLogin = "" } = this.options;
    if (!mockMode && (!clientId || !broadcasterLogin)) {
      this.patch({
        phase: "error",
        message: "Set TWITCH_CLIENT_ID and TWITCH_BROADCASTER_LOGIN in .env.",
      });
      return;
    }
    if (!mockMode) {
      this.auth = new TwitchAuth({
        clientId,
        broadcasterLogin,
        log: (line) => this.options.log?.(line),
        onStatus: (auth) => {
          if (generation !== this.generation) return;
          this.patch({ auth });
          if (auth.phase === "authorizing")
            this.patch({ phase: "authorizing" });
          if (auth.phase === "error") {
            this.stop();
            this.patch({ phase: "error", auth, message: auth.message });
          }
        },
      });
      await this.auth.start();
    }
    const helix = new HelixClient({
      clientId,
      mockMode,
      getAccessToken: (force) => this.auth!.getAccessToken(force),
      signal: this.controller.signal,
    });
    const broadcasterId = mockMode
      ? (this.options.mockBroadcasterId ?? "1234")
      : await helix.resolveBroadcaster(broadcasterLogin);
    if (!/^\d+$/.test(broadcasterId))
      throw new Error("Invalid mock broadcaster ID.");
    if (generation !== this.generation) return;
    if (!mockMode && broadcasterId !== this.auth?.getStatus().userId) {
      this.patch({
        phase: "error",
        message: "Authorize as the configured broadcaster, then retry.",
      });
      this.auth?.stop();
      return;
    }
    this.patch({ broadcasterId, phase: "connecting", message: undefined });
    this.connection = new EventSubConnection({
      url: mockMode
        ? "ws://127.0.0.1:8080/ws"
        : "wss://eventsub.wss.twitch.tv/ws",
      mockMode,
      onWelcome: (sessionId) =>
        this.subscribe(helix, broadcasterId, sessionId, generation),
      onNotification: (message) => {
        if (generation === this.generation) this.handleNotification(message);
      },
      onRevocation: (message) => this.revoke(message),
      onStatus: (status) => {
        if (generation !== this.generation) return;
        this.subscriptionEpoch++;
        clearTimeout(this.retry);
        const degraded = this.status.subscriptions.some(
          (s) => s.status !== "enabled",
        );
        this.patch({
          ...status,
          sessionId: status.sessionId,
          phase:
            status.phase === "connected" && degraded
              ? "degraded"
              : status.phase,
        });
        if (
          status.phase === "connected" &&
          status.sessionId &&
          this.status.subscriptions.some((s) => s.status === "failed")
        )
          this.scheduleRetry(
            helix,
            broadcasterId,
            status.sessionId,
            generation,
          );
        this.log({ twitch: "connection", effect: this.status.phase });
      },
      log: (line) => this.options.log?.(line),
    });
    this.connection.start();
  }

  private async subscribe(
    helix: HelixClient,
    broadcasterId: string,
    sessionId: string,
    generation: number,
    fresh = true,
  ) {
    clearTimeout(this.retry);
    const epoch = ++this.subscriptionEpoch;
    if (fresh) this.patch({ sessionId, subscriptions: [] });
    const existing = this.status.subscriptions;
    const requests = subscriptionRequests(
      broadcasterId,
      broadcasterId,
      sessionId,
    ).filter(
      (request) =>
        fresh ||
        existing.some((s) => s.type === request.type && s.status === "failed"),
    );
    const statuses = await Promise.all(
      requests.map(async (request) => {
        try {
          await helix.subscribe(request);
          this.log({ twitch: request.type, effect: "subscribed" });
          return { type: request.type, status: "enabled" as const };
        } catch (error) {
          const message =
            error instanceof Error &&
            error.message.startsWith("Subscription failed")
              ? error.message
              : "Subscription request failed. Will retry.";
          this.log({
            twitch: request.type,
            effect: "subscription_failed",
            message,
          });
          return { type: request.type, status: "failed" as const, message };
        }
      }),
    );
    if (
      generation !== this.generation ||
      epoch !== this.subscriptionEpoch ||
      sessionId !== this.status.sessionId
    )
      return;
    const combined = [
      ...existing.filter((s) => !statuses.some((next) => next.type === s.type)),
      ...statuses,
    ];
    this.patch({ subscriptions: combined });
    if (fresh && statuses.every((s) => s.status === "failed"))
      throw new Error("All Twitch subscriptions failed.");
    if (combined.some((s) => s.status === "failed")) {
      this.patch({
        phase: "degraded",
        message:
          "Some events are unavailable. Check subscription status below.",
      });
      this.scheduleRetry(helix, broadcasterId, sessionId, generation);
    } else if (!fresh)
      this.patch({
        phase: combined.some((s) => s.status === "revoked")
          ? "degraded"
          : "connected",
        message: undefined,
      });
  }

  private scheduleRetry(
    helix: HelixClient,
    broadcasterId: string,
    sessionId: string,
    generation: number,
  ) {
    clearTimeout(this.retry);
    const epoch = this.subscriptionEpoch;
    this.retry = setTimeout(() => {
      if (
        generation !== this.generation ||
        epoch !== this.subscriptionEpoch ||
        sessionId !== this.status.sessionId
      )
        return;
      void this.subscribe(
        helix,
        broadcasterId,
        sessionId,
        generation,
        false,
      ).catch(() => {
        if (
          generation !== this.generation ||
          sessionId !== this.status.sessionId
        )
          return;
        this.patch({
          phase: "degraded",
          message: "Subscription retry failed.",
        });
        this.scheduleRetry(helix, broadcasterId, sessionId, generation);
      });
    }, 30_000);
    this.retry.unref();
  }

  handleNotification(message: unknown): void {
    const envelope = record(message),
      metadata = record(envelope.metadata);
    const type =
      typeof metadata.subscription_type === "string"
        ? metadata.subscription_type
        : "unknown";
    const id =
      typeof metadata.message_id === "string" ? metadata.message_id : "";
    if (metadata.message_type !== "notification" || !id || id.length > 200) {
      this.log({ twitch: type, effect: "ignored_invalid_envelope" });
      return;
    }
    const now = Date.now();
    for (const [key, seenAt] of this.seen)
      if (now - seenAt > 600_000) this.seen.delete(key);
    if (this.seen.has(id)) {
      this.log({ twitch: type, id, effect: "ignored_duplicate" });
      return;
    }
    this.seen.set(id, now);
    if (this.seen.size > 10_000)
      this.seen.delete(this.seen.keys().next().value!);
    const inputs = mapNotification(
      message,
      this.status.broadcasterId ?? this.options.mockBroadcasterId ?? "1234",
    );
    if (!inputs.length)
      this.log({
        twitch: type,
        id,
        effect: "ignored_unmapped_or_other_channel",
      });
    for (const input of inputs)
      this.log({ twitch: type, id, effect: this.options.dispatch(input) });
  }

  private revoke(message: unknown) {
    this.subscriptionEpoch++;
    clearTimeout(this.retry);
    const subscription = record(record(record(message).payload).subscription);
    const type = String(subscription.type ?? "unknown");
    const reason = String(subscription.status ?? "revoked");
    this.patch({
      phase: "degraded",
      message: `Subscription revoked: ${type} (${reason}).`,
      subscriptions: this.status.subscriptions.map((s) =>
        s.type === type ? { ...s, status: "revoked", message: reason } : s,
      ),
    });
    this.log({ twitch: type, effect: "revoked", reason });
    if (reason === "authorization_revoked" || reason === "user_removed") {
      this.stop();
      this.patch({
        phase: "error",
        message:
          "Twitch authorization was revoked. Reconnect and authorize again.",
      });
    }
  }

  stop(): void {
    this.generation++;
    this.subscriptionEpoch++;
    this.starting = false;
    clearTimeout(this.retry);
    this.controller.abort();
    this.connection?.stop();
    this.auth?.stop();
    this.patch({ phase: "stopped", auth: undefined, sessionId: undefined });
  }
}
