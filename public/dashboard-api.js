/** Session cookies are HttpOnly; dashboard credentials never enter browser storage. */
let redirecting = false;
export async function dashboardFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (response.status === 401) {
    if (!redirecting) {
      redirecting = true;
      location.replace("/dashboard");
    }
    throw new Error("Dashboard session expired. Unlock the dashboard again.");
  }
  return response;
}
