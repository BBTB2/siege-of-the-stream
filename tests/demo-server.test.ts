import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";
import { createBattleServer } from "../src/app.js";

const running: ReturnType<typeof createBattleServer>[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()));
});

it("serves an isolated read-only demo stream without starting a live battle or Twitch", async () => {
  const app = createBattleServer({ mockMode: false });
  running.push(app);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const demo = new WebSocket(`${base.replace("http", "ws")}/ws?demo=1`);
  const first = await new Promise<any>((resolve) => {
    demo.once("message", (data) => resolve(JSON.parse(String(data))));
    demo.once("error", (error) => resolve({ error: error.message }));
  });
  expect(first.type).toBe("state");
  expect(first.state.status).toBe("playing");
  expect(first.state.demo).toEqual({
    elapsedMs: 0,
    durationMs: 60000,
    cycle: 1,
  });
  let advanced = first;
  for (
    let attempt = 0;
    attempt < 3 && advanced.state.demo.elapsedMs === 0;
    attempt++
  ) {
    advanced = JSON.parse(String((await once(demo, "message"))[0]));
  }
  expect(advanced.state.demo.elapsedMs).toBeGreaterThan(0);
  expect((await (await fetch(`${base}/api/state`)).json()).state.status).toBe(
    "idle",
  );
  expect((await (await fetch(`${base}/api/twitch`)).json()).phase).toBe("idle");
  demo.send(JSON.stringify({ action: "!attack" }));
  const [code] = await once(demo, "close");
  expect(code).toBe(1008);
});
