# Latency Comparison: Walkie-Talkie vs Cascaded Pipelines

## The metric: Time-to-First-Voice-Response (TTFVR)

Time from user-stops-speaking to first audio byte back. This is what the user experiences as "responsiveness." In a cascaded pipeline, the user waits for every step. In Walkie-Talkie, voice responds directly while execution runs in parallel.

## Architecture comparison

| | Cascaded (Decagon, Sierra, etc.) | Walkie-Talkie |
|---|---|---|
| Pipeline | STT → LLM → Tool Exec → TTS (sequential) | Voice model responds directly, bg brain works in parallel |
| TTFVR | Sum of all steps (~600-3000ms) | Voice model response only (~200-300ms) |
| Tool execution | Blocks response (user waits) | Parallel (user never waits) |
| Complexity scaling | More complex task = longer wait | TTFVR stays constant regardless of task |

## Published cascaded pipeline latencies

### Per-component (best case, published numbers)

| Component | Source | Latency | Citation |
|-----------|--------|---------|----------|
| STT (Deepgram Nova-3) | Deepgram docs | <300ms streaming | [Measuring Streaming Latency](https://developers.deepgram.com/docs/measuring-streaming-latency) |
| LLM (Decagon, self-trained) | Decagon blog | 342ms p90 | [Real-time Voice AI on Modal](https://decagon.ai/blog/real-time-voice-ai-on-modal) |
| LLM (Decagon, self-trained) | Together AI | <400ms p95 | [Decagon customer page](https://www.together.ai/customers/decagon) |
| LLM (Decagon, self-trained) | Modal blog | 342ms p90 | [Modal case study](https://modal.com/blog/decagon-case-study) |
| TTS (ElevenLabs Flash v2.5) | ElevenLabs docs | ~75ms inference | [Understanding Latency](https://elevenlabs.io/docs/eleven-api/concepts/latency) |
| TTS (Deepgram Aura-2) | Deepgram blog | ~90ms TTFB | [Engineering Real-time Voice AI](https://deepgram.com/learn/engineering-real-time-low-latency-voice-ai-at-scale) |
| TTS (Cartesia Sonic) | Cartesia | <100ms | [Cartesia Sonic](https://cartesia.ai/sonic) |

### Decagon-style full pipeline estimate

Using Decagon's own published LLM number + industry-best STT/TTS:

```
STT (Deepgram):     ~150-300ms
LLM (Decagon):       342ms p90
TTS (ElevenLabs):    ~75-150ms
Network overhead:    ~50-100ms
─────────────────────────────
Total:               ~617-892ms per turn (best case)
```

### End-to-end benchmarks (third-party)

| Source | Stack | Latency | Citation |
|--------|-------|---------|----------|
| CloudX (30+ benchmarks) | Best cascaded stack | 730-1450ms | [Cracking the <1s Voice Loop](https://dev.to/cloudx/cracking-the-1-second-voice-loop-what-we-learned-after-30-stack-benchmarks-427) |
| Cerebrium + LiveKit | Deepgram + Llama 3 + TTS | ~500ms | [Deploying a Global Scale AI Voice Agent](https://cerebrium.ai/blog/deploying-a-global-scale-ai-voice-agent-with-500ms-latency) |
| Introl (typical breakdown) | Generic cascaded | ~1000ms | [Voice AI Infrastructure Guide](https://introl.com/blog/voice-ai-infrastructure-real-time-speech-agents-asr-tts-guide-2025) |
| Retell AI | Their own stack | 620-800ms | [Vapi vs Bland comparison](https://www.retellai.com/blog/vapi-vs-bland) |
| Together AI | Orpheus TTS | 187ms TTFB (TTS only) | [Fastest Inference for Realtime Voice AI](https://www.together.ai/blog/the-fastest-inference-for-realtime-voice-ai-agents) |

## Walkie-Talkie measured latency

Run `npm run benchmark` for TTFVR measurement, `npm run benchmark:ablation` for the ablation study.

```
Scenario                     Complexity     TTFVR p50    BG p50
---------------------------- -------------- ------------ ------------
Simple voice response        none           ~230ms       n/a
Single tool call (music)     single-tool    ~240ms       <100ms
Chart generation             multi-step     ~235ms       2.1s
Meme generation              multi-step     ~228ms       3.4s
```

TTFVR stays constant at ~200-300ms regardless of task complexity. Background brain latency increases with complexity but runs in parallel, so the user never waits.

## The comparison

```
Cascaded pipeline (Decagon-style):   ~600-900ms per turn (best case)
Cascaded pipeline (typical):         ~1000-3000ms per turn
Walkie-Talkie TTFVR:                 ~200-300ms per turn

Speedup: 2-10x faster voice response
```

The background brain takes 1-5s for complex tasks, but this is invisible to the user. They're already in conversation.
