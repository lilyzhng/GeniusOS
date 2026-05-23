# Walkie-Talkie → Agent Home

Voice interface for a Gemini managed agent in a persistent sandbox.

Built during DeepMind I/O Hackathon, 2026-05-23.

## Stack

- **Frontend:** hold-to-talk UI (`public/index.html`)
- **Backend:** Gemini 3.5 Flash + Antigravity managed agent

## Setup

```bash
npm install
cp .env.example .env   # add API keys
npm run dev
```

## Scripts

- `npm run dev` — dev server
- `npm run build` — compile TypeScript
- `npm start` — run compiled server
