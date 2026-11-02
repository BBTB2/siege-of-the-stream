# Siege of the Stream

Local Twitch/OBS collaborative boss battle. Node.js 20+, TypeScript ESM, Express,
`ws`, plain HTML and canvas. Supports public-client device OAuth, Twitch EventSub,
and Twitch CLI mock events. Credentials stay outside Git and browser state.

## Architecture

- `src/game/model.ts`: serializable state/types, bosses, rules, initial state.
- `src/game/index.ts`: public engine API and commands/events/round controls.
- `src/game/combat.ts`: damage, spawning, rage, effects, MVP results.
- `src/game/tick.ts`: deterministic fixed 100ms steps and NPC/boss behavior.
- `src/app.ts`: Express/WebSocket factory, sole runtime state owner, 10Hz clock.
- `src/demo.ts`: isolated deterministic 60s showcase (45s battle + 15s results).
- `src/server.ts`: `.env`, localhost listener, startup and shutdown.
- `src/validation.ts`: untrusted HTTP payload validation.
- `src/twitch/auth*.ts`, `token-store.ts`: device flow, validation, refresh, local storage.
- `src/twitch/helix.ts`, `subscriptions.ts`: broadcaster lookup and six event subscriptions.
- `src/twitch/eventsub.ts`: sockets, watchdog, reconnect handoff, deduplication.
- `src/twitch/mapping.ts`: pure external-payload validation and typed game inputs.
- `src/twitch/service.ts`: auth/transport orchestration; dispatches to app state owner.
- `scripts/mock-chat.mjs`: 30 local viewers through the real notification mapper.
- `public/`: `/overlay` at 1920×1080 with transparency, `/dashboard`, shared
  WebSocket client. No frontend framework or build pipeline.
- `tests/`: engine unit tests and real local HTTP/WebSocket integration tests.

## Commands

`npm install`, `npm run dev`, `npm run build`, `npm start`, `npm test`,
`npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run format`.
Lint checks Prettier formatting and parses browser/tooling JavaScript without
executing it. TypeScript semantic checks run separately via `typecheck`.
`npm run mock:chat` requires the local server in mock mode.
Integration tests require permission to listen on an ephemeral localhost port.
Coverage enforces 80% for all four metrics on the pure engine.

## Conventions

Keep game logic free of I/O, timers, wall-clock reads, randomness, and browser
APIs. Transitions return new state without mutating input. All simulation times
are milliseconds and advance in 100ms steps. Use stable Twitch user IDs, never
display names, for identity. NodeNext imports use `.js` extensions in TypeScript.
Write behavior tests before changing engine rules and run the full suite/build.

`!join` is idempotent and permits an immediate action. Attack/defend/heal share
a per-viewer 3s cooldown. Defense lasts 5s; healing revives a KO caster or targets
the most injured ally, including KO allies. Rage telegraphs last 2 seconds. A follow
refreshes a global 10s shield. Cheers deal one damage per bit, capped by boss HP.
NPC champions/reinforcements attack automatically. Phase thresholds are 2/3 and
1/3 HP. Phase three repeats telegraphed rage. Results last 15s and cannot be
skipped by starting another round. MVP score = damage + healing + 25×blocks;
ties use damage then stable ID. A timeout wins a tie with scheduled NPC attacks.

The server sends `{ type: 'state', state }` to read-only `/ws` clients every
100ms. Browser animation interpolates snapshots at display refresh rate (60fps in
OBS); server state remains authoritative. Do not introduce a second simulation in
browser code. `/overlay?demo=1` connects to `/ws?demo=1` for an independent scripted
timeline, never live state. Reset presentation pools when round identity changes.

`public/overlay-art.js` caches procedural canvas sprites/scenery; `overlay-hud.js`
draws UI; `overlay-feedback.js` caps particles/numbers/fireballs at 360/40/6.
Render all knights in reserve ranks and rotate 24 readable foreground nameplates
every 6s. Keep arbitrary Twitch colours readable using adaptive nameplate contrast.
Leave canvas transparent above y=720 except HUD/effects/results. Mutable browser
animation pools are ephemeral presentation state; engine state remains immutable.

Bind to loopback only while broadcaster authentication is absent. Keep Host
and Origin checks, JSON-only controls, payload limits, request budgets, and
WebSocket backpressure safeguards. Validate all external inputs, never expose
`.env` or credentials, and use canvas/textContent for viewer-provided text.
Twitch adapters normalize and deduplicate events before dispatching through the
same state owner. Live auth must be the configured broadcaster. Never print access
or refresh tokens or device secrets, or put them in WebSocket/dashboard state.
Only the user-facing verification URL and user code may be displayed. Preserve
`.env`, `.tokens.json`, and `.tokens.json.*` ignore rules and 0600 token permissions.

Fresh socket sessions resubscribe; a Twitch-directed handoff waits for new welcome
before closing the old socket and keeps existing subscriptions. Guard async
responses by lifecycle generation and subscription session/attempt; late responses
must not overwrite a newer session or authorization error. Keep mocks token-free.
CLI 1.1.24 lacks chat events; the mock chat script supplies synthetic envelopes.
