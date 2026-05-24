import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const voiceBackend = (process.env.VOICE_BACKEND ?? "openai") as "openai" | "gemini-live";

export const config = {
  voice: {
    backend: voiceBackend,
    liveModel: process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-native-audio-preview-12-2025",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  },
  brain: {
    backend: (process.env.BRAIN_BACKEND ?? "gemini") as "gemini" | "antigravity",
  },
  server: {
    port: parseInt(process.env.PORT ?? "3335", 10),
    authToken: process.env.BROWSER_AUTH_TOKEN ?? "",
  },
} as const;

if (config.voice.backend === "openai" && !config.openai.apiKey) {
  throw new Error("Missing OPENAI_API_KEY (required when VOICE_BACKEND=openai)");
}
if (config.voice.backend === "gemini-live" && !config.gemini.apiKey) {
  throw new Error("Missing GEMINI_API_KEY (required when VOICE_BACKEND=gemini-live)");
}
