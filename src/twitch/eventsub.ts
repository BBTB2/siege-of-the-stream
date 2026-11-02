import { WebSocket, type RawData } from "ws";

export interface EventSubStatus {
  phase: "connecting" | "connected" | "reconnecting" | "error" | "stopped";
  sessionId?: string;
  message?: string;
}
export interface EventSubOptions {
  url: string;
  mockMode: boolean;
  onWelcome: (sessionId: string) => Promise<void>;
  onNotification: (message: unknown) => void;
  onRevocation: (message: unknown) => void;
  onStatus: (status: EventSubStatus) => void;
  log?: (line: string) => void;
  reconnectBaseMs?: number;
  handshakeTimeoutMs?: number;
}
interface Peer {
  socket: WebSocket;
  transfer: boolean;
  welcomed: boolean;
  keepaliveMs: number;
  timer?: ReturnType<typeof setTimeout>;
  sessionId?: string;
}
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function safeText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 100)
    : "unknown";
}

/** EventSub is a receive-only transport; Helix owns subscription creation. */
export class EventSubConnection {
  private stopped = true;
  private primary?: Peer;
  private candidate?: Peer;
  private readonly peers = new Set<Peer>();
  private readonly seen = new Map<string, number>();
  private retry?: ReturnType<typeof setTimeout>;
  private attempt = 0;

  constructor(private readonly options: EventSubOptions) {
    if (!this.allowedUrl(options.url)) throw new Error("Invalid EventSub URL.");
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.options.onStatus({ phase: "connecting" });
    this.connect(this.options.url, false);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.disconnectAll();
    this.options.onStatus({ phase: "stopped" });
  }

  private allowedUrl(value: string): boolean {
    try {
      const url = new URL(value);
      if (url.username || url.password || url.hash) return false;
      if (this.options.mockMode)
        return (
          url.protocol === "ws:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        );
      return (
        url.protocol === "wss:" &&
        url.hostname === "eventsub.wss.twitch.tv" &&
        (!url.port || url.port === "443")
      );
    } catch {
      return false;
    }
  }

  private connect(url: string, transfer: boolean): void {
    if (this.stopped || this.candidate) return;
    const peer: Peer = {
      socket: new WebSocket(url, {
        maxPayload: 1024 * 1024,
        handshakeTimeout: this.options.handshakeTimeoutMs ?? 10_000,
        followRedirects: false,
      }),
      transfer,
      welcomed: false,
      keepaliveMs: this.primary?.keepaliveMs ?? 10_000,
    };
    this.candidate = peer;
    this.peers.add(peer);
    peer.socket.on("error", () =>
      this.fail(peer, "WebSocket connection failed"),
    );
    peer.socket.on("close", () => this.closed(peer));
    peer.socket.on("message", (raw, binary) => {
      if (binary) {
        this.log("ignored binary frame");
        return;
      }
      void this.message(peer, raw).catch(() =>
        this.fail(peer, "EventSub message handler failed"),
      );
    });
    this.watch(
      peer,
      this.options.handshakeTimeoutMs ?? 10_000,
      "Welcome timed out",
    );
  }

  private watch(peer: Peer, ms: number, reason = "Keepalive timed out"): void {
    clearTimeout(peer.timer);
    // Twitch CLI emits keepalives on the deadline. Allow bounded network/timer
    // scheduling jitter without relaxing the separate welcome deadline.
    const grace =
      reason === "Keepalive timed out"
        ? Math.max(50, Math.min(1000, ms * 0.1))
        : 0;
    peer.timer = setTimeout(() => this.fail(peer, reason), ms + grace);
    peer.timer.unref();
  }

  private async message(peer: Peer, raw: RawData): Promise<void> {
    if (
      this.stopped ||
      !this.peers.has(peer) ||
      (peer !== this.primary && peer !== this.candidate)
    )
      return;
    let value: unknown;
    try {
      value = JSON.parse(raw.toString());
    } catch {
      this.log("ignored malformed JSON");
      return;
    }
    if (
      !record(value) ||
      !record(value.metadata) ||
      !record(value.payload) ||
      typeof value.metadata.message_type !== "string"
    ) {
      this.log("ignored malformed envelope");
      return;
    }
    const { metadata, payload } = value;
    if (metadata.message_type === "session_welcome") {
      await this.welcome(peer, payload);
      return;
    }
    if (!peer.welcomed) {
      this.log("ignored message before welcome");
      return;
    }
    switch (metadata.message_type) {
      case "session_keepalive":
        this.watch(peer, peer.keepaliveMs);
        break;
      case "session_reconnect":
        this.transfer(peer, payload);
        break;
      case "notification":
        this.watch(peer, peer.keepaliveMs);
        if (!this.duplicate(metadata.message_id))
          this.options.onNotification(value);
        break;
      case "revocation":
        this.watch(peer, peer.keepaliveMs);
        if (!this.duplicate(metadata.message_id)) this.revoked(value);
        break;
      default:
        this.log(`ignored message type=${safeText(metadata.message_type)}`);
    }
  }

  private async welcome(peer: Peer, payload: RecordValue): Promise<void> {
    if (peer.welcomed) return;
    const session = payload.session;
    if (
      !record(session) ||
      typeof session.id !== "string" ||
      !session.id ||
      session.id.length > 512
    ) {
      this.fail(peer, "Invalid welcome session");
      return;
    }
    const seconds = session.keepalive_timeout_seconds;
    if (
      typeof seconds === "number" &&
      Number.isFinite(seconds) &&
      seconds > 0 &&
      seconds <= 600
    )
      peer.keepaliveMs = seconds * 1000;
    else if (!peer.transfer) {
      this.fail(peer, "Invalid keepalive deadline");
      return;
    }
    peer.welcomed = true;
    peer.sessionId = session.id;
    this.watch(peer, peer.keepaliveMs);
    try {
      if (!peer.transfer) await this.options.onWelcome(session.id);
    } catch {
      this.fail(peer, "EventSub subscriptions failed");
      return;
    }
    if (
      this.stopped ||
      !this.peers.has(peer) ||
      peer.socket.readyState !== WebSocket.OPEN
    )
      return;
    const old = this.primary;
    this.primary = peer;
    this.candidate = undefined;
    this.attempt = 0;
    this.options.onStatus({ phase: "connected", sessionId: session.id });
    this.log(peer.transfer ? "session transferred" : "session connected");
    if (old && old !== peer) {
      clearTimeout(old.timer);
      old.socket.close(1000, "Session transferred");
    }
  }

  private transfer(peer: Peer, payload: RecordValue): void {
    if (peer !== this.primary || this.candidate) return;
    const session = payload.session;
    const url = record(session) ? session.reconnect_url : undefined;
    if (typeof url !== "string" || !this.allowedUrl(url)) {
      this.log("rejected reconnect URL");
      return;
    }
    this.options.onStatus({
      phase: "reconnecting",
      sessionId: peer.sessionId,
      message: "Transferring EventSub session",
    });
    this.connect(url, true);
  }

  private duplicate(id: unknown): boolean {
    if (typeof id !== "string" || !id || id.length > 512) {
      this.log("ignored event without a valid message ID");
      return true;
    }
    const now = Date.now();
    for (const [key, receivedAt] of this.seen) {
      if (now - receivedAt < 600_000 && this.seen.size < 10_000) break;
      this.seen.delete(key);
    }
    if (this.seen.has(id)) {
      this.log(`duplicate message=${safeText(id)} effect=none`);
      return true;
    }
    this.seen.set(id, now);
    return false;
  }

  private revoked(value: RecordValue): void {
    const payload = value.payload as RecordValue;
    const subscription = record(payload.subscription)
      ? payload.subscription
      : {};
    const message = `Subscription revoked: ${safeText(subscription.type)} (${safeText(subscription.status)})`;
    this.options.onStatus({
      phase: "error",
      sessionId: this.primary?.sessionId,
      message,
    });
    this.log(`${message} effect=none`);
    this.options.onRevocation(value);
  }

  private fail(peer: Peer, message: string): void {
    if (this.stopped || !this.peers.has(peer)) return;
    if (peer !== this.primary && peer !== this.candidate) {
      clearTimeout(peer.timer);
      this.peers.delete(peer);
      peer.socket.terminate();
      return;
    }
    this.log(message);
    this.options.onStatus({ phase: "error", message });
    this.disconnectAll();
    this.scheduleRetry();
  }

  private closed(peer: Peer): void {
    clearTimeout(peer.timer);
    if (!this.peers.delete(peer) || this.stopped) return;
    const primary = peer === this.primary;
    const candidate = peer === this.candidate;
    if (primary) this.primary = undefined;
    if (candidate) this.candidate = undefined;
    if (primary && this.candidate) return;
    if (primary || candidate) {
      this.disconnectAll();
      this.scheduleRetry();
    }
  }

  private disconnectAll(): void {
    const peers = [...this.peers];
    this.peers.clear();
    this.primary = undefined;
    this.candidate = undefined;
    for (const peer of peers) {
      clearTimeout(peer.timer);
      peer.socket.terminate();
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retry) return;
    const delay = Math.min(
      30_000,
      (this.options.reconnectBaseMs ?? 1000) *
        2 ** Math.min(this.attempt++, 10),
    );
    this.options.onStatus({
      phase: "reconnecting",
      message: `Retrying in ${delay}ms`,
    });
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connect(this.options.url, false);
    }, delay);
    this.retry.unref();
  }

  private log(message: string): void {
    this.options.log?.(`[twitch] ${message}`);
  }
}
