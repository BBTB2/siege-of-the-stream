import express, { type ErrorRequestHandler } from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { WebSocket, WebSocketServer } from "ws";
import {
  BOSSES,
  RULES,
  command,
  createGame,
  startRound,
  stopRound,
  tick,
  triggerRage,
  twitchEvent,
  type GameState,
} from "./game/index.js";
import {
  chatInput,
  eventInput,
  InputError,
  roundOptions,
  effectSetting,
} from "./validation.js";
import { TwitchService, type TwitchConfig } from "./twitch/service.js";
import type { GameInput } from "./twitch/mapping.js";
import { createDemo, tickDemo, type DemoState } from "./demo.js";

import { createDashboardAuth } from "./dashboard-auth.js";
import { createChatRateLimiter } from "./chat-rate-limit.js";
import { LeaderboardStore } from "./leaderboard-store.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
function trustedHost(host: string | undefined) {
  try {
    return !!host && allowedHosts.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
function trustedOrigin(origin: string | undefined, host: string | undefined) {
  return !origin || origin === `http://${host}`;
}

/** The sole I/O owner. Engine state is replaced, never edited in place. */
export function createBattleServer({
  mockMode,
  twitch: twitchConfig,
  log,
  dashboardToken = randomBytes(32).toString("hex"),
  leaderboardPath,
}: {
  mockMode: boolean;
  dashboardToken?: string;
  leaderboardPath?: string;
  twitch?: TwitchConfig;
  log?: (line: string) => void;
}) {
  const app = express();
  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const demos = new Map<WebSocket, DemoState>();
  let state = createGame();
  const auth = createDashboardAuth(dashboardToken);
  const chatLimiter = createChatRateLimiter();
  const leaderboard = new LeaderboardStore(leaderboardPath);
  let effects = {
    follow: true,
    subscription: true,
    gift: true,
    cheer: true,
    raid: true,
  };
  const dashboard = () => ({
    effects,
    leaderboard: leaderboard.get(),
    persistenceError: leaderboard.getError(),
  });
  function replaceState(next: GameState) {
    if (state.status === "playing" && next.status === "results")
      leaderboard.addRound(next.leaderboard);
    state = next;
  }
  function dispatch(input: GameInput): string {
    if (input.kind === "command") {
      const allowance = chatLimiter.accept(input.userId, performance.now());
      if (allowance !== "allowed") return `ignored:${allowance}`;
      if (
        input.action !== "!join" &&
        !state.knights.some((k) => k.id === `viewer:${input.userId}`)
      )
        return "ignored:not_joined";
    } else if (!effects[input.event.type])
      return `ignored:effect_disabled:${input.event.type}`;
    const before = state;
    replaceState(
      input.kind === "command"
        ? command(
            state,
            input.userId,
            input.username,
            input.action,
            input.color,
          )
        : twitchEvent(state, input.event),
    );
    if (before === state)
      return `ignored:${before.status !== "playing" ? "round_inactive" : "cooldown_unjoined_or_knocked_out"}`;
    const damage = before.boss.hp - state.boss.hp;
    const spawned = state.knights.length - before.knights.length;
    const heals =
      state.knights.reduce((sum, k) => sum + k.heals, 0) -
      before.knights.reduce((sum, k) => sum + k.heals, 0);
    return `${input.kind === "command" ? input.action : input.event.type} damage=${damage} spawn=${spawned} heal=${heals} shield=${Math.max(0, state.shieldUntil - state.now)}ms phase=${state.boss.phase}`;
  }
  const twitch = new TwitchService({
    ...twitchConfig,
    mockMode,
    dispatch,
    log,
  });
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!trustedHost(req.headers.host)) {
      res.status(403).json({ error: "Use localhost to access this server." });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws:; frame-ancestors 'self'; base-uri 'none'",
    );
    next();
  });
  // Local-only server: one shared budget bounds script abuse without retaining IPs.
  let budget = { until: 0, count: 0 };
  app.use("/api", (req, res, next) => {
    const now = performance.now();
    budget =
      now >= budget.until
        ? { until: now + 60_000, count: 1 }
        : { ...budget, count: budget.count + 1 };
    res.setHeader("Cache-Control", "no-store");
    if (budget.count > 1200) {
      res.status(429).json({ error: "Too many requests; retry in a minute." });
      return;
    }
    if (!trustedOrigin(req.headers.origin, req.headers.host)) {
      res.status(403).json({ error: "Cross-origin controls are disabled." });
      return;
    }
    if (req.method === "POST" && !req.is("application/json")) {
      res.status(415).json({ error: "Send application/json." });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "8kb" }));
  app.get("/api/state", (_req, res) =>
    res.json({ state, bosses: BOSSES, mockMode }),
  );
  app.post("/api/dashboard/login", auth.login);
  app.use("/api", auth.requireAuth);
  app.post("/api/dashboard/logout", auth.logout);
  app.get("/api/dashboard", (_req, res) => res.json(dashboard()));
  app.post("/api/effects", (req, res) => {
    const setting = effectSetting(req.body);
    effects = { ...effects, [setting.type]: setting.enabled };
    res.json(dashboard());
  });
  app.post("/api/leaderboard/reset", async (_req, res, next) => {
    leaderboard.reset();
    try {
      await leaderboard.flush();
      res.json(dashboard());
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/twitch", (_req, res) => res.json(twitch.getStatus()));
  app.post("/api/twitch/connect", (_req, res) => {
    twitch.start();
    res.status(202).json(twitch.getStatus());
  });
  app.post("/api/start", (req, res) => {
    const options = roundOptions(req.body);
    if (state.status !== "idle") {
      res
        .status(409)
        .json({ error: "Wait for the current round and results to finish." });
      return;
    }
    replaceState(startRound(state, options));
    res.json({ state });
  });
  const control = (path: string, transition: (s: GameState) => GameState) => {
    app.post(path, (_req, res) => {
      replaceState(transition(state));
      res.json({ state });
    });
  };
  control("/api/stop", stopRound);
  control("/api/rage", triggerRage);
  app.use("/api/mock", (_req, res, next) => {
    if (!mockMode) {
      res.status(404).json({ error: "Mock mode is disabled." });
      return;
    }
    next();
  });
  app.post("/api/mock/command", (req, res) => {
    const input = chatInput(req.body);
    const effect = dispatch({ kind: "command", ...input });
    log?.(JSON.stringify({ twitch: "mock.chat", effect }));
    res.json({ state, effect });
  });
  app.post("/api/mock/event", (req, res) => {
    const event = eventInput(req.body);
    const effect = dispatch({ kind: "event", event });
    log?.(JSON.stringify({ twitch: `mock.${event.type}`, effect }));
    res.json({ state, effect });
  });
  app.post("/api/mock/notification", (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      throw new InputError("Expected an EventSub envelope.");
    twitch.handleNotification(req.body);
    res.json({ state });
  });
  app.get("/", (_req, res) => res.redirect("/dashboard"));
  app.get(["/overlay", "/overlay.html"], (_req, res) =>
    res.sendFile("overlay.html", { root: publicDir }),
  );
  app.get(["/dashboard", "/dashboard.html"], (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const authorized = auth.authenticated(req);
    res
      .status(authorized ? 200 : 401)
      .sendFile(authorized ? "dashboard.html" : "dashboard-login.html", {
        root: publicDir,
      });
  });
  // HTML is served only by the explicit routes above: encoded/static aliases
  // must never bypass the dashboard authentication gate.
  const assets = express.static(publicDir, { index: false });
  app.use((req, res, next) => {
    if ([".js", ".css"].includes(extname(req.path))) assets(req, res, next);
    else next();
  });
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof InputError || error?.type === "entity.parse.failed") {
      res.status(400).json({
        error: error instanceof InputError ? error.message : "Invalid JSON.",
      });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large." });
      return;
    }
    console.error("HTTP request failed", error);
    res.status(500).json({ error: "Unable to process the request." });
  };
  app.use(errors);

  server.on("upgrade", (req, socket, head) => {
    if (
      (req.url !== "/ws" && req.url !== "/ws?demo=1") ||
      !trustedHost(req.headers.host) ||
      !trustedOrigin(req.headers.origin, req.headers.host) ||
      sockets.clients.size >= 32
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(req, socket, head, (client) =>
      sockets.emit("connection", client, req),
    );
  });
  sockets.on("connection", (client, req) => {
    if (req.url === "/ws?demo=1") demos.set(client, createDemo());
    client.on("close", () => demos.delete(client));
    client.on("error", () => client.terminate());
    client.on("message", () =>
      client.close(1008, "State stream is read-only."),
    );
    client.send(
      JSON.stringify({ type: "state", state: demos.get(client) ?? state }),
    );
  });
  let previous = performance.now();
  let remainder = 0;
  const interval = setInterval(() => {
    const now = performance.now();
    remainder += now - previous;
    previous = now;
    const elapsed = Math.floor(remainder / RULES.tickMs) * RULES.tickMs;
    remainder -= elapsed;
    // Observe each result transition even after a delayed event-loop tick.
    for (let step = 0; step < elapsed; step += RULES.tickMs)
      replaceState(tick(state));
    const payload = JSON.stringify({ type: "state", state });
    for (const client of sockets.clients) {
      if (client.bufferedAmount > 1_000_000) client.terminate();
      else if (client.readyState === WebSocket.OPEN) {
        const demo = demos.get(client);
        if (demo) {
          const advanced = elapsed ? tickDemo(demo, elapsed) : demo;
          demos.set(client, advanced);
          client.send(JSON.stringify({ type: "state", state: advanced }));
        } else client.send(payload);
      }
    }
  }, RULES.tickMs);
  interval.unref();
  async function close() {
    twitch.stop();
    clearInterval(interval);
    for (const client of sockets.clients) client.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error &&
        (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
          ? reject(error)
          : resolve(),
      ),
    );
    await leaderboard.flush();
  }
  return { server, close, startTwitch: () => twitch.start() };
}
