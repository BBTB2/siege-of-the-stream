# EventSub fixture recordings

`cli-*.json` are actual payloads recorded from installed **Twitch CLI 1.1.24** on
2026-11-02, using `twitch event trigger <type> --no-config --from-user 200
--to-user 100 --timestamp 2026-01-01T00:00:00Z`. Follow used `--version 2`, gift
used `--cost 5`, cheer used `--cost 500`, and raid used `--cost 75` (the CLI
generated a random viewer count despite that flag). These were generated locally
without forwarding or reading account configuration. Tests wrap the recorded
payload in WebSocket metadata; the original webhook transport field is retained
because it does not change the event mapping.

Other files are **synthetic sample envelopes**, not events captured from a
live Twitch account. The installed CLI does not support `channel.chat.message`,
so the chat fixture follows the official schema. Their shapes follow the Twitch
[EventSub reference](https://dev.twitch.tv/docs/eventsub/eventsub-reference/) and
[WebSocket notification envelope](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/#notification-message),
consulted on 2026-11-02. IDs, usernames, timestamps, and chat text are synthetic.
They contain no access tokens or real viewer data.

The fixtures provide representative notifications for replay in unit tests.
The variants cover ordinary/gifted subscriptions, anonymous gifts and
cheers, inbound raids, follows, and structured chat messages.

The parser accepts exactly one known command (case-insensitive, outer whitespace
ignored). Arguments and multiple commands are ignored. Gift notifications summon
one champion per notification, even for a gift bundle; corresponding gifted
`channel.subscribe` notifications are ignored to avoid duplicate champions.
