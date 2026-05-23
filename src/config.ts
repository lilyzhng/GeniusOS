import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  openai: {
    apiKey: required("OPENAI_API_KEY"),
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
