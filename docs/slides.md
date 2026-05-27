# How It Works - Slide Deck

6 slides, scroll-snap navigation. Deployed at `lily-walkie-talkie.vercel.app`.

## Slide 1: Intro

**Eyebrow:** OpenAI Voice Hack Night · 2026
**Title:** Walkie Talkie
**Subtitle:** Real-time voice agent got strong hands. | Handy and brainy
**Badges:** Mix of experts, Dual-model
**Visual:** Device mockup screenshot (right side)

## Slide 2: The Gap (Venn Diagram)

**Eyebrow:** Mix of experts
**Title:** Nothing sits in between. Until now.
**Visual:** Venn diagram with two circles:
- **Left circle (Full-Duplex):** Real-time interaction, simultaneous listen + speak, weak tool calling. Examples: OpenAI Realtime, Gemini Live.
- **Right circle (Turn-Based):** Task completion, responds after request, strong tool calling. Examples: ChatGPT, Claude, coding agents.
- **Overlap:** Walkie-Talkie = BOTH

## Slide 3: The Problem

**Eyebrow:** The problem
**Title:** 3.7 seconds of dead air. Every single turn.
**Layout:** Split - pipeline diagram (left) + meme/image (right)

**Left - Traditional pipeline diagram:**
- STT: ~500ms -> LLM: ~1500ms -> Tool exec: ~1200ms -> TTS: ~500ms
- Red dashed "dead air" zone. Sequential. User hears silence until the entire chain completes.

**Right - Image placeholder:**
- Meme or image showing the pain of waiting. Placeholder for now.

## Slide 4: The Solution (Dual Model Architecture)

**Eyebrow:** How it works
**Title:** Two models. One conversation.
**Visual:** Animated SVG architecture diagram showing:
- **Real-time zone (dashed border):** User <-> Front-end model (gpt-realtime-2), blue arrows looping
- **Background brain zone (dashed green border, 2x2 grid):**
  - Agent 1: Tool calls
  - Agent 2: Search
  - Agent 3: Gen UI
  - Agent 4: Memes
  - All powered by Codex
- Green arrows flowing: Front-end sends tasks -> background agents -> results flow back
**Caption:** The front-end model handles talking and interacting with the user, while background brains run tool calls, search, and generative UI in parallel.

## Slide 5: Example + Demo

**Eyebrow:** For example
**Title:** "Give me the visualization of that chart."
**Layout:** Split - flow chart (left 30%) + YouTube embed (right 70%)
**Flow:** You -> Front-end model (parses intent) -> Background brain (calls tools, renders chart) -> fork: Agent Home (shows chart) + Voice (Jackie narrates live) -> "You see the chart and hear Jackie. Flow never breaks."
**Video:** YouTube embed (nkG2ME7mrAc)

## Slide 6: CTA

**Title:** Think out loud, let agents flow with your mind.
**Buttons:** Launch Walkie-Talkie, Read the write-up, Full demo
