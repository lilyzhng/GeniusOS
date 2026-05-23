import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("Missing GEMINI_API_KEY — add it to .env");
  process.exit(1);
}

const model = process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-native-audio-preview-12-2025";
const ai = new GoogleGenAI({ apiKey: key });

console.log(`Connecting to Gemini Live (${model})...`);

let gotSetup = false;
const timeout = setTimeout(() => {
  if (!gotSetup) {
    console.error("Timeout — no setupComplete within 15s");
    process.exit(1);
  }
}, 15000);

try {
  await ai.live.connect({
    model,
    config: { responseModalities: [Modality.AUDIO] },
    callbacks: {
      onopen: () => console.log("WebSocket open"),
      onmessage: (message: LiveServerMessage) => {
        if (message.setupComplete) {
          gotSetup = true;
          clearTimeout(timeout);
          console.log(`OK — Gemini Live connected (${model})`);
          process.exit(0);
        }
      },
      onerror: (e: ErrorEvent) => {
        clearTimeout(timeout);
        console.error(`Gemini Live error: ${e.message}`);
        process.exit(1);
      },
      onclose: () => {},
    },
  });
} catch (err) {
  clearTimeout(timeout);
  console.error(`Gemini Live connect failed: ${(err as Error).message}`);
  process.exit(1);
}
