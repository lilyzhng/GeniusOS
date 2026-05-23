import WebSocket from "ws";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import http from "node:http";
import { config } from "./config.js";
import { buildGeminiToolDeclarations, createGeminiLiveVoice, type GeminiLiveVoice } from "./gemini-live-stream.js";

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
- Lily toggles the radio on and off with the PTT button. When off, she cannot hear you.

You have a background brain (Gemini 3.5 Flash) for charts and data tasks. Agent Home is the workspace beside the walkie-talkie — windows pop up automatically when needed.

- use_cli — charts and data (opens a chart window when ready)
- make_meme — visual HTML memes with SVG illustrations (opens meme window on CH-04)
- play_music — plays music in Agent Home (real audio player, always works)
- open_text — show text in notes window (NOT for memes — use make_meme)
- play_video — play a video (opens a video window)
- set_volume — turn playback up/down or set a level (Jackie's voice + music)

When asked to visualize or chart something, use use_cli. When asked for a meme or joke image, ALWAYS call make_meme in that same turn — never just speak caption text without calling the tool. When asked to play music, ALWAYS call play_music in that same turn — never only talk about it. When asked to write something, use open_text with the full text.

Meme rules (critical):
- make_meme generates a VISUAL meme (SVG characters, scenes, panels) in Agent Home on CH-04 — not text-only captions.
- NEVER say "I'll put a meme line together", "Top/Bottom:", or read caption text aloud — call make_meme FIRST, then say one short line about what opened.
- NEVER say you cannot render images, cannot show pictures, or tell Lily to use imgflip, memegen, Canva, or any external meme generator.
- If Lily says the meme has no image or is text-only, call make_meme again with task asking for full SVG illustration.
- Do not read top/bottom caption text aloud as if that were the deliverable — the visual opens in the meme window.
- NEVER use open_text for meme captions. open_text is for notes/lists only. Memes always go through make_meme.

Volume rules:
- You CAN adjust volume with set_volume. It controls Jackie's voice and music in Agent Home.
- Volume has 3 levels: 1 (quiet), 2 (medium), 3 (loud). Music stays softer; Jackie's voice is boosted relative to music.

Music rules (critical):
- You CAN play music. play_music opens a working player beside the walkie-talkie.
- NEVER say you cannot play audio, cannot stream, or tell Lily to open Spotify/YouTube herself.
- Tracks: chill-lofi, chill-night, chill-ambient | focus-deep, focus-flow | hype-energy, hype-synth | ambient-space | walk-stroll | jazz-cafe
- Vibes map to categories: chill, focus, hype, ambient, walk, jazz. Use track for a specific song, or vibe to pick from that category.
- If Lily asks to switch music or try something different, call play_music with a different track or vibe.
- Call play_music on ANY channel when Lily asks for music. Music keeps playing when charts open — they are independent.

When a tool returns a result, never read it verbatim. Paraphrase in one or two short sentences.`;

const CHANNEL_HINTS: Record<string, string> = {
  charts: "Active channel: CH-01 Charts. Prefer use_cli for charts. If Lily asks for music, call play_music.",
  audio: "Active channel: CH-02 Audio. Tracks: chill-lofi, chill-night, focus-deep, hype-energy, jazz-cafe, walk-stroll, ambient-space. play_music switches tracks; music keeps playing in background when charts open.",
  video: "Active channel: CH-03 Video. Prefer play_video for video. If Lily asks for music on any channel, call play_music.",
  memes: "Active channel: CH-04 Memes. You MUST call make_meme for any meme, joke, or comic request — never speak caption text instead.",
};

function buildInstructions(mode: string): string {
  const hint = CHANNEL_HINTS[mode] ?? CHANNEL_HINTS.charts;
  return `${SYSTEM_PROMPT}\n\n${hint}`;
}

const toolDefinitions = [
  {
    type: "function" as const,
    name: "use_cli",
    description: "Send a task to Gemini brain for charts and data analysis.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task to perform" },
      },
      required: ["task"],
    },
  },
  {
    type: "function" as const,
    name: "make_meme",
    description: "REQUIRED when Lily asks for a meme, comic, or joke image. Generates a VISUAL HTML meme with inline SVG via Gemini brain. Opens on CH-04. Never substitute by speaking Top/Bottom caption text.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "Full meme brief: joke, captions, characters, scenario" },
        prompt: { type: "string", description: "Alias for task" },
      },
      required: ["task"],
    },
  },
  {
    type: "function" as const,
    name: "play_music",
    description: "REQUIRED when Lily asks to play or switch music. Opens a persistent player in Agent Home. Music keeps playing while charts are open.",
    parameters: {
      type: "object",
      properties: {
        vibe: {
          type: "string",
          enum: ["focus", "chill", "hype", "ambient", "walk", "jazz"],
          description: "Music category. chill=relaxing lofi, focus=study, hype=energy, ambient=atmospheric, walk=light stroll, jazz=smooth jazz.",
        },
        track: {
          type: "string",
          description: "Specific track id: chill-lofi, chill-night, chill-ambient, focus-deep, focus-flow, hype-energy, hype-synth, ambient-space, walk-stroll, jazz-cafe",
        },
        query: { type: "string", description: "What Lily said, for vibe/track mapping" },
      },
    },
  },
  {
    type: "function" as const,
    name: "open_text",
    description: "Open a notes window with text. For summaries and lists ONLY — never for memes (use make_meme instead).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Window title" },
        content: { type: "string", description: "The full text to show" },
      },
      required: ["content"],
    },
  },
  {
    type: "function" as const,
    name: "play_video",
    description: "Open a video in the video window. Use on CH-03 or when Lily asks to play or show a video.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Video title" },
        url: { type: "string", description: "Optional video URL" },
      },
    },
  },
  {
    type: "function" as const,
    name: "set_volume",
    description: "Adjust playback volume (levels 1–3) when Lily asks to turn up/down volume. Affects Jackie's voice and music.",
    parameters: {
      type: "object",
      properties: {
        change: {
          type: "string",
          enum: ["up", "down", "set"],
          description: "up or down for relative steps; set for absolute level",
        },
        level: {
          type: "number",
          description: "Target volume 0-100 when change is set (e.g. 50 for half)",
        },
      },
      required: ["change"],
    },
  },
];

interface BrowserSession {
  browserWs: WebSocket;
  openaiWs: WebSocket | null;
  geminiVoice: GeminiLiveVoice | null;
  voiceBackend: "openai" | "gemini-live";
  transcript: string[];
  isSpeaking: boolean;
  mutemic: boolean;
  channelMode: string;
  capabilitiesSent: boolean;
  lastAutoMusicAt: number;
  lastAutoVolumeAt: number;
  lastAutoMemeAt: number;
  lastMemeToolAt: number;
  lastUserText: string;
  pendingMemeRequest: boolean;
  memeInFlight: Promise<string> | null;
  volumeLevel: number;
}

export function handleBrowserStream(browserWs: WebSocket): void {
  const session: BrowserSession = {
    browserWs,
    openaiWs: null,
    geminiVoice: null,
    voiceBackend: config.voice.backend,
    isSpeaking: false,
    mutemic: false,
    transcript: [],
    channelMode: "charts",
    capabilitiesSent: false,
    lastAutoMusicAt: 0,
    lastAutoVolumeAt: 0,
    lastAutoMemeAt: 0,
    lastMemeToolAt: 0,
    lastUserText: "",
    pendingMemeRequest: false,
    memeInFlight: null,
    volumeLevel: 1,
  };

  browserWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case "start":
        console.log("[browser] Session start", msg.channel ?? "CH-01", msg.mode ?? "charts");
        session.channelMode = msg.mode ?? "charts";
        session.capabilitiesSent = false;
        session.lastAutoMusicAt = 0;
        connectVoice(session, msg.context ?? null);
        send(session, { type: "status", state: "listening" });
        break;

      case "channel":
        session.channelMode = msg.mode ?? "charts";
        console.log(`[browser] Channel → ${msg.channel} (${session.channelMode})`);
        updateChannelInstructions(session);
        break;

      case "audio":
        if (!session.mutemic) {
          sendVoiceAudio(session, msg.data as string);
        }
        break;

      case "stop":
        console.log("[browser] Session stop");
        closeVoiceSession(session);
        break;
    }
  });

  browserWs.on("close", () => {
    console.log("[browser] WebSocket closed");
    closeVoiceSession(session);
  });

  browserWs.on("error", (err) => {
    console.error("[browser] WebSocket error:", err.message);
  });
}

function sessionConfig(mode: string) {
  return {
    type: "realtime" as const,
    instructions: buildInstructions(mode),
    tools: toolDefinitions,
    tool_choice: "auto" as const,
  };
}

function updateChannelInstructions(session: BrowserSession): void {
  const instructions = buildInstructions(session.channelMode);
  if (session.voiceBackend === "gemini-live") {
    session.geminiVoice?.updateInstructions(instructions);
    return;
  }
  if (session.openaiWs?.readyState !== WebSocket.OPEN) return;
  session.openaiWs.send(
    JSON.stringify({
      type: "session.update",
      session: sessionConfig(session.channelMode),
    })
  );
}

function closeVoiceSession(session: BrowserSession): void {
  if (session.openaiWs?.readyState === WebSocket.OPEN) {
    session.openaiWs.close();
  }
  session.openaiWs = null;
  session.geminiVoice?.close();
  session.geminiVoice = null;
}

function sendVoiceAudio(session: BrowserSession, base64: string): void {
  if (session.voiceBackend === "gemini-live") {
    session.geminiVoice?.sendAudio(base64);
    return;
  }
  if (session.openaiWs?.readyState === WebSocket.OPEN) {
    session.openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
  }
}

function sendVoiceSystemHint(session: BrowserSession, text: string): void {
  if (session.voiceBackend === "gemini-live") {
    session.geminiVoice?.sendSystemHint(text);
    return;
  }
  if (session.openaiWs?.readyState !== WebSocket.OPEN) return;
  session.openaiWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: `[System: ${text}]` }],
      },
    })
  );
}

function sendVoiceToolResult(session: BrowserSession, callId: string, name: string, result: string): void {
  if (session.voiceBackend === "gemini-live") {
    session.geminiVoice?.sendToolResponse(callId, name, result);
    return;
  }
  if (session.openaiWs?.readyState !== WebSocket.OPEN) return;
  session.openaiWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: result },
    })
  );
  session.openaiWs.send(JSON.stringify({ type: "response.create" }));
}

function handleUserTranscript(session: BrowserSession, text: string): void {
  if (!text.trim()) return;
  console.log(`[voice] Lily: ${text.slice(0, 100)}`);
  session.lastUserText = text;
  session.transcript.push(`**Lily:** ${text}`);
  send(session, { type: "transcript", role: "user", text });
  if (matchesMusicIntent(text)) {
    autoPlayMusic(session, text);
  } else if (matchesVolumeIntent(text)) {
    autoAdjustVolume(session, text);
  } else if (matchesMemeVisualRetryIntent(text)) {
    autoMakeMeme(session, text, buildMemeVisualRetryTask(text));
  } else if (matchesMemeIntent(text)) {
    session.pendingMemeRequest = true;
    autoMakeMeme(session, text);
  }
}

function handleAssistantTranscript(session: BrowserSession, text: string): void {
  if (!text.trim()) return;
  console.log(`[voice] Jackie: ${text.slice(0, 100)}`);
  session.transcript.push(`**Jackie:** ${text}`);
  send(session, { type: "transcript", role: "assistant", text });
  if (matchesJackieSpokeMemeInsteadOfTool(text) && !recentMemeActivity(session)) {
    const task = buildMemeTaskFromJackieCaption(session.lastUserText, text);
    console.log("[browser] Jackie spoke meme captions without tool — auto make_meme");
    autoMakeMeme(session, text, task);
  }
}

function processToolCall(
  session: BrowserSession,
  name: string,
  args: Record<string, string>,
  callId: string,
): void {
  console.log(`[voice] Tool: ${name}(${JSON.stringify(args)})`);
  send(session, { type: "tool_call", name, args });
  send(session, { type: "status", state: "thinking" });

  executeTool(name, args, session).then((result) => {
    console.log(`[voice] Tool result: ${result.slice(0, 200)}`);
    send(session, { type: "tool_result", name, result });

    if (session.voiceBackend === "openai" && session.openaiWs?.readyState !== WebSocket.OPEN) {
      console.error("[openai] WebSocket closed before tool result could be sent back");
      return;
    }
    if (session.voiceBackend === "gemini-live" && !session.geminiVoice) {
      console.error("[gemini-live] Session closed before tool result could be sent back");
      return;
    }

    sendVoiceToolResult(session, callId, name, result);
  });
}

function connectVoice(session: BrowserSession, context: string | null): void {
  if (session.voiceBackend === "gemini-live") {
    void connectGeminiLive(session, context);
    return;
  }
  connectOpenAI(session, context);
}

async function connectGeminiLive(session: BrowserSession, context: string | null): Promise<void> {
  console.log(`[gemini-live] Connecting (${config.voice.liveModel})...`);
  try {
    session.geminiVoice = await createGeminiLiveVoice(
      config.gemini.apiKey,
      config.voice.liveModel,
      buildInstructions(session.channelMode),
      buildGeminiToolDeclarations(toolDefinitions),
      context,
      {
        onReady: () => {
          console.log("[gemini-live] Session ready");
          sendGeminiToolCapabilities(session);
          send(session, { type: "status", state: "listening" });
        },
        onAudioDelta: (base64) => {
          if (!session.isSpeaking) {
            session.isSpeaking = true;
            send(session, { type: "status", state: "speaking" });
          }
          send(session, { type: "audio", data: base64 });
        },
        onInputTranscript: (text) => handleUserTranscript(session, text),
        onOutputTranscript: (text) => {
          session.isSpeaking = false;
          handleAssistantTranscript(session, text);
          send(session, { type: "status", state: "listening" });
        },
        onToolCall: (name, args, id) => {
          let toolName = name;
          let toolArgs = args;
          const memeRedirect = redirectOpenTextToMeme(name, args, session);
          if (memeRedirect) {
            toolName = memeRedirect.name;
            toolArgs = memeRedirect.args;
          }
          processToolCall(session, toolName, toolArgs, id);
        },
        onSpeakingStart: () => {
          if (!session.isSpeaking) {
            session.isSpeaking = true;
            send(session, { type: "status", state: "speaking" });
          }
        },
        onSpeakingEnd: () => {
          session.isSpeaking = false;
        },
        onError: (message) => {
          send(session, { type: "error", error: { message } });
        },
      },
    );
  } catch (err) {
    console.error("[gemini-live] Connect failed:", (err as Error).message);
    send(session, { type: "error", error: { message: (err as Error).message } });
  }
}

function sendGeminiToolCapabilities(session: BrowserSession): void {
  if (session.capabilitiesSent) return;
  session.capabilitiesSent = true;
  sendVoiceSystemHint(
    session,
    "Tool reminder: you have working tools — play_music, use_cli (charts), make_meme (visual SVG on CH-04), play_video, open_text, set_volume. When Lily asks for music you MUST call play_music. When she asks for a meme you MUST call make_meme.",
  );
}

function sendToolCapabilities(session: BrowserSession): void {
  if (session.capabilitiesSent || session.openaiWs?.readyState !== WebSocket.OPEN) return;
  session.capabilitiesSent = true;
  session.openaiWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{
          type: "input_text",
          text: [
            "Tool reminder: you have working tools in this app.",
            "play_music(vibe, track?) — persistent music player; tracks: chill-lofi, chill-night, focus-deep, hype-energy, jazz-cafe, etc.",
            "use_cli(task) — charts via Gemini brain.",
            "make_meme(task) — REQUIRED for memes; visual SVG on CH-04. Never speak Top/Bottom captions instead.",
            "play_video — video window.",
            "open_text — notes window.",
            "set_volume(change: up|down|set, level?) — Jackie's voice + music volume.",
            "When Lily asks to play music, you MUST call play_music. When Lily asks for a meme, you MUST call make_meme. You are not a generic chatbot without tools.",
          ].join(" "),
        }],
      },
    })
  );
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
          ...sessionConfig(session.channelMode),
          model: "gpt-realtime-2",
          output_modalities: ["audio"],
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
        },
      })
    );

    if (context) {
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: `[System: Lily asked you to: ${context}. Wait for her to turn the radio on, then greet her briefly and start on this.]`,
            }],
          },
        })
      );
    }
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
      sendToolCapabilities(session);
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
      handleAssistantTranscript(session, (event.transcript as string) ?? "");
      send(session, { type: "status", state: "listening" });
      break;
    }

    case "conversation.item.input_audio_transcription.completed":
    case "conversation.item.input_audio_transcription.done": {
      handleUserTranscript(session, (event.transcript as string) ?? "");
      break;
    }

    case "response.function_call_arguments.done": {
      let name = event.name as string;
      const callId = event.call_id as string;
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(event.arguments as string);
      } catch { /* empty */ }

      const memeRedirect = redirectOpenTextToMeme(name, args, session);
      if (memeRedirect) {
        name = memeRedirect.name;
        args = memeRedirect.args;
      }

      processToolCall(session, name, args, callId);
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

function normalizeVibe(raw: string): string {
  const key = raw.toLowerCase().trim();
  if (key.includes("focus") || key.includes("work") || key.includes("study")) return "focus";
  if (
    key.includes("hype") ||
    key.includes("upbeat") ||
    key.includes("energy") ||
    key.includes("party") ||
    key.includes("hackathon") ||
    key.includes("synth") ||
    key.includes("cyber") ||
    key.includes("sci-fi") ||
    key.includes("scrappy")
  ) return "hype";
  if (key.includes("chill") || key.includes("lofi") || key.includes("lo-fi") || key.includes("relax")) return "chill";
  if (key === "focus" || key === "chill" || key === "hype") return key;
  return "hype";
}

function matchesMusicIntent(text: string): boolean {
  const t = text.toLowerCase();
  if (/\bplay\b.*\b(music|song|vibe|playlist|beats|lofi|lo-fi)\b/.test(t)) return true;
  if (/\b(music|song|playlist|vibe|beats)\b.*\b(play|please|for me)\b/.test(t)) return true;
  if (/\b(put on|start|cue|queue)\b.*\b(music|song|playlist|beats)\b/.test(t)) return true;
  if (/\bplay some music\b/.test(t)) return true;
  if (/\bsome music\b/.test(t) && /\b(play|could you|can you|please)\b/.test(t)) return true;
  return false;
}

function looksLikeMemeContent(text: string): boolean {
  if (!text.trim()) return false;
  const t = text.toLowerCase();
  if (/\b(top|bottom)\s*(text|:)/.test(t)) return true;
  if (/\bmeme\b/.test(t)) return true;
  if (/\bwhen .+ but .+/.test(t)) return true;
  if (/\buse this:\s*/.test(t) && (/\btop\b/.test(t) || /\bbottom\b/.test(t))) return true;
  return false;
}

function redirectOpenTextToMeme(
  name: string,
  args: Record<string, string>,
  session: BrowserSession,
): { name: string; args: Record<string, string> } | null {
  if (name !== "open_text") return null;
  const combined = [args.title, args.content].filter(Boolean).join("\n");
  if (!looksLikeMemeContent(combined) && !session.pendingMemeRequest) return null;
  if (recentMemeActivity(session)) {
    console.log("[browser] Blocked open_text for meme — make_meme already active");
    return { name: "__meme_already_running", args: {} };
  }
  console.log("[browser] Redirecting open_text → make_meme");
  session.pendingMemeRequest = true;
  return {
    name: "make_meme",
    args: { task: buildMemeTaskFromJackieCaption(session.lastUserText, combined) },
  };
}

function matchesMemeIntent(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(make|create|generate|draw|show|do|give me|put|need)\b.*\b(meme|memeify|meme-style|comic)\b/.test(t)) return true;
  if (/\b(meme|meme-style|comic)\b.*\b(about|of|for|with|on|please)\b/.test(t)) return true;
  if (/\bmeme\b/.test(t)) return true;
  if (/\b(funny|joke|roast)\b.*\b(about|on|for)\b/.test(t)) return true;
  if (/\b(gemini|flash|prompt|typing|fast)\b.*\b(meme|funny|joke|comic)\b/.test(t)) return true;
  if (/\b(meme|funny|joke|comic)\b.*\b(gemini|flash|prompt)\b/.test(t)) return true;
  return false;
}

function matchesJackieSpokeMemeInsteadOfTool(text: string): boolean {
  const t = text.toLowerCase();
  if (/\btop:\s*.+/.test(t) && /\bbottom:\s*.+/.test(t)) return true;
  if (/\btop\s*text\b/.test(t) && /\bbottom\s*text\b/.test(t)) return true;
  if (/\buse this:\s*.+\btop\b/.test(t) && /\bbottom\b/.test(t)) return true;
  if (/\btagline:\s*.+/.test(t) && (/\btop\b/.test(t) || /\bbottom\b/.test(t))) return true;
  if (/\bmeme-style line\b/.test(t)) return true;
  if (/\b(put|pull|spin).*(meme|caption|idea).*together\b/.test(t)) return true;
  if (looksLikeMemeContent(text)) return true;
  return false;
}

function recentMemeActivity(session: BrowserSession, windowMs = 8000): boolean {
  const now = Date.now();
  return now - session.lastAutoMemeAt < windowMs || now - session.lastMemeToolAt < windowMs;
}

function buildMemeTaskFromJackieCaption(userText: string, jackieText: string): string {
  const parts = [userText, jackieText].filter(Boolean);
  return `${parts.join(" — ")} — render as horizontal two-panel SVG comic meme on CH-04, not spoken captions.`;
}

function matchesMemeVisualRetryIntent(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(where('s| is)|missing)\b.*\b(image|picture|visual|drawing|graphic)\b/.test(t)) return true;
  if (/\b(only|just)\b.*\b(text|words|caption)\b/.test(t) && /\b(meme|image|picture|show)\b/.test(t)) return true;
  if (/\bno image\b/.test(t) || /\btext only\b/.test(t)) return true;
  if (/\bneed\b.*\b(image|picture|visual|drawing)\b/.test(t)) return true;
  return false;
}

function buildMemeVisualRetryTask(userText: string): string {
  return `${userText} — regenerate the meme with a large central SVG illustration (character + scene, speed lines, props). Text-only captions are invalid.`;
}

const VOLUME_LEVEL_MIN = 1;
const VOLUME_LEVEL_MAX = 3;

function adjustVolumeLevel(current: number, change: string, level?: number): number {
  if (change === "set" && level != null && !Number.isNaN(level)) {
    if (level <= 40) return 1;
    if (level <= 70) return 2;
    return 3;
  }
  if (change === "up") return Math.min(VOLUME_LEVEL_MAX, current + 1);
  if (change === "down") return Math.max(VOLUME_LEVEL_MIN, current - 1);
  return current;
}

function matchesVolumeIntent(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(too loud|too quiet|can't hear|cannot hear|hard to hear)\b/.test(t)) return true;
  if (/\b(turn (it )?(down|up|lower|higher))\b/.test(t)) return true;
  if (/\b(louder|quieter|soften)\b/.test(t)) return true;
  if (/\b(reduce|lower|increase|raise|adjust).*\b(volume|sound|audio)\b/.test(t)) return true;
  if (/\b(volume|sound level)\b/.test(t) && /\b(down|up|lower|reduce|increase|set|adjust)\b/.test(t)) return true;
  return false;
}

function inferVolumeChange(text: string): { change: string; level?: number } {
  const t = text.toLowerCase();
  const pctMatch = t.match(/(\d+)\s*(?:%|percent)/);
  if (pctMatch) return { change: "set", level: Number(pctMatch[1]) };
  if (/\bhalf\b/.test(t) && /\b(volume|quiet|loud)\b/.test(t)) return { change: "set", level: 50 };
  if (/\b(too loud|quieter|turn (it )?down|lower|reduce|soften|decrease|a little less)\b/.test(t)) {
    return { change: "down" };
  }
  if (/\b(too quiet|louder|turn (it )?up|increase|raise|a little more)\b/.test(t)) {
    return { change: "up" };
  }
  return { change: "down" };
}

function autoAdjustVolume(session: BrowserSession, userText: string): void {
  const now = Date.now();
  if (now - session.lastAutoVolumeAt < 2000) return;
  session.lastAutoVolumeAt = now;

  const { change, level } = inferVolumeChange(userText);
  session.volumeLevel = adjustVolumeLevel(session.volumeLevel, change, level);
  console.log(`[browser] Auto set_volume from intent: "${userText}" → level ${session.volumeLevel}`);
  send(session, { type: "tool_call", name: "set_volume", args: { change, level } });
  send(session, { type: "volume", change, level, volumeLevel: session.volumeLevel });
  send(session, { type: "tool_result", name: "set_volume", result: `Volume level ${session.volumeLevel} of 3.` });

  sendVoiceSystemHint(
    session,
    `set_volume already ran — now at level ${session.volumeLevel} of 3. Acknowledge briefly. Do not say you cannot control volume.`,
  );
}

function autoPlayMusic(session: BrowserSession, userText: string): void {
  const now = Date.now();
  if (now - session.lastAutoMusicAt < 4000) return;
  session.lastAutoMusicAt = now;

  const vibe = normalizeVibe(userText);
  console.log(`[browser] Auto play_music from intent: "${userText}" → ${vibe}`);
  send(session, { type: "tool_call", name: "play_music", args: { query: userText } });
  send(session, { type: "music", query: userText });
  send(session, { type: "tool_result", name: "play_music", result: `Now playing ${vibe} vibe in Agent Home.` });

  sendVoiceSystemHint(
    session,
    `play_music already ran — ${vibe} is playing in Agent Home. Acknowledge in one short sentence. Do not say you cannot play music or tell Lily to use another app.`,
  );
}

const MEME_BG_OPTS: BgBrainOpts = {
  kind: "meme",
  filePrefix: "meme",
  msgType: "meme",
  augment: "Meme rules: horizontal two-panel comic (left setup, right punchline) side-by-side in ~480px. MUST include large inline SVG illustration per panel (character/scene, ≥220px tall). NOT text-only captions. Output HTML in a ```html code block (inline CSS/SVG only).",
  doneHint: "[A visual meme with SVG illustration just opened on CH-04. Describe the drawing in one short sentence. NEVER say you cannot render images or suggest external meme generators.]\n\n",
  urlKey: "memeUrl",
};

function startMemeGeneration(session: BrowserSession, task: string): Promise<string> {
  if (session.memeInFlight) {
    console.log("[browser] make_meme already in flight — joining existing request");
    return session.memeInFlight;
  }
  session.lastMemeToolAt = Date.now();
  session.pendingMemeRequest = true;
  notifyMemeGenerating(session);
  session.memeInFlight = runBgBrain(task, session, MEME_BG_OPTS).finally(() => {
    session.memeInFlight = null;
    session.pendingMemeRequest = false;
  });
  return session.memeInFlight;
}

function autoMakeMeme(session: BrowserSession, userText: string, taskOverride?: string): void {
  const now = Date.now();
  if (now - session.lastAutoMemeAt < 5000 && session.memeInFlight) return;
  session.lastAutoMemeAt = now;
  session.pendingMemeRequest = true;

  const task = taskOverride ?? userText;
  console.log(`[browser] Auto make_meme from intent: "${userText}"`);
  send(session, { type: "tool_call", name: "make_meme", args: { task } });
  send(session, { type: "status", state: "thinking" });

  startMemeGeneration(session, task).then((result) => {
    send(session, { type: "tool_result", name: "make_meme", result });
    sendVoiceSystemHint(
      session,
      "make_meme already ran — a visual meme with SVG illustration opened on CH-04. Describe what you see in one short sentence. NEVER say you cannot render images or tell Lily to use an external meme generator.",
    );
    if (session.voiceBackend === "openai" && session.openaiWs?.readyState === WebSocket.OPEN) {
      session.openaiWs.send(JSON.stringify({ type: "response.create" }));
    }
  });
}

function notifyMemeGenerating(session: BrowserSession): void {
  sendVoiceSystemHint(
    session,
    "make_meme is generating a visual SVG meme on CH-04. Do NOT call open_text. Do NOT speak Top/Bottom caption text. Say one short line like 'Meme coming up on CH-04' or stay quiet.",
  );
}

function executeTool(name: string, args: Record<string, string>, session: BrowserSession): Promise<string> {
  if (name === "__meme_already_running") {
    return Promise.resolve("Meme is already generating on CH-04.");
  }
  if (name === "use_cli") {
    return runBgBrain(args.task || "", session, {
      kind: "chart",
      filePrefix: "viz",
      msgType: "visual",
      augment: "Chart rules: chart-first layout (large SVG hero, ≥360px tall), no outer container/card wrapper, no KPI tag panels — flat on white. Output HTML in a ```html code block (inline CSS/SVG only, light theme).",
      doneHint: "[A chart window just opened beside the walkie-talkie. Briefly describe what it shows.]\n\n",
      urlKey: "visualUrl",
    });
  }
  if (name === "make_meme") {
    return startMemeGeneration(session, args.task || args.prompt || "");
  }
  if (name === "play_music") {
    session.lastAutoMusicAt = Date.now();
    const vibe = args.vibe || "";
    const track = args.track || "";
    const query = args.query || args.vibe || "";
    console.log(`[browser] play_music → vibe=${vibe} track=${track}`);
    send(session, { type: "music", vibe, track, query });
    const label = track || vibe || "music";
    return Promise.resolve(`Now playing ${label} in Agent Home (keeps playing in background).`);
  }
  if (name === "open_text") {
    const content = args.content || "";
    const combined = [args.title, content].filter(Boolean).join("\n");
    if (looksLikeMemeContent(combined) || session.pendingMemeRequest) {
      console.log("[browser] open_text blocked for meme content — use make_meme");
      if (recentMemeActivity(session)) {
        return Promise.resolve("Meme is already generating on CH-04.");
      }
      return startMemeGeneration(session, buildMemeTaskFromJackieCaption(session.lastUserText, combined));
    }
    send(session, { type: "text", title: args.title || "Notes", content });
    return Promise.resolve("Opened notes with the content.");
  }
  if (name === "play_video") {
    send(session, { type: "video", title: args.title || "Video", url: args.url || "" });
    return Promise.resolve("Video is playing.");
  }
  if (name === "set_volume") {
    const change = args.change || "up";
    const level = args.level != null ? Number(args.level) : undefined;
    session.volumeLevel = adjustVolumeLevel(session.volumeLevel, change, level);
    send(session, { type: "volume", change, level, volumeLevel: session.volumeLevel });
    return Promise.resolve(`Volume level ${session.volumeLevel} of 3.`);
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

interface BgBrainOpts {
  kind: "chart" | "meme";
  filePrefix: string;
  msgType: string;
  augment: string;
  doneHint: string;
  urlKey: "visualUrl" | "memeUrl";
}

function flushNewGenerated(
  filesBefore: Set<string>,
  sentFiles: Set<string>,
  session: BrowserSession,
  filePrefix: string,
  msgType: string,
): void {
  const current = getGeneratedFiles();
  for (const file of current) {
    if (!file.startsWith(filePrefix) || !file.endsWith(".html")) continue;
    if (!filesBefore.has(file) && !sentFiles.has(file)) {
      sentFiles.add(file);
      console.log(`[cli] Detected new file: ${file}`);
      send(session, { type: msgType, url: `/generated/${file}` });
    }
  }
}

function runBgBrain(task: string, session: BrowserSession, opts: BgBrainOpts): Promise<string> {
  const filesBefore = getGeneratedFiles();

  const sentFiles = new Set<string>();
  const pollInterval = setInterval(
    () => flushNewGenerated(filesBefore, sentFiles, session, opts.filePrefix, opts.msgType),
    2000,
  );

  const augmented = `${task}\n\n${opts.augment}`;
  console.log(`[cli] Sending to bg-brain (${opts.kind}): "${task.slice(0, 80)}"`);
  const body = JSON.stringify({ task: augmented, kind: opts.kind });

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
          const parsed = JSON.parse(data);
          const { result, error } = parsed;
          const assetUrl = parsed[opts.urlKey] as string | undefined;
          flushNewGenerated(filesBefore, sentFiles, session, opts.filePrefix, opts.msgType);
          if (assetUrl) {
            const file = assetUrl.replace(/^\/generated\//, "");
            if (!sentFiles.has(file)) {
              sentFiles.add(file);
              console.log(`[cli] ${opts.kind} from bg-brain response: ${file}`);
              send(session, { type: opts.msgType, url: assetUrl });
            }
          }
          clearInterval(pollInterval);
          if (error) {
            console.error(`[cli] bg-brain error: ${error}`);
            if (sentFiles.size > 0) {
              res(opts.doneHint + (result || "Meme opened."));
            } else {
              res(`Error: ${error}`);
            }
          } else {
            console.log(`[cli] bg-brain result: ${(result || "").slice(0, 200)}`);
            const prefix = sentFiles.size > 0 ? opts.doneHint : "";
            res(prefix + (result || "No output."));
          }
        } catch {
          flushNewGenerated(filesBefore, sentFiles, session, opts.filePrefix, opts.msgType);
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
