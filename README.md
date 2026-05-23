# Walkie-Talkie to Agent Home

Built during DeepMind I/O Hackathon, 2026-05-23.

## What it is

A **dual-model voice agent**: press to talk, the front-end handles the conversation, the background does the work.

1. **Front-end model** handles real-time voice interaction (listen, speak, pivot mid-conversation)
2. **Background model** handles tool execution in a persistent sandbox (files, charts, generative UI)

LLM products today split into two camps: **full-duplex** (live voice) and **turn-based** (chat + tools). One is great at talking, the other is great at doing. Nothing sits in between.

Walkie-Talkie stitches both: natural real-time voice up front, powerful tool execution in the back. Gemini 3.5 Flash as the background brain keeps latency low.

## Architecture

```
Browser (hold-to-talk)
  | WebSocket /voice/browser
  v
browser-stream.ts         <- voice model (real-time conversation)
  | tool call: use_cli("make a chart of X")
  | POST http://localhost:3336/task
  v
bg-brain.ts               <- Gemini 3.5 Flash (tool execution)
  | generates files
  v
public/generated/         <- browser displays charts, memes, artifacts
```

## Stack

| Layer | Tech |
|-------|------|
| Voice UI | `public/index.html` (hold-to-talk button) |
| Voice model (default) | OpenAI Realtime (`gpt-realtime-2`) — `VOICE_BACKEND=openai` |
| Voice model (optional) | Gemini Live API — `VOICE_BACKEND=gemini-live` |
| Background brain | Gemini 3.5 Flash API (port 3336) |
| Server | Fastify + WebSocket (port 3335) |

## Prerequisites

- Node.js 18+
- `GEMINI_API_KEY` in `.env` (background brain; also voice when using Gemini Live)
- `OPENAI_API_KEY` in `.env` (only when `VOICE_BACKEND=openai`, the default)

## Setup

```bash
npm install
cp .env.example .env    # edit keys + optional VOICE_BACKEND
npm run verify-gemini   # smoke test background Gemini API
npm run verify-gemini-live   # if using VOICE_BACKEND=gemini-live
```

Optional `.env` settings:

```
VOICE_BACKEND=openai       # openai (default) | gemini-live
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
OPENAI_API_KEY=            # required for VOICE_BACKEND=openai
PORT=3335                  # voice server port (default)
BRAIN_BACKEND=gemini       # default
BROWSER_AUTH_TOKEN=        # leave empty for local dev
```

## Launch

Voice and tools are two separate processes. Both must be running.

```bash
# Terminal 1: voice server
npm run dev
# -> http://localhost:3335

# Terminal 2: background brain
./launch-bg-brain.sh
# -> http://localhost:3336/health
```

## Usage

1. Open http://localhost:3335 in Chrome
2. Allow microphone access
3. Hold the talk button and speak
4. Simple chat uses voice only. Tasks like charts call the background brain.

If the voice says "Background brain not running", start Terminal 2.

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Voice server (tsx, port 3335) |
| `./launch-bg-brain.sh` | Background brain (port 3336) |
| `npm run verify-gemini` | Smoke test Gemini 3.5 Flash (background) |
| `npm run verify-gemini-live` | Smoke test Gemini Live (voice option) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled server |

## Repo layout

```
src/
  index.ts              entry point
  server.ts             HTTP + WebSocket server
  browser-stream.ts     real-time voice + tool routing
  gemini-live-stream.ts Gemini Live voice backend (optional)
  bg-brain.ts           Gemini 3.5 Flash task server
  config.ts             env config
public/
  index.html            voice UI
  generated/            output artifacts (charts, memes)
  icons/                UI assets
scripts/
  verify-gemini.ts      background API smoke test
  verify-gemini-live.ts Gemini Live smoke test
  test-gemini-image.ts  image generation test
  test-tool-audio.ts    audio tool test
```

## Future: Managed Agent (Antigravity)

The background brain could swap from direct Gemini API calls to an Antigravity managed agent (`BRAIN_BACKEND=antigravity`). This would give the agent a persistent remote sandbox with state across commands, turning the background into a true "Agent Home". The voice shell stays the same, only the execution backend changes.
