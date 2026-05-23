# Walkie-Talkie → Agent Home

Voice interface for a managed agent in a persistent sandbox.

Built during DeepMind I/O Hackathon, 2026-05-23.

## Stack (today)

| Layer | Tech |
|-------|------|
| Voice UI | `public/index.html` (hold-to-talk) |
| Voice | OpenAI Realtime (`gpt-realtime-2`) |
| Tools / tasks | **Gemini 3.5 Flash** background brain (port 3336) |
| Hackathon bonus | Antigravity managed agent (`BRAIN_BACKEND=antigravity`) |

## Prerequisites

- Node.js 18+
- `OPENAI_API_KEY` in `.env` (voice)
- `GEMINI_API_KEY` in `.env` (background brain)

## Setup (once)

```bash
cd walkie-talkie
npm install
cp .env.example .env
# Edit .env — set OPENAI_API_KEY and GEMINI_API_KEY
npm run verify-gemini   # smoke test Gemini API
```

Optional in `.env`:

```bash
PORT=3335                  # default
BRAIN_BACKEND=gemini       # default; antigravity for hackathon sandbox
BROWSER_AUTH_TOKEN=        # leave empty for local dev
```

## Launch (two terminals)

Voice and tools are **two separate processes**. Both must be running for charts and tool tasks.

**Terminal 1 — voice server**

```bash
npm run dev
```

Open http://localhost:3335

**Terminal 2 — background brain**

```bash
./launch-bg-brain.sh
```

Check: `curl http://localhost:3336/health` → `{"status":"ready","busy":false,"backend":"gemini",...}`

### Quick health check

```bash
curl http://localhost:3335/health   # walkie-talkie
curl http://localhost:3336/health   # bg-brain
npm run verify-gemini               # Gemini API only
```

## Usage

1. Open http://localhost:3335 in Chrome (mic works best).
2. Allow microphone access.
3. Hold the talk button and speak.
4. Simple chat uses voice only. Tasks like charts call the Gemini background brain (Terminal 2).

If Jackie says *"Background brain not running"*, start Terminal 2 — that is **not** an OpenAI credits error.

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Voice server (tsx, port 3335) |
| `./launch-bg-brain.sh` | Gemini brain (port 3336) |
| `npm run verify-gemini` | Smoke test `gemini-3.5-flash` |
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
  bg-brain.ts       Gemini task server
public/index.html   UI
```
