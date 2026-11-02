const form = document.querySelector("#login-form");
const input = document.querySelector("#dashboard-token");
const button = document.querySelector("#login-submit");
const message = document.querySelector("#login-message");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  message.textContent = "Unlocking…";
  message.classList.remove("warning");
  const token = input.value.trim();
  input.value = "";
  try {
    const response = await fetch("/api/dashboard/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error ?? "Unable to unlock the dashboard.");
    }
    location.replace("/dashboard");
  } catch (error) {
    message.textContent =
      error.message ?? "Cannot reach the server. Try again.";
    message.classList.add("warning");
    button.disabled = false;
    input.focus();
  }
});
