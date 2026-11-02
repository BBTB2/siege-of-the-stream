import "dotenv/config";
import { createBattleServer } from "./app.js";
import { loadDashboardToken } from "./dashboard-auth.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535.");
const mode = process.env.MOCK_MODE ?? "true";
if (mode !== "true" && mode !== "false")
  throw new Error("MOCK_MODE must be true or false.");
const dashboardToken = loadDashboardToken(
  ".dashboard-token",
  process.env.DASHBOARD_TOKEN,
);
const battle = createBattleServer({
  dashboardToken,
  leaderboardPath: "data/leaderboard.json",
  mockMode: mode === "true",
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    broadcasterLogin: process.env.TWITCH_BROADCASTER_LOGIN,
    mockBroadcasterId: process.env.TWITCH_MOCK_BROADCASTER_ID ?? "1234",
  },
  log: (line) => process.stdout.write(`${line}\n`),
});
battle.server.on("error", (error) => {
  console.error("Cannot start Siege of the Stream:", error.message);
  void battle.close().finally(() => {
    process.exitCode = 1;
  });
});
battle.server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `DASHBOARD_TOKEN=${dashboardToken}\nKeep this token private; enter it on the dashboard unlock screen.\nSiege of the Stream: http://localhost:${port}/dashboard\nOBS browser source: http://localhost:${port}/overlay (1920×1080)\n`,
  );
  battle.startTwitch();
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void battle.close().catch((error: unknown) => {
      console.error("Shutdown failed", error);
      process.exitCode = 1;
    });
  });
}
