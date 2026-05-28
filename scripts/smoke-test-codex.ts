import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const BG_BRAIN_URL = process.env.BG_BRAIN_URL || "http://localhost:3336";

interface TestCase {
  name: string;
  task: string;
  kind: "text" | "chart" | "meme";
  expect: (result: string, visual?: string, meme?: string) => boolean;
}

const TESTS: TestCase[] = [
  {
    name: "Text response",
    task: "What is 2 + 2? Reply in one sentence.",
    kind: "text",
    expect: (r) => r.length > 0 && !r.startsWith("Error"),
  },
  {
    name: "Chart generation",
    task: "Show Uber Q1 2026 revenue as a bar chart.",
    kind: "chart",
    expect: (r, visual) => visual != null && visual.length > 0,
  },
  {
    name: "Meme generation",
    task: "Make a meme about debugging at 3am.",
    kind: "meme",
    expect: (_r, _v, meme) => meme != null && meme.length > 0,
  },
  {
    name: "Data analysis",
    task: "Summarize Uber's key financial metrics from the local data in 2-3 sentences.",
    kind: "text",
    expect: (r) => r.length > 20 && !r.startsWith("Error"),
  },
];

async function checkHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${BG_BRAIN_URL}/health`);
    const json = await resp.json() as Record<string, unknown>;
    console.log(`  Health: ${JSON.stringify(json)}`);
    return json.backend === "codex" && (json.status === "ready" || json.status === "seeding");
  } catch (err) {
    console.error(`  Health check failed: ${(err as Error).message}`);
    return false;
  }
}

async function runTest(test: TestCase): Promise<{ pass: boolean; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const resp = await fetch(`${BG_BRAIN_URL}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: test.task, kind: test.kind }),
    });
    const json = await resp.json() as {
      result?: string;
      error?: string;
      visualUrl?: string;
      memeUrl?: string;
    };
    const ms = Date.now() - start;

    if (json.error) {
      return { pass: false, ms, error: json.error };
    }

    const pass = test.expect(json.result || "", json.visualUrl, json.memeUrl);
    return { pass, ms, error: pass ? undefined : `Unexpected result: ${(json.result || "").slice(0, 100)}` };
  } catch (err) {
    return { pass: false, ms: Date.now() - start, error: (err as Error).message };
  }
}

async function main() {
  console.log(`\nCodex Backend Smoke Test`);
  console.log(`Target: ${BG_BRAIN_URL}`);
  console.log(`${"=".repeat(50)}\n`);

  console.log("Checking health...");
  const healthy = await checkHealth();
  if (!healthy) {
    console.error("\nFAIL: bg-brain not running with codex backend.");
    console.error("Start it with: BRAIN_BACKEND=codex ./launch-bg-brain.sh");
    process.exit(1);
  }
  console.log();

  let passed = 0;
  let failed = 0;

  for (const test of TESTS) {
    process.stdout.write(`[${test.name}] (${test.kind})... `);
    const result = await runTest(test);
    if (result.pass) {
      passed++;
      console.log(`PASS (${(result.ms / 1000).toFixed(1)}s)`);
    } else {
      failed++;
      console.log(`FAIL (${(result.ms / 1000).toFixed(1)}s) - ${result.error}`);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${TESTS.length} total`);

  if (failed > 0) {
    console.log("\nSome tests failed. Check that BRAIN_BACKEND=codex and OPENAI_API_KEY are set.");
    process.exit(1);
  } else {
    console.log("\nAll tests passed. Codex backend is working end-to-end.");
  }
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
