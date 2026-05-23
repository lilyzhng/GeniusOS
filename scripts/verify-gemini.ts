import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("Missing GEMINI_API_KEY — add it to .env");
  process.exit(1);
}

const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const ai = new GoogleGenAI({ apiKey: key });

try {
  const response = await ai.models.generateContent({
    model,
    contents: "Reply with exactly: GEMINI_OK",
  });
  const text = response.text?.trim() ?? "";
  if (text.includes("GEMINI_OK")) {
    console.log(`OK — ${model} responded: ${text}`);
  } else {
    console.error(`Unexpected response from ${model}: ${text}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`Gemini API error: ${(err as Error).message}`);
  process.exit(1);
}
