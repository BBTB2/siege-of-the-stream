import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TwitchAuth,
  TWITCH_SCOPES,
  type AuthStatus,
} from "../src/twitch/auth.js";

let directory: string;
const clients: TwitchAuth[] = [];
const scopes = [
  "user:read:chat",
  "moderator:read:followers",
  "channel:read:subscriptions",
  "bits:read",
];
const token = (suffix = "1", expires = 14400) => ({
  access_token: `access-${suffix}`,
  refresh_token: `refresh-${suffix}`,
  scope: scopes,
  expires_in: expires,
  token_type: "bearer",
});
const validation = (extra = {}) => ({
  client_id: "client",
  user_id: "123",
  login: "broadcaster",
  scopes,
  expires_in: 14400,
  ...extra,
});
const device = (extra = {}) => ({
  device_code: "private-device",
  user_code: "ABCD1234",
  verification_uri: "https://www.twitch.tv/activate?device-code=ABCD1234",
  interval: 1,
  expires_in: 1800,
  ...extra,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (predicate()) return;
    await setImmediate();
  }
  throw new Error("Expected authentication state did not arrive.");
}
function setup(responses: Response[]) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const statuses: AuthStatus[] = [];
  const logs: string[] = [];
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request");
      return response;
    },
  ) as unknown as typeof fetch;
  const auth = new TwitchAuth({
    clientId: "client",
    broadcasterLogin: "broadcaster",
    tokenPath: join(directory, ".tokens.json"),
    fetch: fetcher,
    onStatus: (status) => statuses.push(status),
    log: (line) => logs.push(line),
  });
  clients.push(auth);
  return { auth, requests, statuses, logs };
}
async function saved(expiresAt = Date.now() + 14_400_000) {
  await writeFile(
    join(directory, ".tokens.json"),
    JSON.stringify({
      clientId: "client",
      accessToken: "saved-access",
      refreshToken: "saved-refresh",
      expiresAt,
      scopes,
    }),
    { mode: 0o600 },
  );
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "siege-auth-"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(async () => {
  clients.splice(0).forEach((client) => client.stop());
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

describe("Twitch public-client authentication", () => {
  it("publishes device instructions, waits through pending, validates identity and saves private tokens", async () => {
    const { auth, requests, statuses, logs } = setup([
      json(device()),
      json({ message: "authorization_pending" }, 400),
      json(token()),
      json(validation()),
    ]);
    const started = auth.start();
    await waitFor(() => auth.getStatus().phase === "authorizing");
    expect(auth.getStatus()).toMatchObject({
      phase: "authorizing",
      userCode: "ABCD1234",
    });
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    expect(auth.getStatus()).toEqual({
      phase: "ready",
      userId: "123",
      login: "broadcaster",
    });
    expect(await auth.getAccessToken()).toBe("access-1");
    const savedData = JSON.parse(
      await readFile(join(directory, ".tokens.json"), "utf8"),
    );
    expect(savedData).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
    expect((await stat(join(directory, ".tokens.json"))).mode & 0o777).toBe(
      0o600,
    );
    expect(
      new URLSearchParams(requests[0]!.init!.body as string).get("scopes"),
    ).toBe(scopes.join(" "));
    const poll = new URLSearchParams(requests[1]!.init!.body as string);
    expect(poll.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
    expect(poll.get("scopes")).toBe(scopes.join(" "));
    expect(poll.has("client_secret")).toBe(false);
    expect(logs.join(" ")).toContain("ABCD1234");
    expect(JSON.stringify({ statuses, logs })).not.toMatch(
      /access-1|refresh-1|private-device/,
    );
    expect(TWITCH_SCOPES).toEqual(scopes);
  });

  it("slows polling by five seconds after slow_down", async () => {
    const { auth, requests } = setup([
      json(device()),
      json({ error: "slow_down" }, 400),
      json(token()),
      json(validation()),
    ]);
    const started = auth.start();
    await waitFor(() => auth.getStatus().phase === "authorizing");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5999);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await started;
    expect(auth.getStatus().phase).toBe("ready");
  });

  it.each(["access_denied", "expired_token", "invalid device code"])(
    "stops polling safely for %s",
    async (reason) => {
      const { auth, requests } = setup([
        json(device()),
        json({ message: reason }, 400),
      ]);
      const result = auth.start().catch((error) => error as Error);
      await waitFor(() => auth.getStatus().phase === "authorizing");
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toBeInstanceOf(Error);
      expect(auth.getStatus().phase).toBe("error");
      await vi.advanceTimersByTimeAsync(60000);
      expect(requests).toHaveLength(2);
    },
  );

  it("respects device expiry before a further token request", async () => {
    const { auth, requests } = setup([
      json(device({ expires_in: 1, interval: 2 })),
    ]);
    const result = auth.start().catch((error) => error as Error);
    await waitFor(() => auth.getStatus().phase === "authorizing");
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBeInstanceOf(Error);
    expect(auth.getStatus().message).toMatch(/expired/i);
    expect(requests).toHaveLength(1);
  });

  it("validates saved tokens on startup and hourly without another device flow", async () => {
    await saved();
    const { auth, requests } = setup([json(validation()), json(validation())]);
    await auth.start();
    expect(await auth.getAccessToken()).toBe("saved-access");
    expect(requests[0]?.url).toBe("https://id.twitch.tv/oauth2/validate");
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.url.endsWith("/validate"))).toBe(
      true,
    );
  });

  it("refreshes concurrently once without client secret and persists the rotated refresh token", async () => {
    await saved();
    const { auth, requests } = setup([
      json(validation()),
      json(token("2")),
      json(validation()),
    ]);
    await auth.start();
    expect(
      await Promise.all([
        auth.getAccessToken(true),
        auth.getAccessToken(true),
        auth.getAccessToken(true),
      ]),
    ).toEqual(["access-2", "access-2", "access-2"]);
    const refresh = requests.filter((request) =>
      request.url.endsWith("/token"),
    );
    expect(refresh).toHaveLength(1);
    const body = new URLSearchParams(refresh[0]!.init!.body as string);
    expect(body.get("refresh_token")).toBe("saved-refresh");
    expect(body.has("client_secret")).toBe(false);
    expect(
      JSON.parse(await readFile(join(directory, ".tokens.json"), "utf8"))
        .refreshToken,
    ).toBe("refresh-2");
  });

  it("refreshes a saved access token rejected by validation", async () => {
    await saved();
    const { auth } = setup([
      json({ message: "invalid access token" }, 401),
      json(token("2")),
      json(validation()),
    ]);
    await auth.start();
    expect(await auth.getAccessToken()).toBe("access-2");
  });

  it("refreshes automatically before expiration", async () => {
    await saved();
    const { auth } = setup([
      json(validation({ expires_in: 120 })),
      json(token("2")),
      json(validation()),
    ]);
    await auth.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await auth.getAccessToken()).toBe("access-2");
  });

  it.each([
    { login: "wrong-user" },
    { client_id: "wrong-client" },
    { scopes: ["user:read:chat"] },
  ])(
    "rejects saved authorization with invalid identity or scopes %j",
    async (extra) => {
      await saved();
      const { auth } = setup([json(validation(extra))]);
      await expect(auth.start()).rejects.toThrow();
      expect(auth.getStatus().phase).toBe("error");
      await expect(auth.getAccessToken()).rejects.toThrow();
    },
  );

  it("starts a fresh device flow when the refresh token is no longer valid", async () => {
    await saved();
    const { auth } = setup([
      json({}, 401),
      json({ message: "Invalid refresh token" }, 400),
      json(device()),
      json(token("3")),
      json(validation()),
    ]);
    const started = auth.start();
    await waitFor(() => auth.getStatus().phase === "authorizing");
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    expect(await auth.getAccessToken()).toBe("access-3");
  });

  it("aborts polling and clears public status when stopped", async () => {
    const { auth, requests } = setup([json(device())]);
    const result = auth.start().catch((error) => error as Error);
    await waitFor(() => auth.getStatus().phase === "authorizing");
    auth.stop();
    expect(await result).toBeInstanceOf(Error);
    expect(auth.getStatus()).toEqual({ phase: "idle" });
    await vi.advanceTimersByTimeAsync(60000);
    expect(requests).toHaveLength(1);
  });

  it("returns safe errors without leaking remote response bodies", async () => {
    const { auth } = setup([
      json({ message: "access_token=do-not-expose-this" }, 500),
    ]);
    await expect(auth.start()).rejects.toThrow();
    expect(JSON.stringify(auth.getStatus())).not.toContain(
      "do-not-expose-this",
    );
  });

  it("does not restore a ready session if stop happens while reading validation JSON", async () => {
    await saved();
    let release!: (value: unknown) => void;
    const response = json(validation());
    response.json = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const { auth } = setup([response]);
    const started = auth.start().catch((error) => error as Error);
    await waitFor(() => typeof release === "function");
    auth.stop();
    release(validation());
    expect(await started).toBeInstanceOf(Error);
    expect(auth.getStatus()).toEqual({ phase: "idle" });
  });

  it("allows a fresh authorization after the cached account was rejected", async () => {
    await saved();
    const { auth, requests } = setup([
      json(validation({ login: "someone-else" })),
      json(device()),
      json(token("new")),
      json(validation()),
    ]);
    await expect(auth.start()).rejects.toThrow();
    const retried = auth.start();
    await waitFor(() => auth.getStatus().phase === "authorizing");
    expect(requests[1]?.url).toContain("/device");
    await vi.advanceTimersByTimeAsync(1000);
    await retried;
    expect(await auth.getAccessToken()).toBe("access-new");
  });

  it("does not reuse a one-use device code if validating issued tokens has a network failure", async () => {
    const { auth, requests } = setup([
      json(device()),
      json(token()),
      json({}, 503),
      json(validation()),
    ]);
    const first = auth.start().catch((error) => error as Error);
    await waitFor(() => auth.getStatus().phase === "authorizing");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toBeInstanceOf(Error);
    expect(auth.getStatus().phase).toBe("error");
    await auth.start();
    expect(
      requests.filter((request) => request.url.endsWith("/token")),
    ).toHaveLength(1);
    expect(await auth.getAccessToken()).toBe("access-1");
  });
});
