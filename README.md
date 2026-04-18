# Claude Image & TTS Generator

Multi-provider AI image and text-to-speech generation, packaged as a Claude Code plugin and MCP server.

Inspired by [guinacio/claude-image-gen](https://github.com/guinacio/claude-image-gen) and extended with multi-provider support, tier abstraction, batch mode, end-to-end cost tracking, MCP elicitation/sampling/notifications/resources, and a reproducible sidecar workflow.

## Features

### Generation
- **4 providers** behind a single tier abstraction (`small | mid | pro`):
  - **Google Gemini** (image: Flash + Imagen, TTS declared)
  - **OpenAI** (image: gpt-image-1 ×3 quality; TTS: tts-1, gpt-4o-mini-tts, tts-1-hd)
  - **OpenRouter** (image passthrough)
  - **ElevenLabs** (TTS with friendly voice names + raw voice IDs)
- **Image-to-image edits** via reference image input (gpt-image-1, Gemini multimodal)
- **Long-form TTS** auto-chunked at sentence boundaries, concat'd via ffmpeg
- **SRT / VTT captions** from ElevenLabs word-level timestamps
- **TTS auto-play** on macOS via `afplay` (opt-in)

### Cost awareness
- **13-model pricing table** with batch (50% off) rates and 30-day staleness warning
- **Per-call cost** in every tool response; **session ledger** persisted to `~/.claude-image-tts-gen/session.json`
- **Per-project tracking** (cwd-hashed) — `session_spend --project`
- **Budget caps** (daily / weekly / monthly) — soft warn at 80%, hard block at 100%
- **Dry-run** `estimate_cost` ranks all implemented (provider, tier) combos
- **CSV / JSON receipt export** filtered by month
- **`health_check`** pings each configured provider in parallel and reports pricing freshness

### MCP-native UX
- **Elicitation** — `create_assets` with `mode:'auto'` asks the user batch-vs-sync when ≥2 prompts queued
- **Notifications** — `batch_status` fires `notifications/message` on completion transitions
- **Sampling** — optional MCP-sampling-based prompt rewriter (image, on by default, opt-out)
- **Resources** — recent assets exposed via `claude-image-tts-gen://output/` URIs for the asset panel
- **Structured errors** with `code`, `message`, `suggestedFix`, `cause` across all tools

### Workflow
- **Cache** — identical (provider, model, modality, text, voice, params, reference) returns the cached file at $0
- **Sidecar** (`.regenerate.json`) per output for full reproducibility
- **`regenerate`** re-runs from a sidecar; **`iterate`** appends an adjustment and threads lineage
- **`variants`** — N parallel generations with auto contact-sheet PNG; **`pick_variant`** soft-deletes the rejects
- **Provider failover** on RATE_LIMIT / 5xx / timeout with logged cost delta
- **Style + voice presets** — named reusable defaults applied via `style` / `voicePreset`
- **Image post-processing presets** (OG / Twitter / favicon / app icon / LinkedIn / Instagram square + story) with optional webp

### Plugin surface
- 7 slash commands: `/gen-image`, `/gen-speech`, `/gen-cost`, `/gen-budget`, `/gen-batch-status`, `/gen-presets`, `/gen-health`
- 2 proactive skills: `image-generation`, `speech-generation`

## Defaults (locked)

- Default provider (both modalities): **Google Gemini Flash** (cheapest, supports batch)
- Default budget: **$5/day**, hard cap (warn 80%, block 100%)
- Free-tier handling: every call treated as paid (no Gemini quota tracking)
- Prompt rewriter: **on** (opt-out per project with `REWRITE_PROMPTS=false`)
- TTS auto-play: **off** (opt in with `AUTOPLAY=true`)

## Installation

```sh
# Clone and build the MCP server
git clone https://github.com/sherifbutt/claude-image-tts-gen.git
cd claude-image-tts-gen/mcp-server
npm install
npm run build

# In another shell or your editor, install as a Claude Code plugin
# (point the plugin command at the repo root; the .claude-plugin/plugin.json
# and .mcp.json will be picked up automatically)
```

System dependencies (optional but recommended):
- **`ffmpeg`** — required for long-text TTS concat and audio post-processing. macOS: `brew install ffmpeg`.
- **`sharp`** (auto-installed via npm) — required for variants contact sheet and image post-processing presets.

## Configuration

Set at least one provider key:

```sh
export GEMINI_API_KEY=...        # default image + TTS provider
export OPENAI_API_KEY=...        # image (gpt-image-1) + TTS (tts-1, gpt-4o-mini-tts, tts-1-hd)
export OPENROUTER_API_KEY=...    # image passthrough
export ELEVENLABS_API_KEY=...    # TTS with timestamps
```

Optional:

```sh
export GEMINI_IMAGE_MODEL=gemini-2.5-flash-image  # override default model
export IMAGE_OUTPUT_DIR=./generated-images
export AUDIO_OUTPUT_DIR=./generated-audio
export STATE_DIR=~/.claude-image-tts-gen          # ledger + cache + presets + budget
export REWRITE_PROMPTS=true                       # MCP-sampling prompt rewriter
export AUTOPLAY=false                             # macOS afplay after TTS
export LOG_LEVEL=info
```

## Quickstart (CLI)

```sh
# Generate one image at the cheapest tier
node mcp-server/dist/cli.js -p "a teal cube on white"

# Compare costs without spending
node mcp-server/dist/cli.js --estimate-cost --speech -p "Hello world"

# Generate TTS with captions (ElevenLabs)
node mcp-server/dist/cli.js --speech -p "Long narration..." \
  --provider elevenlabs --voice aria --captions both

# Save a style preset and apply it
node mcp-server/dist/cli.js --save-style brand --provider google \
  --tier small --suffix "shot on Hasselblad, warm lighting"
node mcp-server/dist/cli.js -p "a coffee cup" --style brand

# Show today's spend
node mcp-server/dist/cli.js --session-spend

# Resize an image for share targets
node mcp-server/dist/cli.js --post-process my.png \
  --presets og,twitter,favicon --webp
```

## Status

v1.0 — see commit log for the full feature timeline. Known deferred items:
- **Google TTS sync** — declared in registry, not yet wired (only batch).
- **Gemini TTS batch** — depends on Gemini TTS sync above.
- **Multi-chunk TTS captions** — single-chunk only in v1 (offset math deferred).
- **Quality fallback** for low-tier text rendering — postponed (needs OCR heuristic).

## Credits

Inspired by [guinacio/claude-image-gen](https://github.com/guinacio/claude-image-gen).
