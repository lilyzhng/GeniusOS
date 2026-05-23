import WebSocket from "ws";

const url = "ws://localhost:3335/voice/browser";
const timeoutMs = 20000;

console.log(`Connecting to ${url}...`);

const ws = new WebSocket(url);
let passed = false;

const timer = setTimeout(() => {
  if (!passed) {
    console.error("FAIL — no listening status within timeout");
    ws.close();
    process.exit(1);
  }
}, timeoutMs);

ws.on("open", () => {
  console.log("Browser WS open — sending start");
  ws.send(JSON.stringify({ type: "start", channel: "CH-01", mode: "charts" }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "status") {
    console.log(`  status: ${msg.state}`);
    if (msg.state === "listening") {
      passed = true;
      clearTimeout(timer);
      console.log("PASS — Gemini Live session ready");
      ws.send(JSON.stringify({ type: "stop" }));
      ws.close();
      setTimeout(() => process.exit(0), 300);
    }
  } else if (msg.type === "error") {
    console.error("FAIL — server error:", msg.error);
    clearTimeout(timer);
    ws.close();
    process.exit(1);
  }
});

ws.on("error", (err) => {
  clearTimeout(timer);
  console.error("FAIL — WebSocket error:", err.message);
  process.exit(1);
});
