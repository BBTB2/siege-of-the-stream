# Siege of the Stream

A Twitch chat army versus a three-phase boss, built for the Codex × TwitchCon
Hackathon. This version is a complete local mock demo. Live Twitch authentication
and event ingestion are reserved for the next step.

## Run

Requires Node.js 20.19+ (or 22.12+), matching the test tooling requirements.

```sh
npm install
cp .env.example .env
npm run dev
```

Open **http://localhost:3000/dashboard**. Select a boss and round length, start
the battle, and use the mock chat/event controls. The server binds to
`127.0.0.1`; keep OBS and the dashboard on that machine.

In OBS, add a **Browser Source** with URL **http://localhost:3000/overlay**,
width **1920**, height **1080**, and FPS **30**. The background is transparent.
Keep the source active for continuous rendering. Browser clients reconnect
automatically and receive the current authoritative state.

For a compiled run:

```sh
npm run build
npm start
```

The `public/` directory must stay beside `dist/`. State is held in memory and
resets when the server restarts.

## Play

| Input | Effect |
| --- | --- |
| `!join` | Spawn one named knight per viewer; first action is immediately available |
| `!attack` | Deal 25 boss damage |
| `!defend` | Block incoming attacks for 5 seconds |
| `!heal` | Restore up to 30 HP to the most injured living ally |
| Follow | Shield the entire army for 10 seconds; another follow refreshes it |
| Subscription or gift | Summon a 200-HP champion attacking for 40 every 3 seconds |
| Cheer | Fireball dealing 1 damage per bit |
| Raid | Spawn up to 50 reinforcements attacking for 10 every 3 seconds |

Attack, defend, and heal share a **3-second per-viewer cooldown**. Knocked-out
knights wait for the next round. Bosses strike every 5 seconds for 10/20/30 HP
according to phase. At two-thirds and one-third HP they enter phases two and
three. Phase three unleashes repeating rage attacks: **four seconds to defend**
before every unprotected knight in the marked area is knocked out. The
dashboard can trigger rage in any phase. A shield wall also blocks rage.

Boss death is victory; timer expiry is defeat. Stopping a round shows results
too. MVP results stay visible for **15 seconds** before another round can start.
Scores combine damage, actual healing, and 25 points per blocked hit. Champions
and reinforcements also appear in the rankings.

Large armies rotate through labeled pages of 60 knights every six seconds;
all knights continue participating regardless of which page is visible.

## Configuration

| Variable | Default / use |
| --- | --- |
| `PORT` | `3000` |
| `MOCK_MODE` | `true`; `false` disables mock ingestion routes |
| `TWITCH_CLIENT_ID` | Reserved for next-step Twitch integration |
| `TWITCH_BROADCASTER_LOGIN` | Reserved for next-step Twitch integration |

No Twitch credentials are needed for this version. No events are sent to Twitch.

## Verify

```sh
npm test
npm run test:coverage
npm run typecheck
npm run build
```

Engine tests use deterministic simulation time. Integration tests bind temporary
localhost ports to test controls and the real WebSocket stream. Coverage applies
to `src/game/` and enforces 80% lines, statements, branches, and functions.
See [AGENTS.md](AGENTS.md) for architecture and development conventions.
