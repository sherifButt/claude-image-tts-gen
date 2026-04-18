# Claude Image & TTS Generator

Multi-provider, cost-aware image and text-to-speech generation, packaged as a Claude Code plugin and MCP server. Inspired by [guinacio/claude-image-gen](https://github.com/guinacio/claude-image-gen).

## What this is

An MCP server + skills + slash commands + hooks bundle that:

- Generates images via Google Gemini, OpenAI, OpenRouter
- Generates speech via Google Gemini, OpenAI, ElevenLabs
- Surfaces per-call and session cost; enforces a budget cap
- Supports batch mode (50% off, ≤24h) where the provider offers it
- Writes a `regenerate.json` sidecar per output for reproducibility
- Caches identical prompt+params calls to $0

## Architecture

```
Claude Code / Desktop
        │
        ├── Skills (proactive triggers)
        ├── Slash commands (/gen-image, /gen-cost, ...)
        └── MCP server (the engine)
                ├── Provider adapters (google, openai, openrouter, elevenlabs)
                ├── Pricing table (versioned JSON)
                ├── State store (~/.claude-image-tts-gen/)
                ├── Cache, Cost tracker, Budget guard
                ├── Batch manager (submit + poll + notify)
                └── Post-processors (resize, captions, concat)
```

## State on disk

`~/.claude-image-tts-gen/`

- `session.json` — current-day spend (UTC reset)
- `projects/<cwd-hash>.json` — per-repo spend
- `batch/<job-id>.json` — active batch jobs
- `cache/<hash>/` — prompt+params → output + meta
- `presets/{styles,voices}.json`
- `budget.json` — caps + counters

## Provider × modality × batch matrix

| Provider    | Image small        | Image mid          | Image pro           | TTS small         | TTS mid             | TTS pro             | Image batch       | TTS batch |
| ----------- | ------------------ | ------------------ | ------------------- | ----------------- | ------------------- | ------------------- | ----------------- | --------- |
| Google      | Gemini Flash Image | —                  | Imagen 4            | Gemini Flash TTS  | —                   | Studio voices       | Flash only        | yes       |
| OpenAI      | gpt-image-1 low    | gpt-image-1 medium | gpt-image-1 high    | tts-1             | gpt-4o-mini-tts     | tts-1-hd            | yes               | no        |
| OpenRouter  | passthrough        | passthrough        | passthrough         | —                 | —                   | —                   | no                | —         |
| ElevenLabs  | —                  | —                  | —                   | Turbo             | Multilingual v2     | —                   | —                 | no        |

`mcp-server/src/providers/registry.ts` is the single source of truth — never hardcode model IDs in tools or skills.

## Locked decisions

- **Default provider** (both modalities): Google Gemini Flash — cheapest, supports batch.
- **Default budget**: `$5/day`, hard cap. Soft warn at 80%, block at 100%.
- **Free-tier handling**: every call treated as paid. No Gemini free-quota tracking.
- **Prompt rewriter**: enabled by default. Opt-out permanently per project via `REWRITE_PROMPTS=false`.
- **TTS auto-play**: off by default. Opt in with `AUTOPLAY=true`.

## Required env vars

At least one of:

- `GEMINI_API_KEY` (recommended — default provider)
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `ELEVENLABS_API_KEY`

Optional:

- `BUDGET_USD_PER_DAY` (default `5`)
- `REWRITE_PROMPTS` (default `true`)
- `AUTOPLAY` (default `false`)
- `OUTPUT_DIR` (default `./generated-images` and `./generated-audio`)

## Conventions

- Tier abstraction (`small | mid | pro`) is the user-facing knob; provider/model IDs are internal.
- Pricing lives in `mcp-server/src/pricing/pricing.json` with a `last_updated` field. Never hardcode prices in TS. `health_check` warns when pricing is >30 days stale.
- Every state write goes through `state/store.ts` with `proper-lockfile` (parallel-safe).
- Every gen tool returns `{ files, cost: { unit, total }, sessionTotal, providerUsed, modelUsed }`.
- Errors are structured: `{ code, message, suggestedFix }`. Never surface raw provider error blobs.
- `ffmpeg` and `sharp` are optional deps. Tools that need them detect availability at call time and return a structured "install X" error if missing.
- Budget enforcement happens **pre-call** in every gen tool. The PostToolUse hook is for *display* tally only, not enforcement.

## MCP tool surface

- `create_asset` — abstract catch-all (deliberately generic name; nudges Claude toward skill use)
- `generate_image`, `generate_speech` — explicit per-modality
- `estimate_cost` — dry-run pricing
- `batch_submit`, `batch_status`
- `regenerate` — re-runs from a sidecar
- `session_spend`, `set_budget`, `export_spend`
- `health_check`
- `save_style_preset`, `save_voice_preset`, `list_presets`
- `post_process` — resize / webp / captions

## Repo layout

```
.claude-plugin/        # plugin manifest
mcp-server/            # MCP server + CLI (TypeScript, bundled to dist/)
  src/
    server.ts cli.ts
    providers/         # google, openai, openrouter, elevenlabs, registry
    tools/             # one file per MCP tool
    pricing/           # pricing.json + refresh script
    state/             # session, project, budget, store (lockfile)
    cache/             # hash + store
    elicitation/       # MCP user prompts
    failover/          # provider retry with logged reason
    chunker/           # TTS sentence-boundary splitter
    post/              # image resize, captions, audio concat
    sidecar/           # regenerate.json read/write
    util/              # errors, logger, lock
skills/
  image-generation/    # SKILL.md + prompts/
  speech-generation/   # SKILL.md + prompts/
commands/              # slash commands (gen-image, gen-cost, ...)
hooks/
  post-tool-use.sh     # appends cost to session.json
generated-images/
generated-audio/
```

## Build & test

To be populated as v0 lands. Expect: `npm install && npm run build` in `mcp-server/`.

## Working list

See [`progress.md`](./progress.md) for the active board. Cards are ordered by phase (v0 → v3); pick the next high-priority item in **To Do**.
