import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const GENERATED_DIR = resolve(__dirname, "../public/generated");
const PORT = 3336;

mkdirSync(GENERATED_DIR, { recursive: true });

const dataFiles = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const content = readFileSync(resolve(DATA_DIR, f), "utf-8");
    return `=== ${f} ===\n${content}`;
  })
  .join("\n\n");

const SYSTEM_PROMPT = `You are a background brain for a voice assistant.

LOCAL DATA (use directly, do NOT search the web):
${dataFiles}

OUTPUT RULES:
- Visualizations: save as self-contained HTML (inline CSS, NO external scripts or CDN) to: ${GENERATED_DIR}/
- Light theme only: white background, dark text, muted chart colors. No dark mode.
- Keep charts simple and readable.`;

const PROMPT_FILE = resolve(tmpdir(), "bg-brain-system-prompt.txt");
writeFileSync(PROMPT_FILE, SYSTEM_PROMPT);

const SESSION_ID = crypto.randomUUID();
let seeded = false;
let busy = false;

function runTask(task: string): Promise<string> {
  const args = ["-p", task, "--dangerously-skip-permissions", "--model", "sonnet"];

  if (seeded) {
    args.push("--resume", SESSION_ID);
  } else {
    args.push("--session-id", SESSION_ID, "--system-prompt-file", PROMPT_FILE);
  }

  return new Promise((res) => {
    console.log(`[bg-brain] Task: ${task.slice(0, 100)}`);
    const start = Date.now();

    execFile(
      "claude",
      args,
      {
        timeout: 180000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, PATH: process.env.PATH },
        cwd: resolve(__dirname, ".."),
      },
      (err, stdout) => {
        const elapsed = Date.now() - start;
        if (err) {
          console.error(`[bg-brain] Error (${elapsed}ms): ${err.message}`);
          res(`Error: ${err.message}`);
          return;
        }
        const text = stdout.trim().slice(0, 4000);
        console.log(`[bg-brain] Done (${elapsed}ms): ${text.slice(0, 200)}`);
        res(text || "No output.");
      }
    );
  });
}

function seed(): void {
  console.log(`[bg-brain] Seeding (session: ${SESSION_ID})...`);
  runTask("Confirm you have the local data. List the files and where visualizations are saved. One line each.").then(
    (result) => {
      seeded = true;
      console.log(`[bg-brain] Seeded: ${result.slice(0, 300)}`);
      console.log("[bg-brain] Ready");
    }
  );
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
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result }));
      } catch (err) {
        busy = false;
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: seeded ? "ready" : "seeding", busy }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`[bg-brain] Listening on http://localhost:${PORT}`);
  seed();
});
