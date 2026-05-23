import WebSocket from "ws";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import http from "node:http";
import { config } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = resolve(__dirname, "../public/generated");
const BG_BRAIN_URL = "http://localhost:3336/task";

const OPENAI_REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-realtime-2";

const SYSTEM_PROMPT = `You are Jackie (named after Jackie Chan), Lily's product person and always-on assistant. You have strong product taste and your own perspective.

Speaking style:
- Be brief. Aim for 1-2 short sentences per turn. If Lily wants more, she'll ask.
- Skip filler like "Let me know if you need anything else", "Got it, you mean...", "so I don't miss anything", "happy to help".
- Get straight to the answer or action. No throat-clearing.
- Never use em dashes (—). Use a period or comma, or rewrite. Em dashes read as AI.
- Talk like a sharp friend, not a customer service rep.
- When Lily interrupts or says "stop," immediately stop talking.
- Wait for Lily to speak first. Don't fill silence. If she pauses or hasn't said anything meaningful yet, stay quiet.

You have a background brain (Gemini 3.5 Flash) that can analyze local data and create visualizations. Use the use_cli tool whenever you need to look something up or do something. Write a clear, specific task description.

When asked to visualize or chart something, send a SINGLE short tool call describing what insight Lily wants — e.g. "Visualize Uber Q1 2026 earnings: how revenue and EBITDA trended over the last five quarters." The background brain has the data loaded locally and will pick the best chart layout. Don't prescribe chart type unless Lily asked for a specific format.

When a tool returns a result, never read it verbatim. Paraphrase in one or two short sentences.`;

const toolDefinitions = [
  {
    type: "function" as const,
    name: "use_cli",
    description: "Send a task to your background brain (Gemini). It has local data files loaded and can create chart visualizations. Keep task descriptions short and specific.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task to perform" },
      },
      required: ["task"],
    },
  },
];

interface BrowserSession {
  browserWs: WebSocket;
  openaiWs: WebSocket | null;
  transcript: string[];
  isSpeaking: boolean;
  mutemic: boolean;
}

export function handleBrowserStream(browserWs: WebSocket): void {
  const session: BrowserSession = {
    browserWs,
    openaiWs: null,
    isSpeaking: false,
    mutemic: false,
    transcript: [],
  };

  browserWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case "start":
        console.log("[browser] Session start");
        connectOpenAI(session, msg.context ?? null);
        send(session, { type: "status", state: "listening" });
        break;

      case "audio":
        if (session.openaiWs?.readyState === WebSocket.OPEN && !session.mutemic) {
          session.openaiWs.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: msg.data,
            })
          );
        }
        break;

      case "stop":
        console.log("[browser] Session stop");
        if (session.openaiWs?.readyState === WebSocket.OPEN) {
          session.openaiWs.close();
        }
        break;
    }
  });

  browserWs.on("close", () => {
    console.log("[browser] WebSocket closed");
    if (session.openaiWs?.readyState === WebSocket.OPEN) {
      session.openaiWs.close();
    }
  });

  browserWs.on("error", (err) => {
    console.error("[browser] WebSocket error:", err.message);
  });
}

function connectOpenAI(session: BrowserSession, context: string | null): void {
  const ws = new WebSocket(OPENAI_REALTIME_URL, {
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
  });

  session.openaiWs = ws;

  ws.on("open", () => {
    console.log("[openai] Connected to Realtime API");

    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          model: "gpt-realtime-2",
          output_modalities: ["audio"],
          instructions: SYSTEM_PROMPT,
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                interrupt_response: false,
              },
            },
            output: {
              format: { type: "audio/pcm", rate: 24000 },
              voice: "alloy",
            },
          },
          tools: toolDefinitions,
        },
      })
    );

    const greetingText = context
      ? `[System: Lily asked you to: ${context}. Greet her briefly and start on this right away.]`
      : "[System: Greet Lily naturally and briefly. Let her lead the conversation.]";

    ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: greetingText }],
        },
      })
    );
    ws.send(JSON.stringify({ type: "response.create" }));
  });

  ws.on("message", (data) => {
    const event = JSON.parse(data.toString());
    handleOpenAIEvent(event, session);
  });

  ws.on("close", () => console.log("[openai] WebSocket closed"));
  ws.on("error", (err) => console.error("[openai] Error:", err.message));
}

function handleOpenAIEvent(
  event: Record<string, unknown>,
  session: BrowserSession
): void {
  switch (event.type) {
    case "session.created":
      console.log("[openai] Session created");
      break;

    case "session.updated":
      console.log("[openai] Session configured");
      send(session, { type: "status", state: "listening" });
      break;

    case "input_audio_buffer.speech_started":
      console.log("[openai] Speech started");
      break;

    case "response.audio.delta":
    case "response.output_audio.delta":
      if (!session.isSpeaking) {
        session.isSpeaking = true;
        console.log("[openai] >> Speaking status sent");
        send(session, { type: "status", state: "speaking" });
      }
      send(session, { type: "audio", data: (event.delta as string) ?? "" });
      break;

    case "response.audio_transcript.done":
    case "response.output_audio_transcript.done": {
      session.isSpeaking = false;
      const text = (event.transcript as string) ?? "";
      if (text.trim()) {
        console.log(`[openai] Jackie: ${text.slice(0, 100)}`);
        session.transcript.push(`**Jackie:** ${text}`);
        send(session, { type: "transcript", role: "assistant", text });
      }
      send(session, { type: "status", state: "listening" });
      break;
    }

    case "conversation.item.input_audio_transcription.completed":
    case "conversation.item.input_audio_transcription.done": {
      const text = (event.transcript as string) ?? "";
      if (text.trim()) {
        console.log(`[openai] Lily: ${text.slice(0, 100)}`);
        session.transcript.push(`**Lily:** ${text}`);
        send(session, { type: "transcript", role: "user", text });
      }
      break;
    }

    case "response.function_call_arguments.done": {
      const name = event.name as string;
      const callId = event.call_id as string;
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(event.arguments as string);
      } catch { /* empty */ }

      console.log(`[openai] Tool: ${name}(${JSON.stringify(args)})`);
      send(session, { type: "tool_call", name, args });
      send(session, { type: "status", state: "thinking" });

      executeTool(name, args, session).then((result) => {
        console.log(`[openai] Tool result: ${result.slice(0, 200)}`);
        send(session, { type: "tool_result", name, result });

        if (session.openaiWs?.readyState !== WebSocket.OPEN) {
          console.error("[openai] WebSocket closed before tool result could be sent back");
          return;
        }

        session.openaiWs.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: callId, output: result },
          })
        );
        session.openaiWs.send(JSON.stringify({ type: "response.create" }));
      });
      break;
    }

    case "error": {
      const err = event.error as Record<string, unknown> | undefined;
      if (err?.code === "response_cancel_not_active") break;
      console.error("[openai] Error:", JSON.stringify(err));
      send(session, { type: "error", error: err });
      break;
    }

    default: {
      const t = event.type as string;
      if (t && (t.includes("audio") && !t.includes("transcript"))) {
        console.log(`[openai] AUDIO event: ${t}`);
      } else if (t && !t.startsWith("response.audio.") && !t.startsWith("response.output_audio.") && t !== "input_audio_buffer.committed" && t !== "input_audio_buffer.speech_stopped" && t !== "response.created" && t !== "response.done" && t !== "conversation.item.created" && t !== "rate_limits.updated" && t !== "output_audio_buffer.started" && t !== "output_audio_buffer.stopped" && t !== "output_audio_buffer.cleared") {
        console.log(`[openai] Unhandled event: ${t}`);
      }
      break;
    }
  }
}

function executeTool(name: string, args: Record<string, string>, session: BrowserSession): Promise<string> {
  if (name === "use_cli") {
    return runBgBrain(args.task || "", session);
  }
  return Promise.resolve(`Unknown tool: ${name}`);
}


function getGeneratedFiles(): Set<string> {
  try {
    return new Set(readdirSync(GENERATED_DIR));
  } catch {
    return new Set();
  }
}

function flushNewVisuals(
  filesBefore: Set<string>,
  sentFiles: Set<string>,
  session: BrowserSession
): void {
  const current = getGeneratedFiles();
  for (const file of current) {
    if (!filesBefore.has(file) && !sentFiles.has(file) && file.endsWith(".html")) {
      sentFiles.add(file);
      console.log(`[cli] Detected new file: ${file}`);
      send(session, { type: "visual", url: `/generated/${file}` });
    }
  }
}

function runBgBrain(task: string, session: BrowserSession): Promise<string> {
  const filesBefore = getGeneratedFiles();

  const sentFiles = new Set<string>();
  const pollInterval = setInterval(() => flushNewVisuals(filesBefore, sentFiles, session), 2000);

  const augmented = `${task}\n\nChart rules: chart-first layout (large SVG hero, ≥360px tall), no outer container/card wrapper, no KPI tag panels — flat on white. Output HTML in a \`\`\`html code block (inline CSS/SVG only, light theme).`;
  console.log(`[cli] Sending to bg-brain: "${task.slice(0, 80)}"`);
  const body = JSON.stringify({ task: augmented });

  return new Promise((res) => {
    const req = http.request(BG_BRAIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 180000,
    }, (resp) => {
      let data = "";
      resp.on("data", (chunk) => (data += chunk));
      resp.on("end", () => {
        try {
          const { result, error, visualUrl } = JSON.parse(data);
          flushNewVisuals(filesBefore, sentFiles, session);
          if (visualUrl && !sentFiles.has(visualUrl.replace(/^\/generated\//, ""))) {
            const file = visualUrl.replace(/^\/generated\//, "");
            sentFiles.add(file);
            console.log(`[cli] Visual from bg-brain response: ${file}`);
            send(session, { type: "visual", url: visualUrl });
          }
          clearInterval(pollInterval);
          if (error) {
            console.error(`[cli] bg-brain error: ${error}`);
            res(`Error: ${error}`);
          } else {
            console.log(`[cli] bg-brain result: ${(result || "").slice(0, 200)}`);
            const prefix = sentFiles.size > 0 ? "[A visualization is now showing on the user's screen. Briefly describe what it shows.]\n\n" : "";
            res(prefix + (result || "No output."));
          }
        } catch {
          flushNewVisuals(filesBefore, sentFiles, session);
          clearInterval(pollInterval);
          res(data.slice(0, 4000) || "No output.");
        }
      });
    });

    req.on("error", (err) => {
      clearInterval(pollInterval);
      console.error(`[cli] bg-brain unreachable: ${err.message}`);
      res(`Error: Background brain not running. Start it with ./launch-bg-brain.sh`);
    });

    req.on("timeout", () => {
      clearInterval(pollInterval);
      req.destroy();
      res("Error: Background brain timed out.");
    });

    req.write(body);
    req.end();
  });
}

function send(session: BrowserSession, msg: Record<string, unknown>): void {
  if (session.browserWs.readyState === WebSocket.OPEN) {
    session.browserWs.send(JSON.stringify(msg));
  }
}
