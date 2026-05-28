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
const OPENAI_MODEL = process.env.OPENAI_BRAIN_MODEL ?? "gpt-4.1";
const BACKEND = (process.env.BRAIN_BACKEND ?? "gemini") as "gemini" | "codex" | "antigravity";

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

For non-visual tasks: reply in plain text, concise and spoken-friendly. Always use English unless the user explicitly requests another language.`;

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

const MEME_PROMPT = `${SYSTEM_PROMPT}

You render internet-style memes as self-contained HTML inside a \`\`\`html code block.

CRITICAL — VISUAL FIRST (text-only output is INVALID and will be rejected):
- The meme MUST include a large inline SVG illustration as the hero (≥280px tall, ~440px wide).
- Draw the scene with SVG: characters (stick figures, cat at keyboard, brain tiers, Drake silhouettes), props, speed lines, emoji-style faces, colored panels, arrows, checkmarks.
- Caption text is secondary — at most 2 short lines (top/bottom or labels). Never output ONLY impact text with no drawing.
- If the joke fits "typing cat" or "speed lines", DRAW the cat, keyboard, and motion lines in SVG — do not tell the user to add an image elsewhere.

Technical rules:
- Inline CSS and inline SVG only. NO external scripts, CDN, or remote images.
- ~480px wide, centered. Meme templates often use dark/colored panel backgrounds (#1a1a2e, #4a4a4a) — that's fine.
- Layout: prefer HORIZONTAL two-panel comic — left panel = setup, right panel = punchline. Side-by-side panels (~220px each) inside ~480px width. Use vertical stack ONLY if the joke needs top/bottom impact text.
- Layout examples: horizontal Drake (reject ✓ left / accept ✗ right); before/after side-by-side; left = action scene, right = reaction with checkmark.
- Bold meme typography when using text: uppercase, white with black stroke or high-contrast bars.
- The meme IS the whole page — no explanation paragraphs.
- Do not say you saved a file or that Lily needs another app to add images.`;

function isVisualMemeHtml(html: string): boolean {
  if (/<svg[\s>]/i.test(html)) return true;
  const panelCount = (html.match(/<(div|section)[^>]*style=/gi) || []).length;
  return panelCount >= 4;
}

type TaskKind = "chart" | "meme" | "text";

function isVisualizationTask(task: string): boolean {
  return /\b(chart|graph|plot|visual|visualiz|diagram|trend|compare|earnings|overlay|draw|show me)\b/i.test(task)
    && !isMemeTask(task);
}

function isMemeTask(task: string): boolean {
  return /\b(meme|memeify|memefy|funny|joke about|roast|drake|brain meme|reaction pic)\b/i.test(task);
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

interface QueueJob {
  task: string;
  kind: TaskKind;
  resolve: (result: string) => void;
  reject: (err: Error) => void;
}
const taskQueue: QueueJob[] = [];
let queueProcessing = false;

async function processTaskQueue(): Promise<void> {
  if (queueProcessing) return;
  queueProcessing = true;
  busy = true;
  while (taskQueue.length > 0) {
    const job = taskQueue.shift()!;
    console.log(`[bg-brain] Queue (${taskQueue.length} waiting): ${job.kind}`);
    try {
      const result = await runTask(job.task, job.kind);
      job.resolve(result);
    } catch (err) {
      job.reject(err as Error);
    }
  }
  busy = false;
  queueProcessing = false;
}

function enqueueTask(task: string, kind: TaskKind): Promise<string> {
  return new Promise((resolve, reject) => {
    taskQueue.push({ task, kind, resolve, reject });
    void processTaskQueue();
  });
}

let lastSaved = { viz: null as string | null, meme: null as string | null };

function getLastSaved(prefix: "viz" | "meme"): string | null {
  return lastSaved[prefix];
}

function saveHtmlFromResponse(text: string, prefix: "viz" | "meme"): string | null {
  const fenceMatch = text.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  let html = fenceMatch?.[1]?.trim();
  if (!html && /^\s*<(!DOCTYPE|html)/i.test(text)) {
    html = text.trim();
  }
  if (!html?.includes("<")) return null;

  const filename = `${prefix}-${Date.now()}.html`;
  writeFileSync(resolve(GENERATED_DIR, filename), html);
  console.log(`[bg-brain] Wrote ${filename}`);
  lastSaved[prefix] = filename;
  return filename;
}

function resolveTaskKind(task: string, kind?: TaskKind): TaskKind {
  if (kind && kind !== "text") return kind;
  if (isMemeTask(task)) return "meme";
  if (isVisualizationTask(task)) return "chart";
  return "text";
}

async function runTaskGemini(task: string, kind: TaskKind = "text"): Promise<string> {
  lastSaved = { viz: null, meme: null };
  const resolvedKind = resolveTaskKind(task, kind);
  console.log(`[bg-brain] Task (${MODEL}, ${resolvedKind}): ${task.slice(0, 100)}`);
  const start = Date.now();

  let contents = task;
  let systemInstruction = SYSTEM_PROMPT;

  if (resolvedKind === "chart") {
    const planResponse = await getGemini().models.generateContent({
      model: MODEL,
      contents: task,
      config: { systemInstruction: PLAN_PROMPT },
    });
    const plan = (planResponse.text ?? "").trim();
    console.log(`[bg-brain] Viz plan: ${plan.slice(0, 200)}`);
    contents = `User request: ${task}\n\nVisualization plan (follow this):\n${plan}\n\nNow output the HTML.`;
    systemInstruction = VIZ_PROMPT;
  } else if (resolvedKind === "meme") {
    systemInstruction = MEME_PROMPT;
  }

  const response = await getGemini().models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction },
  });

  let text = (response.text ?? "").trim();
  const elapsed = Date.now() - start;
  const savedPrefix = resolvedKind === "chart" ? "viz" : resolvedKind === "meme" ? "meme" : null;
  let saved = savedPrefix ? saveHtmlFromResponse(text, savedPrefix) : null;

  if (resolvedKind === "meme" && saved) {
    const htmlPath = resolve(GENERATED_DIR, saved);
    const htmlContent = readFileSync(htmlPath, "utf-8");
    if (!isVisualMemeHtml(htmlContent)) {
      console.log("[bg-brain] Meme was text-only — retrying with visual requirement");
      const retry = await getGemini().models.generateContent({
        model: MODEL,
        contents: `${task}\n\nYour previous output was TEXT-ONLY — INVALID. Regenerate with a large inline SVG scene (character + props, ≥280px tall). Caption text is optional and secondary.`,
        config: { systemInstruction: MEME_PROMPT },
      });
      text = (retry.text ?? "").trim();
      saved = saveHtmlFromResponse(text, "meme");
    }
  }

  const summary = saved
    ? text.replace(/```(?:html)?\s*\n[\s\S]*?```/i, `[${resolvedKind === "meme" ? "Meme" : "Chart"} saved as ${saved}]`).trim()
    : text;

  const result = (summary || "No output.").slice(0, 4000);
  console.log(`[bg-brain] Done (${elapsed}ms): ${result.slice(0, 200)}`);
  return result;
}

async function runTaskCodex(task: string, kind: TaskKind = "text"): Promise<string> {
  lastSaved = { viz: null, meme: null };
  const resolvedKind = resolveTaskKind(task, kind);
  console.log(`[bg-brain] Task (${OPENAI_MODEL}, ${resolvedKind}): ${task.slice(0, 100)}`);
  const start = Date.now();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  let systemPrompt = SYSTEM_PROMPT;
  let userContent = task;

  if (resolvedKind === "chart") {
    const planResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: PLAN_PROMPT },
          { role: "user", content: task },
        ],
      }),
    });
    const planJson = await planResp.json() as { choices?: { message?: { content?: string } }[] };
    const plan = (planJson.choices?.[0]?.message?.content ?? "").trim();
    console.log(`[bg-brain] Viz plan: ${plan.slice(0, 200)}`);
    userContent = `User request: ${task}\n\nVisualization plan (follow this):\n${plan}\n\nNow output the HTML.`;
    systemPrompt = VIZ_PROMPT;
  } else if (resolvedKind === "meme") {
    systemPrompt = MEME_PROMPT;
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });
  const json = await resp.json() as { choices?: { message?: { content?: string } }[] };
  let text = (json.choices?.[0]?.message?.content ?? "").trim();
  const elapsed = Date.now() - start;

  const savedPrefix = resolvedKind === "chart" ? "viz" : resolvedKind === "meme" ? "meme" : null;
  let saved = savedPrefix ? saveHtmlFromResponse(text, savedPrefix) : null;

  if (resolvedKind === "meme" && saved) {
    const htmlPath = resolve(GENERATED_DIR, saved);
    const htmlContent = readFileSync(htmlPath, "utf-8");
    if (!isVisualMemeHtml(htmlContent)) {
      console.log("[bg-brain] Meme was text-only — retrying with visual requirement");
      const retryResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            { role: "system", content: MEME_PROMPT },
            { role: "user", content: `${task}\n\nYour previous output was TEXT-ONLY — INVALID. Regenerate with a large inline SVG scene (character + props, ≥280px tall). Caption text is optional and secondary.` },
          ],
        }),
      });
      const retryJson = await retryResp.json() as { choices?: { message?: { content?: string } }[] };
      text = (retryJson.choices?.[0]?.message?.content ?? "").trim();
      saved = saveHtmlFromResponse(text, "meme");
    }
  }

  const summary = saved
    ? text.replace(/```(?:html)?\s*\n[\s\S]*?```/i, `[${resolvedKind === "meme" ? "Meme" : "Chart"} saved as ${saved}]`).trim()
    : text;

  const result = (summary || "No output.").slice(0, 4000);
  console.log(`[bg-brain] Done (${elapsed}ms): ${result.slice(0, 200)}`);
  return result;
}

async function runTaskAntigravity(_task: string): Promise<string> {
  throw new Error("Antigravity backend not wired yet — set BRAIN_BACKEND=gemini or BRAIN_BACKEND=codex");
}

async function runTask(task: string, kind: TaskKind = "text"): Promise<string> {
  if (BACKEND === "codex") return runTaskCodex(task, kind);
  if (BACKEND === "antigravity") return runTaskAntigravity(task);
  return runTaskGemini(task, kind);
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
      try {
        const { task, kind = "text" } = JSON.parse(body);
        const result = await enqueueTask(task, kind);
        const lastVisual = getLastSaved("viz");
        const lastMeme = getLastSaved("meme");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          result,
          visualUrl: lastVisual ? `/generated/${lastVisual}` : undefined,
          memeUrl: lastMeme ? `/generated/${lastMeme}` : undefined,
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: seeded ? "ready" : "seeding", busy, queue: taskQueue.length, backend: BACKEND, model: BACKEND === "codex" ? OPENAI_MODEL : MODEL }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`[bg-brain] Listening on http://localhost:${PORT} (${BACKEND})`);
  seed();
});
