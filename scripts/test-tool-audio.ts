import WebSocket from "ws";

const WS_URL = "ws://localhost:3335/voice/browser";

interface Stats {
  audioChunksBeforeTool: number;
  audioChunksAfterTool: number;
  audioBytesAfterTool: number;
  toolCallReceived: boolean;
  toolResultReceived: boolean;
  transcriptsAfterTool: string[];
  statusesAfterTool: string[];
  timeline: string[];
}

const stats: Stats = {
  audioChunksBeforeTool: 0,
  audioChunksAfterTool: 0,
  audioBytesAfterTool: 0,
  toolCallReceived: false,
  toolResultReceived: false,
  transcriptsAfterTool: [],
  statusesAfterTool: [],
  timeline: [],
};

let phase: "greeting" | "waiting-for-tool" | "tool-running" | "post-tool" = "greeting";
const startTime = Date.now();

function ts(): string {
  return `+${((Date.now() - startTime) / 1000).toFixed(1)}s`;
}

function log(msg: string): void {
  const entry = `[${ts()}] ${msg}`;
  stats.timeline.push(entry);
  console.log(entry);
}

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  log("Connected to server");
  ws.send(JSON.stringify({
    type: "start",
    context: "Look up the current weather in San Francisco right now using your background brain.",
  }));
  log("Sent start with tool-triggering context");
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case "audio": {
      const dataLen = msg.data?.length || 0;
      if (phase === "greeting" || phase === "waiting-for-tool") {
        stats.audioChunksBeforeTool++;
        if (stats.audioChunksBeforeTool === 1) log(`First greeting audio chunk (${dataLen} chars base64)`);
      } else {
        stats.audioChunksAfterTool++;
        stats.audioBytesAfterTool += dataLen;
        if (stats.audioChunksAfterTool === 1) log(`FIRST POST-TOOL AUDIO CHUNK (${dataLen} chars base64)`);
        if (stats.audioChunksAfterTool % 20 === 0) log(`  ...${stats.audioChunksAfterTool} post-tool audio chunks so far`);
      }
      break;
    }

    case "transcript": {
      log(`Transcript [${msg.role}]: "${msg.text?.slice(0, 120)}"`);
      if (phase === "greeting" && msg.role === "assistant") {
        phase = "waiting-for-tool";
        log("Phase -> waiting-for-tool (greeting done)");
      }
      if (phase === "post-tool") {
        stats.transcriptsAfterTool.push(msg.text);
      }
      break;
    }

    case "tool_call": {
      stats.toolCallReceived = true;
      phase = "tool-running";
      log(`Tool call: ${msg.name}(${JSON.stringify(msg.args).slice(0, 100)})`);
      log("Phase -> tool-running");
      break;
    }

    case "tool_result": {
      stats.toolResultReceived = true;
      phase = "post-tool";
      log(`Tool result received (${msg.result?.length || 0} chars)`);
      log(`Result preview: "${msg.result?.slice(0, 150)}"`);
      log("Phase -> post-tool (NOW WATCHING FOR AUDIO)");
      break;
    }

    case "status": {
      log(`Status: ${msg.state}`);
      if (phase === "post-tool") {
        stats.statusesAfterTool.push(msg.state);
      }
      break;
    }

    case "error": {
      log(`ERROR: ${JSON.stringify(msg.error)}`);
      break;
    }
  }
});

ws.on("close", () => {
  log("WebSocket closed");
  printReport();
});

ws.on("error", (err) => {
  log(`WebSocket error: ${err.message}`);
});

setTimeout(() => {
  log("Timeout reached (60s). Closing.");
  ws.close();
  setTimeout(() => printReport(), 500);
}, 60000);

function printReport(): void {
  console.log("\n" + "=".repeat(60));
  console.log("TEST REPORT: Audio after tool call");
  console.log("=".repeat(60));
  console.log(`Audio chunks BEFORE tool: ${stats.audioChunksBeforeTool}`);
  console.log(`Tool call received:       ${stats.toolCallReceived}`);
  console.log(`Tool result received:     ${stats.toolResultReceived}`);
  console.log(`Audio chunks AFTER tool:  ${stats.audioChunksAfterTool}`);
  console.log(`Audio bytes AFTER tool:   ${stats.audioBytesAfterTool}`);
  console.log(`Statuses after tool:      ${JSON.stringify(stats.statusesAfterTool)}`);
  console.log(`Transcripts after tool:   ${stats.transcriptsAfterTool.length}`);
  stats.transcriptsAfterTool.forEach((t) => console.log(`  -> "${t.slice(0, 120)}"`));
  console.log("=".repeat(60));

  if (stats.toolResultReceived && stats.audioChunksAfterTool > 0) {
    console.log("PASS: Audio WAS received after tool result");
  } else if (stats.toolResultReceived && stats.audioChunksAfterTool === 0) {
    console.log("FAIL: Tool result received but NO audio followed");
  } else if (!stats.toolCallReceived) {
    console.log("FAIL: Tool call was never triggered");
  } else {
    console.log("INCONCLUSIVE: Tool call triggered but no result received (timeout?)");
  }

  process.exit(0);
}
