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
  onOutputTranscript: (text: string) => void;
  onToolCall: (name: string, args: Record<string, string>, id: string) => void;
  onSpeakingStart: () => void;
  onSpeakingEnd: () => void;
  onError: (message: string) => void;
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

function handleServerMessage(message: LiveServerMessage, cb: GeminiLiveCallbacks): void {
  if (message.setupComplete) {
    console.log("[gemini-live] Setup complete");
    cb.onReady();
    return;
  }

  const content = message.serverContent;
  if (content?.interrupted) {
    cb.onSpeakingEnd();
  }

  if (content?.inputTranscription?.text?.trim()) {
    cb.onInputTranscript(content.inputTranscription.text.trim());
  }

  if (content?.outputTranscription?.text?.trim()) {
    cb.onOutputTranscript(content.outputTranscription.text.trim());
  }

  const audio = extractAudioFromMessage(message);
  if (audio) {
    cb.onSpeakingStart();
    cb.onAudioDelta(audio);
  }

  if (content?.turnComplete || content?.generationComplete) {
    cb.onSpeakingEnd();
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
        handleServerMessage(message, callbacks);
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
