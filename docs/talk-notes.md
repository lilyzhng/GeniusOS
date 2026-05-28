# Walkie-Talkie Talk Notes (~3.5 min)

## Slide 1: Intro (15 sec)

"Hi, I'm Lily. I built Walkie-Talkie. It's a real-time voice agent got strong hands."

"Handy and brainy. It has dual models working together."

## Slide 2: The Gap (30 sec)

"So right now, LLM product markets falls into two buckets."

[Point to left circle]
"Full-duplex models. OpenAI Realtime, Gemini Live. They're incredible at conversation. Sub-200ms responses, they can listen while they talk. But they can't really DO anything. Weak tool calling."

[Point to right circle]
"Turn-based agents. ChatGPT, Claude, Codex. They're incredible at tasks. Strong tool calling, code execution. But it's sequential, and they cannot talk or flow with you"

[Point to overlap]
"Nothing sits in between. Walkie-Talkie is both."

## Slide 3: The Problem (40 sec)

"Here's why this matters."

[Point to pipeline diagram]
"This is the traditional voice agent pipeline. Speech-to-text, LLM Tool execution, Text-to-speech, That's 3.7 seconds of dead air. Every single turn."

[Point to meme]
"This is basically what happens. Your customer calls in, the agent says 'Great question, let me check on that,' and then whispers to a model, who whispers to another model, while the customer sits on holding forever."

"The user doesn't care how many models used. They care when silence ends. That's the wrong, inefficient architecture."

## Slide 4: How It Works (45 sec)

"So here's what we do instead. front-end interaction and background brain, one conversation."

[Point to real-time zone]
"gpt-realtime-2 sits in the front. It handles all the hard interaction problems. (Pause detection, mid-sentence pivots, simultaneous listening and speaking). 

[Point to background zone]
"Behind it, Codex agents run in parallel. Tool calls, search, retrieval, generative UI. It is very important to note that, Each one is a full coding agent in a persistent sandbox. Not a fixed set of tool functions. The agent gets intent from the front voice model and figures out HOW autonomously."

[Point to arrows]
"When a background agent finishes, the result flows back to the voice model, and it weaves it into the conversation naturally, manages the context naturally."

## Slide 5: Example + Demo (45 sec)

"Let me show you what this looks like."

[Point to flow chart]
"You say: 'Give me the visualization of that chart.' The front-end model parses intent, passes it to a background agent. That agent calls tools, renders the chart, sends it back. You see the chart on screen AND hear Jackie narrate it live. The flow never breaks."

[Point to video / click play]
"Here's a real demo."

[Let video play ~20 sec, or describe if video isn't loading]
"Notice there's no silence. The voice keeps going while the work happens in the background. That's the difference between 230 milliseconds and 3.7 seconds."

## Slide 6: Close (15 sec)

"Walkie-Talkie. Think out loud, let agents flow with your mind."

"The code is open source. The research writeup breaks down the five capabilities required for natural voice interaction, and why splitting them is the right design, not a shortcut."

"Try it. Thank you."
