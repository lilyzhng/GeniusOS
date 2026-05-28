# GeniusOS

A real-time thinking partner orchestrating a dual model setup of `gpt-realtime-2` and Codex. It pairs a live voice interaction model with parallel background agents that handle tool calling, code execution, and generative UI, so the conversation never stops while work happens behind the scenes.

## Why users need this

Today, using an AI agent means watching it work. You prompt, you wait, you read, you prompt again. Voice doesn't fix this if it's still turn-based. What people actually want is to think out loud while things get done. GeniusOS lets you talk through a problem, ask for a chart, pivot to a different question, request a code change, all in one continuous conversation, while each task runs in the background and results surface as they complete.

## The architecture

When Thinking Machines released their interaction model, I recognized the same architecture I'd been building independently. Their thesis: for interactivity to scale with intelligence, it must be part of the model itself. I don't fully agree. Model plus harness becomes a powerful, collaborative agent. These are two means to the same end. Interactivity is a type of user experience, and as long as users get that experience, it doesn't matter whether the system uses a full-duplex model or cascaded scaffolding. GeniusOS proves this with OpenAI's realtime voice stack. `gpt-realtime-2` handles the hard interaction problems (sub-230ms responses, pause detection, mid-sentence pivots, simultaneous listening and speaking). Background agents handle the heavy work.

```
Browser (hold-to-talk)
  | WebSocket /voice/browser
  v
browser-stream.ts         <- gpt-realtime-2 (real-time voice conversation)
  | tool call: use_cli("make a chart of X")
  | POST http://localhost:3336/task
  v
bg-brain.ts               <- Codex (parallel background agent execution)
  | generates files, charts, artifacts
  v
public/generated/         <- browser displays results as they complete
```

## Parallel agents and context management

The background is not a fixed set of tool functions. Each background agent is a coding agent with shell access in a persistent sandbox, the same pattern that makes CLI-based agents like Codex so powerful. Instead of predefining every tool (generate_chart, run_query, etc.), the agent gets intent from the voice model and figures out *how* autonomously. Multiple agents run simultaneously, each handling a different task. The front-end coordinator dispatches tasks, tracks which agents are working, and manages the context bridge between the voice conversation and each background agent. When an agent finishes (a chart, a file, a generative UI artifact), the result routes back to the voice model, which weaves it into the conversation naturally. This makes the system an agent orchestration layer with voice as the interface.

## Why this is the correct architecture

I wrote a [technical breakdown](https://lilyzhng.github.io/posts/interaction-model/) analyzing the five capabilities required for natural voice interaction: speaking during user speech, pause-vs-endpoint detection, real-time semantic processing, micro-responses, and simultaneous I/O. These are fundamentally at odds with heavy tool execution. Splitting them is not a shortcut. It's the right design.

## Latency: the right metric

Traditional voice agent pipelines (Decagon, Sierra) are sequential: STT -> LLM -> tool execution -> TTS. The user hears nothing until the entire chain completes.

GeniusOS separates voice from execution. `gpt-realtime-2` responds instantly while background agents work in parallel. The key metric is **time-to-first-voice-response**, not time-to-complete-execution. The user doesn't care when the tool finishes. They care when silence ends.

## Stack

| Layer | Tech |
|-------|------|
| Voice UI | `public/index.html` (hold-to-talk button) |
| Voice model | OpenAI Realtime API (`gpt-realtime-2`) |
| Background agents | Codex (CLI/SDK, persistent sandbox) |
| Server | Fastify + WebSocket |

## Prerequisites

- Node.js 18+
- `OPENAI_API_KEY` in `.env`

## Setup

```bash
npm install
cp .env.example .env    # add OPENAI_API_KEY
```

## Launch

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
4. Simple chat uses voice only. Tasks like charts call the background agents.

## Deploy (Vercel)

Static site from `public/`. Auto-deploys on push to `main` via [GitHub integration](https://github.com/lilyzhng/walkie-talkie).

| URL | What |
|-----|------|
| https://lily-walkie-talkie.vercel.app | Production home |
| https://vercel.com/lily-zhangs-projects/walkie-talkie | Vercel project dashboard |

The voice WebSocket server and background brain still run locally. Vercel serves the static UI only.

## Links

- **Research:** https://lilyzhng.github.io/posts/interaction-model/
- **Demo:** https://lily-walkie-talkie.vercel.app/
- **Using:** gpt-realtime-2 (OpenAI Realtime API), Codex (CLI/SDK)
