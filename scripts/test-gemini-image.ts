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

const ai = new GoogleGenAI({ apiKey: key });
const PROMPT =
  "Generate a simple meme image: a cat typing furiously at a keyboard with speed lines. Keep it cartoonish.";

function inspectResponse(label: string, response: Record<string, unknown>) {
  const candidate = (response?.candidates as Record<string, unknown>[] | undefined)?.[0];
  const parts = ((candidate?.content as Record<string, unknown> | undefined)?.parts ??
    []) as Record<string, unknown>[];
  let text = "";
  let images = 0;
  for (const p of parts) {
    if (typeof p.text === "string") text += p.text;
    const inline = p.inlineData as { mimeType?: string } | undefined;
    if (inline?.mimeType?.startsWith("image/")) images++;
  }
  console.log(`\n=== ${label} ===`);
  console.log("text:", text.slice(0, 300) || "(none)");
  console.log("image parts:", images);
  console.log("finishReason:", candidate?.finishReason ?? "(none)");
  if (response.promptFeedback) {
    console.log("promptFeedback:", JSON.stringify(response.promptFeedback));
  }
  return { text, images };
}

async function testModel(model: string, withImageModality: boolean) {
  const label = `${model}${withImageModality ? " + responseModalities[TEXT,IMAGE]" : ""}`;
  try {
    const response = await ai.models.generateContent({
      model,
      contents: PROMPT,
      config: withImageModality ? { responseModalities: ["TEXT", "IMAGE"] } : undefined,
    });
    return inspectResponse(label, response as unknown as Record<string, unknown>);
  } catch (err) {
    console.log(`\n=== ${label} ===`);
    console.log("ERROR:", (err as Error).message);
    return null;
  }
}

console.log("Testing Gemini image generation...");
await testModel("gemini-3.5-flash", false);
await testModel("gemini-3.5-flash", true);
await testModel("gemini-2.5-flash-image", true);
await testModel("gemini-3.1-flash-image-preview", true);
