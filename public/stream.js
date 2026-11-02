/** Read-only state stream shared by the OBS canvas and broadcaster controls. */
export function connectState(onState, onStatus) {
  let socket;
  let retry = 500;
  let receivedAt = 0;
  let stopped = false;
  let reconnect;
  function connect() {
    onStatus("Connecting");
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    socket.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.type !== "state" || !message.state) return;
        receivedAt = performance.now();
        retry = 500;
        onStatus("Connected");
        onState(message.state, receivedAt);
      } catch {
        onStatus("Invalid state received");
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      onStatus("Reconnecting");
      if (!stopped) reconnect = setTimeout(connect, retry);
      retry = Math.min(retry * 2, 5000);
    };
  }
  const watchdog = setInterval(() => {
    if (
      socket?.readyState === WebSocket.OPEN &&
      performance.now() - receivedAt > 3000
    ) {
      onStatus("Connection stalled");
      socket.close();
    }
  }, 1000);
  connect();
  return () => {
    stopped = true;
    clearTimeout(reconnect);
    clearInterval(watchdog);
    socket?.close();
  };
}
