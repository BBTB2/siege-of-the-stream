import { dashboardFetch } from "./dashboard-api.js";

const $ = (selector) => document.querySelector(selector);
const toggles = [...document.querySelectorAll("[data-effect]")];
let settings;
let pending = false;
let revision = 0;
let leaderKey = "";
function notice(text, error = false) {
  $("#settings-message").textContent = text;
  $("#settings-message").classList.toggle("warning", error);
}
function controls() {
  for (const input of toggles) input.disabled = pending || !settings;
  $("#reset-leaderboard").disabled = pending || !settings;
}
function render(value) {
  settings = value;
  $("#dashboard-access").textContent = "Unlocked · protected session";
  $("#dashboard-access").classList.add("healthy");
  for (const input of toggles)
    input.checked = value.effects[input.dataset.effect];
  const key = JSON.stringify(value.leaderboard);
  if (key !== leaderKey) {
    leaderKey = key;
    $("#leaderboard-empty").hidden = value.leaderboard.length > 0;
    $("#alltime-leaders").replaceChildren(
      ...value.leaderboard.slice(0, 25).map((leader) => {
        const row = document.createElement("tr");
        for (const field of [
          "username",
          "damage",
          "heals",
          "blocks",
          "score",
        ]) {
          const cell = document.createElement("td");
          cell.textContent = String(leader[field]);
          row.append(cell);
        }
        return row;
      }),
    );
  }
  $("#persistence-error").hidden = !value.persistenceError;
  $("#persistence-error").textContent = value.persistenceError ?? "";
  controls();
}
async function refresh() {
  const requestRevision = revision;
  try {
    if (pending) return;
    const response = await dashboardFetch("/api/dashboard");
    if (!response.ok) throw new Error("Dashboard settings unavailable.");
    const value = await response.json();
    if (requestRevision !== revision || pending) return;
    const initial = !settings;
    render(value);
    if (initial) notice("Event effects are ready. Changes apply immediately.");
  } catch (error) {
    if (requestRevision !== revision) return;
    settings = undefined;
    $("#dashboard-access").textContent = "Connection unavailable";
    $("#dashboard-access").classList.remove("healthy");
    controls();
    notice(`${error.message} Retrying…`, true);
  } finally {
    setTimeout(refresh, 2000);
  }
}
async function update(path, body, success) {
  pending = true;
  revision++;
  controls();
  try {
    const response = await dashboardFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "Unable to save changes.");
    render(value);
    notice(success);
  } catch (error) {
    if (settings) render(settings);
    notice(error.message ?? "Unable to reach the server.", true);
  } finally {
    pending = false;
    controls();
  }
}
for (const input of toggles) {
  input.addEventListener("change", () => {
    const enabled = input.checked;
    void update(
      "/api/effects",
      { type: input.dataset.effect, enabled },
      `${input.closest("label").querySelector("strong").textContent}: ${enabled ? "enabled" : "disabled"}.`,
    );
  });
}
$("#reset-leaderboard").addEventListener("click", () => {
  if (
    !confirm(
      "Clear all saved viewer totals? This cannot be undone. The current round will still count when it ends.",
    )
  )
    return;
  void update("/api/leaderboard/reset", {}, "All-time leaderboard reset.");
});
$("#dashboard-logout").addEventListener("click", async () => {
  $("#dashboard-logout").disabled = true;
  try {
    const response = await dashboardFetch("/api/dashboard/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("Could not lock the dashboard. Retry.");
    location.replace("/dashboard");
  } catch (error) {
    notice(error.message, true);
    $("#dashboard-logout").disabled = false;
  }
});
void refresh();
