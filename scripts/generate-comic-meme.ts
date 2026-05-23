import { config as loadEnv } from "dotenv";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("Missing GEMINI_API_KEY");
  process.exit(1);
}

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const ai = new GoogleGenAI({ apiKey: key });

const MEME_PROMPT = `You render comic-style memes as self-contained HTML inside a \`\`\`html code block.
- Inline CSS and inline SVG only. NO external scripts, CDN, or remote images.
- ~480px wide, centered. Dark comic panel background (#1a1a2e or similar).
- MUST include a large inline SVG illustration (≥280px tall): characters, props, speed lines, comic halftone dots optional.
- Bold meme captions: max 2 lines, uppercase, high contrast.
- No explanation text outside the meme. Output ONLY the html block.`;

const task =
  "Comic meme: Top caption 'WHEN GEMINI 3.5 FLASH SEES YOUR PROMPT' — draw a smug lightning-fast cat at a keyboard with speed lines and sparkles. Bottom caption 'ALREADY DONE. YOU WERE STILL TYPING.' — same cat leaning back with arms crossed, checkmark floating. xkcd-meets-meme energy.";

const response = await ai.models.generateContent({
  model: MODEL,
  contents: task,
  config: { systemInstruction: MEME_PROMPT },
});

const text = (response.text ?? "").trim();
const fenceMatch = text.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
const html = fenceMatch?.[1]?.trim() ?? text;
const out = resolve(__dirname, "../public/generated/meme-comic-demo.html");
writeFileSync(out, html.includes("<") ? html : `<html><body>${html}</body></html>`);
console.log(`Wrote ${out}`);
console.log("Has SVG:", /<svg/i.test(html));
