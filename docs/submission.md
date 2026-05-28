### Any product feedback for the OpenAI team?
The Realtime API is incredibly powerful for building interactive voice experiences. A few suggestions:

1. Latency optimization guide. We've invested time in reducing time-to-first-voice-response. A best practices document on latency tuning would help streamline development, covering optimal VAD settings, when to use server vs. client-side turn detection, and structuring function calls to avoid blocking the voice stream.

2. Native parallel tool execution. Currently, to have the voice model call a tool without pausing, you need to create your own orchestration layer, as seen with Walkie-Talkie. First-class support for non-blocking tool calls in the Realtime API, allowing the model to continue speaking while tools run, would be transformative.

3. Codex as a tool backend. We use Codex agents as versatile tool executors instead of relying on predefined functions. This approach is effective but requires manual context bridging between the voice session and Codex sandbox. Improved integration between the Realtime API and Codex, such as shared context and direct dispatch, would simplify building this architecture.

### Demo Video
### Project Description

**Walkie-Talkie** is a real-time thinking partner orchestrating a dual model setup of `gpt-realtime-2` and Codex. It pairs a live voice interaction model with parallel background agents that handle tool calling, code execution, and generative UI, so the conversation never stops while work happens behind the scenes.

### Why users need this

Today, using an AI agent means watching it work. You prompt, you wait, you read, you prompt again. Voice doesn't fix this if it's still turn-based. What people actually want is to think out loud while things get done. Walkie-Talkie lets you talk through a problem, ask for a chart, pivot to a different question, request a code change, all in one continuous conversation, while each task runs in the background and results surface as they complete.

### The architecture

When Thinking Machines released their interaction model, I recognized the same architecture I'd been building independently. Their thesis: for interactivity to scale with intelligence, it must be part of the model itself. I don't fully agree. Model plus harness becomes a powerful, collaborative agent. These are two means to the same end. Interactivity is a type of user experience, and as long as users get that experience, it doesn't matter whether the system uses a full-duplex model or cascaded scaffolding. Walkie-Talkie proves this with OpenAI's realtime voice stack. `gpt-realtime-2` handles the hard interaction problems (sub-230ms responses, pause detection, mid-sentence pivots, simultaneous listening and speaking). Background agents handle the heavy work.

### Parallel agents and context management

The background is not a fixed set of tool functions. Each background agent is a coding agent with shell access in a persistent sandbox, the same pattern that makes CLI-based agents like Codex so powerful. Instead of predefining every tool (generate_chart, run_query, etc.), the agent gets intent from the voice model and figures out *how* autonomously. Multiple agents run simultaneously, each handling a different task. The front-end coordinator dispatches tasks, tracks which agents are working, and manages the context bridge between the voice conversation and each background agent. When an agent finishes (a chart, a file, a generative UI artifact), the result routes back to the voice model, which weaves it into the conversation naturally. This makes the system an agent orchestration layer with voice as the interface.

### Why this is the correct architecture

I analyzed the five capabilities needed for natural voice interaction: speaking during user speech, pause-vs-endpoint detection, real-time semantic processing, micro-responses, and simultaneous input/output. These capabilities conflict with the demands of heavy tool execution. Separating them isn't a shortcut. It's the correct design approach.

### Links

- **Using:** gpt-realtime-2 (OpenAI Realtime API), Codex (CLI/SDK)
- **Research:** https://lilyzhng.github.io/posts/interaction-model/
- **Demo:** https://lily-walkie-talkie.vercel.app/
- **GitHub:** https://github.com/lilyzhng/walkie-talkie
