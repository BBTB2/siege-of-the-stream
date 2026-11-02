import { describe, expect, it, vi } from "vitest";
import { HelixClient } from "../src/twitch/helix.js";

describe("Helix client", () => {
  it("resolves the configured login and retries once with a refreshed user token on 401", async () => {
    const getAccessToken = vi
      .fn()
      .mockResolvedValueOnce("old")
      .mockResolvedValueOnce("new");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "42", login: "streamer" }] }),
      );
    const client = new HelixClient({
      clientId: "client",
      mockMode: false,
      getAccessToken,
      fetch: request,
    });
    expect(await client.resolveBroadcaster("Streamer")).toBe("42");
    expect(request.mock.calls[0]?.[0]).toBe(
      "https://api.twitch.tv/helix/users?login=streamer",
    );
    expect(
      new Headers(request.mock.calls[1]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer new");
    expect(getAccessToken.mock.calls).toEqual([[false], [true]]);
  });
  it("refuses missing or mismatched broadcaster records", async () => {
    for (const data of [
      [],
      [{ id: "42", login: "someone_else" }],
      [{ id: {}, login: "streamer" }],
    ]) {
      const client = new HelixClient({
        clientId: "client",
        mockMode: false,
        getAccessToken: async () => "token",
        fetch: vi.fn().mockResolvedValue(Response.json({ data })),
      });
      await expect(client.resolveBroadcaster("streamer")).rejects.toThrow(
        "broadcaster",
      );
    }
  });
  it("uses the CLI local subscription path without real authorization in mock mode", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 202 }));
    const getAccessToken = vi
      .fn()
      .mockRejectedValue(new Error("Must not authenticate"));
    const client = new HelixClient({
      clientId: "real-client",
      mockMode: true,
      getAccessToken,
      fetch: request,
    });
    const subscription = {
      type: "channel.follow",
      version: "2",
      condition: { broadcaster_user_id: "1234", moderator_user_id: "1234" },
      transport: { method: "websocket", session_id: "session" },
    };
    await client.subscribe(subscription);
    expect(request.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:8080/eventsub/subscriptions",
    );
    expect(
      new Headers(request.mock.calls[0]?.[1]?.headers).has("Authorization"),
    ).toBe(false);
    expect(
      new Headers(request.mock.calls[0]?.[1]?.headers).get("Client-Id"),
    ).toBe("siege-mock");
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual(
      subscription,
    );
    expect(getAccessToken).not.toHaveBeenCalled();
  });
  it("reports scope/rate failures without exposing upstream response bodies", async () => {
    const client = new HelixClient({
      clientId: "client",
      mockMode: false,
      getAccessToken: async () => "secret",
      fetch: vi.fn().mockResolvedValue(new Response("secret", { status: 403 })),
    });
    await expect(client.subscribe({ type: "channel.cheer" })).rejects.toThrow(
      "403",
    );
    await expect(
      client.subscribe({ type: "channel.cheer" }),
    ).rejects.not.toThrow("secret");
  });
});
