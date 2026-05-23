# Walkie-Talkie → Agent Home

Built during DeepMind I/O Hackathon, 2026-05-23.

## What it is

Walkie-Talkie is a **dual-model system**:

1. **Front-end model** — real-time voice interaction (listen, speak, pivot mid-conversation)
2. **Background model** — tool execution in a persistent sandbox (files, charts, generative UI)

Press to talk. The front-end handles the conversation; the background does the work.

## The gap it fills

LLM products split into two camps today: **full-duplex** (live voice — GPT Realtime, Moshi) and **turn-based** (chat + tools — Claude Code, Gemini). One is great at talking; the other is great at doing. Nothing live sits in between.

Walkie-Talkie stitches both: natural real-time interaction up front, powerful tool execution in the back. [More on the interaction-model gap →](https://lilyzhng.github.io/posts/interaction-model/)

# Managed Agent

**Phase 1 (today) — no managed agent.** The background brain calls `gemini-3.5-flash` directly via the Gemini API (`BRAIN_BACKEND=gemini`). Charts and memes are generated locally and written to `public/generated/`. This is a standard model API, not a managed agent sandbox.

**Phase 2 (planned, not wired yet) — managed agent.** Same voice shell; only the background brain swaps to Antigravity (`BRAIN_BACKEND=antigravity`). The plan:

```
Browser (hold-to-talk)
  │ WebSocket /voice/browser
  ▼
browser-stream.ts              ← OpenAI Realtime (front-end model)
  │ tool: use_cli("organize screenshots")
  │ POST http://localhost:3336/task
  ▼
bg-brain.ts                    ← BRAIN_BACKEND=antigravity (planned)
  │
  │  interactions.create({
  │    agent: "antigravity-preview-05-2026",
  │    environment,              ← persistent sandbox = Agent Home
  │    previous_interaction_id   ← state across commands
  │  })
  ▼
Remote sandbox (/workspace/...)  ← agent runs tools, moves files, writes artifacts
  │
  │  download tarball
  ▼
public/generated/              ← browser displays charts / Agent Home updates
```

The front-end model stays the same in both phases. Managed agents would only replace the background brain — for tool execution and persistent state in a remote sandbox.

## Stack (today)

| Layer | Tech |
|-------|------|
| Voice UI | `public/index.html` (hold-to-talk) |
| Voice | OpenAI Realtime (`gpt-realtime-2`) |
| Tools / tasks | Local **background brain** (Claude CLI on port 3336) |
| Hackathon target | Gemini 3.5 Flash + Antigravity managed agent |

## Prerequisites

- Node.js 18+
- `OPENAI_API_KEY` in `.env` (voice)
- `claude` CLI installed and logged in (background brain / tool calls)

## Setup (once)

```bash
cd walkie-talkie
npm install
cp .env.example .env
# Edit .env — at minimum set OPENAI_API_KEY=
```

Optional in `.env`:

```bash
PORT=3335                  # default
BROWSER_AUTH_TOKEN=        # leave empty for local dev
```

## Launch (two terminals)

Voice and tools are **two separate processes**. Both must be running for weather, charts, file tasks, etc.

**Terminal 1 — voice server**

```bash
npm run dev
```

Open http://localhost:3335

**Terminal 2 — background brain**

```bash
./launch-bg-brain.sh
```

Check: `curl http://localhost:3336/health` → `{"status":"ready","busy":false}`

### Quick health check

```bash
curl http://localhost:3335/health   # walkie-talkie
curl http://localhost:3336/health   # bg-brain
```

## Usage

1. Open http://localhost:3335 in Chrome (mic works best).
2. Allow microphone access.
3. Hold the talk button and speak.
4. Simple chat uses voice only. Tasks like weather or charts call the background brain (Terminal 2).

If Jackie says *"Background brain not running"*, start Terminal 2 — that is **not** an OpenAI credits error.

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Voice server (tsx, port 3335) |
| `./launch-bg-brain.sh` | Tool backend (port 3336) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled server |

## Logs

- Background brain: `bg-brain.log` (after `./launch-bg-brain.sh`)

## Repo layout

```
src/
  index.ts          entry
  server.ts         HTTP + WebSocket
  browser-stream.ts OpenAI Realtime + tool routing
  bg-brain.ts       Claude CLI task server
public/index.html   UI
```
