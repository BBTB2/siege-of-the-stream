import { describe, expect, it } from "vitest";
import { createChatRateLimiter } from "../src/chat-rate-limit.js";

describe("chat ingress rate limits", () => {
  it("allows joining and immediately acting, then limits one viewer independently", () => {
    const limiter = createChatRateLimiter();
    for (let index = 0; index < 5; index++)
      expect(limiter.accept("alice", 0)).toBe("allowed");
    expect(limiter.accept("alice", 999)).toBe("user_rate_limit");
    expect(limiter.accept("bob", 999)).toBe("allowed");
    expect(limiter.accept("alice", 1000)).toBe("allowed");
  });

  it("bounds aggregate commands even when every sender has a new identity", () => {
    const limiter = createChatRateLimiter();
    for (let index = 0; index < 100; index++)
      expect(limiter.accept(String(index), 0)).toBe("allowed");
    expect(limiter.accept("another", 999)).toBe("global_rate_limit");
    expect(limiter.accept("another", 1000)).toBe("allowed");
  });

  it("does not let one blocked sender consume everyone else's budget", () => {
    const limiter = createChatRateLimiter();
    for (let index = 0; index < 5; index++) limiter.accept("spam", 0);
    for (let index = 0; index < 1000; index++)
      expect(limiter.accept("spam", 0)).toBe("user_rate_limit");
    for (let index = 0; index < 95; index++)
      expect(limiter.accept(String(index), 0)).toBe("allowed");
    expect(limiter.accept("last", 0)).toBe("global_rate_limit");
  });

  it("expires old identities so sustained new viewers never exhaust retained slots", () => {
    const limiter = createChatRateLimiter();
    for (let second = 0; second < 150; second++)
      for (let index = 0; index < 100; index++)
        expect(limiter.accept(`${second}:${index}`, second * 1000)).toBe(
          "allowed",
        );
  });

  it("does not reopen a budget when time moves backwards", () => {
    const limiter = createChatRateLimiter();
    for (let index = 0; index < 5; index++) limiter.accept("alice", 1000);
    expect(limiter.accept("alice", 0)).toBe("user_rate_limit");
    expect(limiter.accept("alice", 2000)).toBe("allowed");
  });
});
