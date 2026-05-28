import WebSocket from "ws";
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

const REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime-2";
const ITERATIONS = parseInt(process.argv[2] || "10", 10);
const SAMPLE_RATE = 24000;
const SILENCE_DURATION_MS = 800;

function generateSilence(durationMs: number): string {
  const samples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const buffer = new Int16Array(samples);
  // Near-silence with tiny noise so VAD detects speech boundaries
  for (let i = 0; i < samples; i++) {
    buffer[i] = Math.floor(Math.random() * 20) - 10;
  }
  return Buffer.from(buffer.buffer).toString("base64");
}

function generateTone(durationMs: number, freq = 440): string {
  const samples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const buffer = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    buffer[i] = Math.floor(Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * 3000);
  }
  return Buffer.from(buffer.buffer).toString("base64");
}

interface TrialResult {
  ttfvrMs: number;
  success: boolean;
}

function runTrial(trialNum: number): Promise<TrialResult> {
  return new Promise((res) => {
    const ws = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    let speechStoppedAt = 0;
    let resolved = false;
    let sessionReady = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log(`  Trial ${trialNum}: timeout (15s)`);
        ws.close();
        res({ ttfvrMs: -1, success: false });
      }
    }, 15000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: "You are a test assistant. Respond briefly to anything you hear.",
          tools: [],
          tool_choice: "none",
          model: "gpt-realtime-2",
          output_modalities: ["audio"],
          audio: {
            input: {
              format: { type: "audio/pcm", rate: SAMPLE_RATE },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "medium",
              },
            },
            output: {
              format: { type: "audio/pcm", rate: SAMPLE_RATE },
              voice: "alloy",
            },
          },
        },
      }));
    });

    ws.on("message", (data) => {
      const event = JSON.parse(data.toString());

      switch (event.type) {
        case "session.updated":
          sessionReady = true;
          // Send a short tone burst followed by silence to trigger VAD
          setTimeout(() => {
            const tone = generateTone(600, 440);
            ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: tone }));
            // Then silence so VAD detects end of speech
            setTimeout(() => {
              const silence = generateSilence(SILENCE_DURATION_MS);
              ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: silence }));
              ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
              speechStoppedAt = Date.now();
            }, 700);
          }, 200);
          break;

        case "input_audio_buffer.speech_stopped":
          speechStoppedAt = Date.now();
          break;

        case "response.audio.delta":
        case "response.output_audio.delta":
          if (!resolved && speechStoppedAt > 0) {
            const ttfvr = Date.now() - speechStoppedAt;
            resolved = true;
            clearTimeout(timeout);
            console.log(`  Trial ${trialNum}: TTFVR = ${ttfvr}ms`);
            ws.close();
            res({ ttfvrMs: ttfvr, success: true });
          }
          break;

        case "error": {
          const err = event.error as Record<string, unknown> | undefined;
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log(`  Trial ${trialNum}: error - ${JSON.stringify(err)}`);
            ws.close();
            res({ ttfvrMs: -1, success: false });
          }
          break;
        }
      }
    });

    ws.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.log(`  Trial ${trialNum}: ws error - ${err.message}`);
        res({ ttfvrMs: -1, success: false });
      }
    });
  });
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  console.log(`\nWalkie-Talkie TTFVR Benchmark`);
  console.log(`Model: gpt-realtime-2`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`---`);

  const results: number[] = [];

  for (let i = 1; i <= ITERATIONS; i++) {
    const result = await runTrial(i);
    if (result.success) {
      results.push(result.ttfvrMs);
    }
    // Small delay between trials to avoid rate limiting
    if (i < ITERATIONS) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (results.length === 0) {
    console.log("\nNo successful trials.");
    process.exit(1);
  }

  results.sort((a, b) => a - b);
  const sum = results.reduce((a, b) => a + b, 0);

  console.log(`\n--- Results (${results.length}/${ITERATIONS} successful) ---`);
  console.log(`  Min:  ${results[0]}ms`);
  console.log(`  p50:  ${percentile(results, 50)}ms`);
  console.log(`  p90:  ${percentile(results, 90)}ms`);
  console.log(`  p99:  ${percentile(results, 99)}ms`);
  console.log(`  Max:  ${results[results.length - 1]}ms`);
  console.log(`  Mean: ${Math.round(sum / results.length)}ms`);
  console.log(`\nComparison:`);
  console.log(`  Cascaded (Decagon-style):  ~600-900ms per turn`);
  console.log(`  Walkie-Talkie TTFVR p50:   ${percentile(results, 50)}ms`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
