import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const seconds = Number(process.env.MOCK_CHAT_SECONDS ?? 60);
const port = Number(process.env.PORT ?? 3000);
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !Number.isFinite(seconds) ||
  seconds < 1 ||
  seconds > 3600
) {
  throw new Error(
    "PORT must be valid; MOCK_CHAT_SECONDS must be between 1 and 3600.",
  );
}
const base = `http://127.0.0.1:${port}`;
let dashboardToken;
try {
  dashboardToken =
    process.env.DASHBOARD_TOKEN ??
    (await readFile(".dashboard-token", "utf8")).trim();
} catch {
  throw new Error(
    "Start the app once to create its local dashboard token, or supply DASHBOARD_TOKEN.",
  );
}
const broadcasterId = process.env.TWITCH_MOCK_BROADCASTER_ID ?? "1234";
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
async function request(path, body) {
  const response = await fetch(base + path, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${dashboardToken}`,
    },
    ...(body
      ? {
          method: "POST",
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
  });
  if (!response.ok)
    throw new Error(`Mock request failed (HTTP ${response.status}).`);
  return response.json();
}
async function send(index, command) {
  return request("/api/mock/notification", {
    metadata: {
      message_id: randomUUID(),
      message_type: "notification",
      message_timestamp: new Date().toISOString(),
      subscription_type: "channel.chat.message",
      subscription_version: "1",
    },
    payload: {
      subscription: {
        type: "channel.chat.message",
        version: "1",
        condition: { broadcaster_user_id: broadcasterId },
      },
      event: {
        broadcaster_user_id: broadcasterId,
        chatter_user_id: String(800000 + index),
        chatter_user_name: `Knight_${String(index + 1).padStart(2, "0")}`,
        source_broadcaster_user_id: null,
        message: { text: command },
      },
    },
  });
}
async function run() {
  const config = await request("/api/state");
  if (!config.mockMode) throw new Error("mock:chat requires MOCK_MODE=true.");
  if (config.state.status === "results")
    throw new Error("Wait for the 15-second results screen, then retry.");
  if (config.state.status === "idle")
    await request("/api/start", {
      boss: "void-king",
      durationMs: Math.max(60, seconds) * 1000,
    });
  for (let index = 0; index < 30; index++) await send(index, "!join");
  process.stdout.write(
    `30 mock viewers joined. Sending commands for up to ${seconds}s; Ctrl+C stops the generator.\n`,
  );
  const end = Date.now() + seconds * 1000;
  const commands = ["!attack", "!attack", "!attack", "!defend", "!heal"];
  let turn = 0;
  while (Date.now() < end) {
    const { state } = await send(
      turn++ % 30,
      commands[Math.floor(Math.random() * commands.length)],
    );
    if (state.status !== "playing") break;
    await sleep(110, undefined, { signal: controller.signal });
  }
  process.stdout.write("Mock chat complete.\n");
}
run().catch((error) => {
  if (controller.signal.aborted) return;
  console.error(error instanceof Error ? error.message : "Mock chat failed.");
  process.exitCode = 1;
});
