import { createServer } from "node:http";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { config as loadEnv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const DATA_DIR = resolve(__dirname, "../data");
const GENERATED_DIR = resolve(__dirname, "../public/generated");
const PORT = 3336;
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const BACKEND = (process.env.BRAIN_BACKEND ?? "gemini") as "gemini" | "antigravity";

mkdirSync(GENERATED_DIR, { recursive: true });

const dataFiles = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const content = readFileSync(resolve(DATA_DIR, f), "utf-8");
    return `=== ${f} ===\n${content}`;
  })
  .join("\n\n");

const SYSTEM_PROMPT = `You are a background brain for a voice assistant.

LOCAL DATA (use directly, do NOT search the web for this data):
${dataFiles}

For non-visual tasks: reply in plain text, concise and spoken-friendly.`;

const PLAN_PROMPT = `${SYSTEM_PROMPT}

You are planning a visualization — not drawing it yet.

Read the local data and the user's request. Decide what insight matters and the best chart layout to show it.

Use judgment, not templates:
- Same time period, comparing how metrics moved together (e.g. revenue vs EBITDA by quarter)? Overlaid series on one plot — dual Y-axis if scales differ — often makes the relationship visible at a glance.
- Unrelated metrics or different questions? Separate charts or one focused metric may be clearer.
- Composition or segments? Bars, stacks, or small multiples may fit better than overlay.

UI constraints: 540px wide panel. Chart-dominant layout — the plot is the hero, not KPI cards. No outer card/container wrapper. No dense tables unless asked.

Reply with 3–5 sentences: (1) insight goal, (2) metrics to show, (3) chart type and layout, (4) why this beats alternatives. Explicitly confirm the chart will occupy most of the space. No HTML.`;

const VIZ_PROMPT = `${SYSTEM_PROMPT}

You render visualizations as self-contained HTML inside a \`\`\`html code block.
- Inline CSS and inline SVG only. NO external scripts or CDN.
- Light theme: white background, dark text, muted colors.
- Follow the visualization plan in the user message.

VISUAL HIERARCHY (critical — users ask for a chart, not a dashboard):
- The chart IS the product. The SVG must be the largest element: at least 360px tall, ~520px wide.
- Structure: optional small title (one line, ≤18px) → hero SVG → optional compact legend below. Nothing else.
- NO outer card, container box, border, or drop-shadow around the visualization. Flat on white — it sits on a page that is already white.
- NO large KPI cards, stat tags, sidebar panels, or multi-column layouts with text blocks beside the chart.
- NO paragraphs of analysis in the HTML — Jackie speaks the insight; the HTML is just the chart.
- Prefer visual summary over data tables.

The server saves your HTML automatically — do not say you saved a file.`;

function isVisualizationTask(task: string): boolean {
  return /\b(chart|graph|plot|visual|visualiz|diagram|trend|compare|earnings|overlay|draw|show me)\b/i.test(task);
}

let gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!gemini) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Missing GEMINI_API_KEY");
    gemini = new GoogleGenAI({ apiKey: key });
  }
  return gemini;
}

let seeded = false;
let busy = false;

let lastSavedVisual: string | null = null;

function getLastSavedVisual(): string | null {
  return lastSavedVisual;
}

function saveHtmlFromResponse(text: string): string | null {
  const fenceMatch = text.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  let html = fenceMatch?.[1]?.trim();
  if (!html && /^\s*<(!DOCTYPE|html)/i.test(text)) {
    html = text.trim();
  }
  if (!html?.includes("<")) return null;

  const filename = `viz-${Date.now()}.html`;
  writeFileSync(resolve(GENERATED_DIR, filename), html);
  console.log(`[bg-brain] Wrote ${filename}`);
  lastSavedVisual = filename;
  return filename;
}

async function runTaskGemini(task: string): Promise<string> {
  lastSavedVisual = null;
  console.log(`[bg-brain] Task (${MODEL}): ${task.slice(0, 100)}`);
  const start = Date.now();

  let contents = task;
  if (isVisualizationTask(task)) {
    const planResponse = await getGemini().models.generateContent({
      model: MODEL,
      contents: task,
      config: { systemInstruction: PLAN_PROMPT },
    });
    const plan = (planResponse.text ?? "").trim();
    console.log(`[bg-brain] Viz plan: ${plan.slice(0, 200)}`);
    contents = `User request: ${task}\n\nVisualization plan (follow this):\n${plan}\n\nNow output the HTML.`;
  }

  const response = await getGemini().models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction: isVisualizationTask(task) ? VIZ_PROMPT : SYSTEM_PROMPT },
  });

  const text = (response.text ?? "").trim();
  const elapsed = Date.now() - start;
  const saved = saveHtmlFromResponse(text);

  const summary = saved
    ? text.replace(/```(?:html)?\s*\n[\s\S]*?```/i, `[Chart saved as ${saved}]`).trim()
    : text;

  const result = (summary || "No output.").slice(0, 4000);
  console.log(`[bg-brain] Done (${elapsed}ms): ${result.slice(0, 200)}`);
  return result;
}

async function runTaskAntigravity(_task: string): Promise<string> {
  throw new Error("Antigravity backend not wired yet — set BRAIN_BACKEND=gemini for local dev");
}

async function runTask(task: string): Promise<string> {
  if (BACKEND === "antigravity") return runTaskAntigravity(task);
  return runTaskGemini(task);
}

async function seed(): Promise<void> {
  console.log(`[bg-brain] Seeding (${BACKEND}, ${MODEL})...`);
  try {
    const result = await runTask(
      "Confirm you have the local data. List the JSON files and one line about how visualizations are delivered."
    );
    seeded = true;
    console.log(`[bg-brain] Seeded: ${result.slice(0, 300)}`);
    console.log("[bg-brain] Ready");
  } catch (err) {
    console.error(`[bg-brain] Seed failed: ${(err as Error).message}`);
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/task") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      if (busy) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Brain is busy" }));
        return;
      }
      try {
        const { task } = JSON.parse(body);
        busy = true;
        const result = await runTask(task);
        busy = false;
        const lastVisual = getLastSavedVisual();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result, visualUrl: lastVisual ? `/generated/${lastVisual}` : undefined }));
      } catch (err) {
        busy = false;
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: seeded ? "ready" : "seeding", busy, backend: BACKEND, model: MODEL }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`[bg-brain] Listening on http://localhost:${PORT} (${BACKEND})`);
  seed();
});
