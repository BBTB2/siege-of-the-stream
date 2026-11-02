# Twitch connection

`TwitchService` owns OAuth, Helix, and EventSub resources. Its dispatch callback
is the sole bridge to the game state owner in `app.ts`; the pure engine has no
Twitch or I/O dependency.

- `auth.ts` / `auth-protocol.ts`: public-client device flow, startup/hourly token
  validation, proactive refresh, pending/slow-down and cancellation handling.
- `token-store.ts`: atomic `.tokens.json` writes with 0600 permissions.
- `helix.ts`: broadcaster lookup and authorized subscription requests, with one
  refresh/retry on 401. Mock requests use a dummy client ID and no access token.
- `subscriptions.ts`: chat v1, follow v2, subscribe/gift/cheer/raid v1 conditions.
- `eventsub.ts`: bounded deduplication, keepalive deadlines, connection backoff,
  revocations, and overlapping session migration without resubscribing.
- `mapping.ts`: exact chat commands and validated EventSub-to-game transformations.
- `service.ts`: sanitized status, per-session retries, compact effect logs, cleanup.

`GET /api/twitch` exposes safe connection/auth status. `POST /api/twitch/connect`
starts or retries authorization/connection. Both retain localhost/Origin checks.
Mock-only `/api/mock/notification` feeds synthetic EventSub envelopes through the
same mapper; it exists because older Twitch CLI versions cannot emit chat.

Live mode uses the configured broadcaster's user token. Mock mode skips OAuth and
Helix user lookup, defaults to channel `1234`, connects to `ws://127.0.0.1:8080/ws`,
and subscribes at `http://127.0.0.1:8080/eventsub/subscriptions`.

See the root README for commands and the fixture README for recorded/synthetic
payload provenance. Tests cover mapping, auth, transport, and service races without
real Twitch credentials.
