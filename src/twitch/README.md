# Twitch adapter boundary (next step)

No Twitch authentication or network connection is implemented yet.

The engine exports `command(state, userId, username, action)` and
`twitchEvent(state, event)`. A future chat/EventSub adapter should normalize
Twitch payloads and dispatch these transitions through the single state owner
in `src/app.ts`. Keep OAuth, EventSub deduplication, reconnects, and credentials
here, outside `src/game/`. Use stable Twitch user IDs for commands and cheer
attribution. Verify and deduplicate events before dispatching.

For now, the dashboard sends mock inputs to `/api/mock/command` and
`/api/mock/event`. These routes are unavailable when `MOCK_MODE=false`.
`TWITCH_CLIENT_ID` and `TWITCH_BROADCASTER_LOGIN` are reserved for the next step.
