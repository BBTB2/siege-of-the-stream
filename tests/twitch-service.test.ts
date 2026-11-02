import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventSubOptions } from "../src/twitch/eventsub.js";
const transport = vi.hoisted(() => ({
  options: undefined as EventSubOptions | undefined,
}));
vi.mock("../src/twitch/eventsub.js", () => ({
  EventSubConnection: class {
    constructor(options: EventSubOptions) {
      transport.options = options;
    }
    start() {
      transport.options!.onStatus({ phase: "connecting" });
    }
    stop() {}
  },
}));
import { TwitchService } from "../src/twitch/service.js";
const active: TwitchService[] = [];
function start(
  request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("{}", { status: 202 })),
) {
  vi.stubGlobal("fetch", request);
  const service = new TwitchService({
    mockMode: true,
    dispatch: () => "applied",
  });
  active.push(service);
  service.start();
  return { service, socket: transport.options!, request };
}
afterEach(() => {
  active.splice(0).forEach((s) => s.stop());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Twitch service lifecycle", () => {
  it("recovers public status after a transient socket error", async () => {
    const { service, socket } = start();
    socket.onStatus({ phase: "error", message: "temporary" });
    socket.onStatus({ phase: "reconnecting" });
    await socket.onWelcome("new-session");
    socket.onStatus({ phase: "connected", sessionId: "new-session" });
    expect(service.getStatus().phase).toBe("connected");
  });
  it("does not let late old-session subscription failures overwrite a newer session", async () => {
    const pending: ((r: Response) => void)[] = [];
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        if (JSON.parse(String(init?.body)).transport.session_id === "old")
          return new Promise<Response>((resolve) => pending.push(resolve));
        return new Response("{}", { status: 202 });
      });
    const { service, socket } = start(request);
    const old = socket.onWelcome("old").catch(() => undefined);
    await socket.onWelcome("new");
    socket.onStatus({ phase: "connected", sessionId: "new" });
    pending.forEach((resolve) => resolve(new Response("{}", { status: 403 })));
    await old;
    expect(service.getStatus().sessionId).toBe("new");
    expect(
      service.getStatus().subscriptions.every((s) => s.status === "enabled"),
    ).toBe(true);
  });
  it("retries failed subscriptions on the transferred session and continues after another failure", async () => {
    vi.useFakeTimers();
    let fail = true;
    const request = vi.fn<typeof fetch>().mockImplementation(
      async (_url, init) =>
        new Response("{}", {
          status:
            JSON.parse(String(init?.body)).type === "channel.cheer" && fail
              ? 403
              : 202,
        }),
    );
    const { service, socket } = start(request);
    await socket.onWelcome("old");
    socket.onStatus({ phase: "connected", sessionId: "old" });
    socket.onStatus({ phase: "reconnecting", sessionId: "old" });
    socket.onStatus({ phase: "connected", sessionId: "transferred" });
    await vi.advanceTimersByTimeAsync(30_000);
    fail = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.getStatus().phase).toBe("connected");
    expect(
      request.mock.calls.some(
        ([, init]) =>
          JSON.parse(String(init?.body)).transport.session_id === "transferred",
      ),
    ).toBe(true);
    expect(
      service.getStatus().subscriptions.every((s) => s.status === "enabled"),
    ).toBe(true);
  });
  it("stops pending subscription writes after authorization revocation", async () => {
    const releases: ((r: Response) => void)[] = [];
    const { service, socket } = start(
      vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise((resolve) => {
            releases.push(resolve);
          }),
      ),
    );
    const pending = socket.onWelcome("old");
    socket.onRevocation({
      payload: {
        subscription: {
          type: "channel.cheer",
          status: "authorization_revoked",
        },
      },
    });
    releases.forEach((release) => release(new Response("{}", { status: 202 })));
    await pending;
    expect(service.getStatus()).toMatchObject({ phase: "error" });
    expect(service.getStatus().auth).toBeUndefined();
  });
});
