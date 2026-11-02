const $ = (selector) => document.querySelector(selector);
let busy = false;
function render(status) {
  $("#twitch-status").textContent =
    `${status.mode.toUpperCase()} · ${status.phase}`;
  $("#twitch-message").textContent =
    status.message ??
    (status.mode === "mock"
      ? "Start the Twitch CLI WebSocket server on port 8080. No Twitch sign-in is needed."
      : status.phase === "connected"
        ? "Chat and channel events are connected."
        : "Authorize with the configured broadcaster account.");
  const auth = status.auth;
  const authorizing = auth?.phase === "authorizing";
  $("#twitch-device").hidden = !authorizing;
  $("#twitch-code").textContent = authorizing ? auth.userCode : "";
  if (authorizing) {
    const url = new URL(auth.verificationUri);
    if (
      url.protocol !== "https:" ||
      !["www.twitch.tv", "twitch.tv", "id.twitch.tv"].includes(url.hostname)
    )
      throw new Error("Invalid Twitch verification link.");
    $("#twitch-verify").href = url.href;
    $("#twitch-verify").textContent = url.href;
    $("#twitch-expiry").textContent =
      `· expires in ${Math.max(0, Math.ceil((auth.expiresAt - Date.now()) / 1000))}s`;
  } else $("#twitch-verify").removeAttribute("href");
  $("#twitch-connect").disabled =
    busy || !["idle", "error", "stopped", "degraded"].includes(status.phase);
  $("#twitch-subscriptions").replaceChildren(
    ...status.subscriptions.map((subscription) => {
      const item = document.createElement("li");
      item.textContent = `${subscription.type}: ${subscription.status}${subscription.message ? ` — ${subscription.message}` : ""}`;
      return item;
    }),
  );
}
async function refresh() {
  try {
    const response = await fetch("/api/twitch");
    if (!response.ok) throw new Error("Connection status unavailable.");
    render(await response.json());
  } catch {
    $("#twitch-status").textContent = "Status unavailable";
    $("#twitch-connect").disabled = true;
  } finally {
    setTimeout(refresh, 2000);
  }
}
$("#twitch-connect").addEventListener("click", async () => {
  busy = true;
  $("#twitch-connect").disabled = true;
  try {
    const response = await fetch("/api/twitch/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("Cannot reconnect.");
    render(await response.json());
  } catch {
    $("#twitch-message").textContent =
      "Cannot reach the server. Retry when it is available.";
  } finally {
    busy = false;
  }
});
void refresh();
