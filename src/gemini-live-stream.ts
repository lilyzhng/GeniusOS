import { GoogleGenAI, Modality, type Session, type LiveServerMessage, type FunctionDeclaration } from "@google/genai";

export interface GeminiLiveVoice {
  sendAudio(base64Pcm: string): void;
  sendSystemHint(text: string): void;
  sendToolResponse(id: string, name: string, result: string): void;
  updateInstructions(instructions: string): void;
  close(): void;
}

export interface GeminiLiveCallbacks {
  onReady: () => void;
  onAudioDelta: (base64Pcm: string) => void;
  onInputTranscript: (text: string) => void;
  onOutputTranscriptPartial?: (text: string) => void;
  onOutputTranscript: (text: string) => void;
  onToolCall: (name: string, args: Record<string, string>, id: string) => void;
  onSpeakingStart: () => void;
  onSpeakingEnd: () => void;
  onError: (message: string) => void;
}

interface TranscriptBuffers {
  input: string;
  output: string;
}

function appendTranscriptChunk(buffer: string, chunk: string): string {
  if (!chunk) return buffer;
  if (!buffer) return chunk;
  // Cumulative partial (new text extends prior) — replace, don't double-append.
  if (chunk.startsWith(buffer)) return chunk;
  // Delta partial — append with spacing when needed.
  const needsSpace = buffer && !/\s$/.test(buffer) && !/^[.,!?;:]/.test(chunk);
  return buffer + (needsSpace ? " " : "") + chunk;
}

function openAiToolToGeminiDecl(tool: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  };
}

export function buildGeminiToolDeclarations(
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
): FunctionDeclaration[] {
  return tools.map(openAiToolToGeminiDecl);
}

function extractAudioFromMessage(message: LiveServerMessage): string | null {
  const inline = message.serverContent?.modelTurn?.parts;
  if (inline) {
    for (const part of inline) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
        return part.inlineData.data;
      }
    }
  }
  const data = message.data;
  return data ?? null;
}

function flushTranscript(
  kind: "input" | "output",
  transcripts: TranscriptBuffers,
  cb: GeminiLiveCallbacks,
  opts?: { partial?: boolean; final?: boolean },
): void {
  const text = transcripts[kind].trim();
  if (!text) return;
  if (kind === "input") {
    cb.onInputTranscript(text);
    transcripts[kind] = "";
    return;
  }
  if (opts?.partial) cb.onOutputTranscriptPartial?.(text);
  if (opts?.final) {
    cb.onOutputTranscript(text);
    transcripts[kind] = "";
  }
}

function handleTranscription(
  kind: "input" | "output",
  transcription: { text?: string; finished?: boolean } | undefined,
  transcripts: TranscriptBuffers,
  cb: GeminiLiveCallbacks,
): void {
  if (!transcription?.text) return;
  transcripts[kind] = appendTranscriptChunk(transcripts[kind], transcription.text);
  if (kind === "output") {
    flushTranscript("output", transcripts, cb, { partial: true });
    return;
  }
}

function handleServerMessage(
  message: LiveServerMessage,
  cb: GeminiLiveCallbacks,
  transcripts: TranscriptBuffers,
): void {
  if (message.setupComplete) {
    console.log("[gemini-live] Setup complete");
    cb.onReady();
    return;
  }

  const content = message.serverContent;
  if (content?.interrupted) {
    cb.onSpeakingEnd();
    flushTranscript("output", transcripts, cb, { final: true });
  }

  if (content?.inputTranscription?.text?.trim()) {
    handleTranscription("input", content.inputTranscription, transcripts, cb);
  }

  if (content?.outputTranscription?.text?.trim()) {
    handleTranscription("output", content.outputTranscription, transcripts, cb);
  }

  const audio = extractAudioFromMessage(message);
  if (audio) {
    cb.onSpeakingStart();
    cb.onAudioDelta(audio);
  }

  if (content?.generationComplete) {
    cb.onSpeakingEnd();
    flushTranscript("output", transcripts, cb, { final: true });
  }

  if (content?.turnComplete) {
    flushTranscript("input", transcripts, cb);
  }

  const calls = message.toolCall?.functionCalls;
  if (calls?.length) {
    for (const fc of calls) {
      if (!fc.name) continue;
      const args: Record<string, string> = {};
      if (fc.args) {
        for (const [k, v] of Object.entries(fc.args)) {
          args[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
      }
      cb.onToolCall(fc.name, args, fc.id ?? fc.name);
    }
  }
}

export async function createGeminiLiveVoice(
  apiKey: string,
  model: string,
  instructions: string,
  toolDeclarations: FunctionDeclaration[],
  context: string | null,
  callbacks: GeminiLiveCallbacks,
): Promise<GeminiLiveVoice> {
  const ai = new GoogleGenAI({ apiKey });

  let liveSession: Session | null = null;
  let currentInstructions = instructions;
  const transcripts: TranscriptBuffers = { input: "", output: "" };

  liveSession = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: instructions,
      tools: [{ functionDeclarations: toolDeclarations }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => console.log("[gemini-live] Connected"),
      onmessage: (message: LiveServerMessage) => {
        handleServerMessage(message, callbacks, transcripts);
      },
      onerror: (event: ErrorEvent) => {
        const msg = event.message || "Gemini Live WebSocket error";
        console.error("[gemini-live]", msg);
        callbacks.onError(msg);
      },
      onclose: (event: CloseEvent) => {
        console.log("[gemini-live] Closed", event.code, event.reason);
      },
    },
  });

  if (context) {
    liveSession.sendClientContent({
      turns: [{
        role: "user",
        parts: [{
          text: `[System: Lily asked you to: ${context}. Wait for her to turn the radio on, then greet her briefly and start on this.]`,
        }],
      }],
      turnComplete: false,
    });
  }

  return {
    sendAudio(base64Pcm: string) {
      liveSession?.sendRealtimeInput({
        audio: { data: base64Pcm, mimeType: "audio/pcm;rate=24000" },
      });
    },
    sendSystemHint(text: string) {
      liveSession?.sendClientContent({
        turns: [{ role: "user", parts: [{ text: `[System: ${text}]` }] }],
        turnComplete: false,
      });
    },
    sendToolResponse(id: string, name: string, result: string) {
      liveSession?.sendToolResponse({
        functionResponses: { id, name, response: { output: result } },
      });
    },
    updateInstructions(instructions: string) {
      currentInstructions = instructions;
      liveSession?.sendClientContent({
        turns: [{ role: "user", parts: [{ text: `[System: Channel/context update — follow these instructions:\n${instructions}]` }] }],
        turnComplete: false,
      });
    },
    close() {
      try {
        liveSession?.close();
      } catch { /* ignore */ }
      liveSession = null;
    },
  };
}
