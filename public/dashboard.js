import { connectState } from "./stream.js";
import { dashboardFetch } from "./dashboard-api.js";

const $ = (selector) => document.querySelector(selector);
let current;
let connected = false;
let pending = false;
let configured = false;
let mockMode = false;
let resultsKey = "";
const overlayUrl = new URL("/overlay", location.href).href;
$("#overlay-url").value = overlayUrl;

function message(value, error = false) {
  $("#message").textContent = value;
  $("#message").classList.toggle("error", error);
}
function controls() {
  const playing = current?.status === "playing";
  const unavailable = !connected || pending || !configured;
  $("#start").disabled = unavailable || current?.status !== "idle";
  $("#rage").disabled = unavailable || !playing || Boolean(current?.rage);
  $("#stop").disabled = unavailable || !playing;
  $("#boss").disabled = unavailable || current?.status !== "idle";
  $("#duration").disabled = unavailable || current?.status !== "idle";
  document
    .querySelectorAll("[data-command], [data-event]")
    .forEach((button) => {
      button.disabled = unavailable || !playing || !mockMode;
    });
}
function render(state) {
  current = state;
  const remaining = Math.max(0, Math.ceil((state.endsAt - state.now) / 1000));
  $("#round-status").textContent =
    state.status === "idle"
      ? "Ready"
      : state.status === "results"
        ? state.outcome === "victory"
          ? "Victory"
          : "Round ended"
        : state.rage
          ? "Rage incoming"
          : `Phase ${state.boss.phase}`;
  $("#boss-health").textContent =
    `${state.boss.hp.toLocaleString()} / ${state.boss.maxHp.toLocaleString()}`;
  $("#hp-bar").style.width = `${(state.boss.hp / state.boss.maxHp) * 100}%`;
  $("#knight-count").textContent =
    `${state.knights.filter((k) => k.hp > 0).length} / ${state.knights.length}`;
  $("#time-left").textContent =
    state.status === "playing"
      ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
      : "—";
  $("#round-hint").textContent =
    state.status === "results"
      ? `Showing results for ${Math.max(0, Math.ceil((state.resultsUntil - state.now) / 1000))} more seconds.`
      : state.status === "playing"
        ? state.rage
          ? "Rage is telegraphed. Tell your chat to !defend now."
          : "The siege is live. Rally your chat with !join."
        : "Choose a boss and start whenever your army is ready.";
  $("#results-panel").hidden = state.status !== "results";
  const key = state.status === "results" ? String(state.resultsUntil) : "";
  if (key !== resultsKey) {
    resultsKey = key;
    $("#leaders").replaceChildren(
      ...state.leaderboard.slice(0, 10).map((leader, index) => {
        const row = document.createElement("tr");
        for (const value of [
          `${index === 0 ? "MVP · " : ""}${leader.username}`,
          leader.damage,
          leader.heals,
          leader.blocks,
          leader.score,
        ]) {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          row.append(cell);
        }
        return row;
      }),
    );
  }
  controls();
}
async function post(path, body, success) {
  pending = true;
  controls();
  try {
    const response = await dashboardFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "The action could not be completed.");
    if (result.state) render(result.state);
    message(
      result.effect?.startsWith("ignored:")
        ? `No game change: ${result.effect.slice(8).replaceAll("_", " ")}.`
        : success,
    );
  } catch (error) {
    message(error.message ?? "Cannot reach the game server.", true);
  } finally {
    pending = false;
    controls();
  }
}
$("#round-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("#start").disabled) return;
  void post(
    "/api/start",
    { boss: $("#boss").value, durationMs: Number($("#duration").value) * 1000 },
    "Round started. Send !join to rally the army.",
  );
});
$("#stop").addEventListener(
  "click",
  () =>
    void post(
      "/api/stop",
      {},
      "Round ended. The hall of heroes is on screen for 15 seconds.",
    ),
);
$("#rage").addEventListener(
  "click",
  () =>
    void post(
      "/api/rage",
      {},
      "Rage triggered. Your army has 2 seconds to !defend.",
    ),
);
$("#copy-url").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(overlayUrl);
    message("Overlay URL copied. Paste it into an OBS Browser Source.");
  } catch {
    $("#overlay-url").select();
    message("Select and copy the overlay URL above.");
  }
});
function viewer() {
  const username = $("#username").value.trim();
  if (!username) throw new Error("Enter a viewer username first.");
  return { username, userId: username.toLowerCase() };
}
document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    try {
      const who = viewer();
      void post(
        "/api/mock/command",
        { ...who, action: button.dataset.command },
        `${who.username}: ${button.dataset.command} sent. Join first; actions respect the cooldown. !heal can revive a knocked-out knight.`,
      );
    } catch (error) {
      message(error.message, true);
    }
  });
});
document.querySelectorAll("[data-event]").forEach((button) => {
  button.addEventListener("click", () => {
    try {
      const { username, userId } = viewer();
      const type = button.dataset.event;
      const event =
        type === "cheer"
          ? { type, bits: Number($("#bits").value), userId, username }
          : type === "raid"
            ? { type, viewers: Number($("#viewers").value), username }
            : type === "follow"
              ? { type, username }
              : { type, username };
      void post("/api/mock/event", event, `${type} event delivered.`);
    } catch (error) {
      message(error.message, true);
    }
  });
});
async function initialize() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("Cannot load the game configuration.");
    const config = await response.json();
    for (const [id, boss] of Object.entries(config.bosses)) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = `${boss.name} · ${boss.hp.toLocaleString()} HP`;
      $("#boss").append(option);
    }
    mockMode = config.mockMode;
    configured = true;
    $("#mock-panel").hidden = !mockMode;
    $("#mode").textContent = mockMode
      ? "MOCK MODE · Local Twitch CLI events"
      : "LIVE MODE · Twitch EventSub";
    if (!current || config.state.now >= current.now) render(config.state);
    controls();
  } catch (error) {
    message(`${error.message} Retrying…`, true);
    setTimeout(initialize, 3000);
  }
}
connectState(render, (status) => {
  connected = status === "Connected";
  $("#connection").textContent = status;
  $("#connection").classList.toggle("connected", connected);
  controls();
});
void initialize();
