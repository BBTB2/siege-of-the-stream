# Siege of the Stream

Local Twitch/OBS collaborative boss battle. Node.js 20+, TypeScript ESM, Express,
`ws`, plain HTML and canvas. The app currently runs with mock events; Twitch
authentication and live chat/EventSub are intentionally the next step.

## Architecture

- `src/game/model.ts`: serializable state/types, bosses, rules, initial state.
- `src/game/index.ts`: public engine API and commands/events/round controls.
- `src/game/combat.ts`: damage, spawning, rage, effects, MVP results.
- `src/game/tick.ts`: deterministic fixed 100ms steps and NPC/boss behavior.
- `src/app.ts`: Express/WebSocket factory, sole runtime state owner, 10Hz clock.
- `src/server.ts`: `.env`, localhost listener, startup and shutdown.
- `src/validation.ts`: untrusted HTTP payload validation.
- `src/twitch/`: reserved for chat/EventSub adapters; no OAuth implemented.
- `public/`: `/overlay` at 1920×1080 with transparency, `/dashboard`, shared
  WebSocket client. No frontend framework or build pipeline.
- `tests/`: engine unit tests and real local HTTP/WebSocket integration tests.

## Commands

`npm install`, `npm run dev`, `npm run build`, `npm start`, `npm test`,
`npm run test:coverage`, `npm run typecheck`, `npm run format`.
Integration tests require permission to listen on an ephemeral localhost port.
Coverage enforces 80% for all four metrics on the pure engine.

## Conventions

Keep game logic free of I/O, timers, wall-clock reads, randomness, and browser
APIs. Transitions return new state without mutating input. All simulation times
are milliseconds and advance in 100ms steps. Use stable Twitch user IDs, never
display names, for identity. NodeNext imports use `.js` extensions in TypeScript.
Write behavior tests before changing engine rules and run the full suite/build.

`!join` is idempotent and permits an immediate action. Attack/defend/heal share
a per-viewer 3s cooldown. Defense lasts 5s; healing targets the most injured
living ally, with no resurrection. KO lasts until the next round. A follow
refreshes a global 10s shield. Cheers deal one damage per bit, capped by boss HP.
NPC champions/reinforcements attack automatically. Phase thresholds are 2/3 and
1/3 HP. Phase three repeats telegraphed rage. Results last 15s and cannot be
skipped by starting another round. MVP score = damage + healing + 25×blocks;
ties use damage then stable ID. A timeout wins a tie with scheduled NPC attacks.

The server sends `{ type: 'state', state }` to read-only `/ws` clients every
100ms. Browser animation interpolates snapshots at 30fps; server state remains
authoritative. Do not introduce a second simulation in browser code.

Bind to loopback only while broadcaster authentication is absent. Keep Host
and Origin checks, JSON-only controls, payload limits, request budgets, and
WebSocket backpressure safeguards. Validate all external inputs, never expose
`.env` or credentials, and use canvas/textContent for viewer-provided text.
Future Twitch adapters normalize and deduplicate verified events before
dispatching through the same state owner. Do not add OAuth without being asked.
