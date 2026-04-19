# Claude Image & TTS Generator

Multi-provider AI image and text-to-speech generation, packaged as a Claude Code plugin and MCP server.

Inspired by [guinacio/claude-image-gen](https://github.com/guinacio/claude-image-gen) and extended with multi-provider support, tier abstraction, batch mode, end-to-end cost tracking, MCP elicitation/sampling/notifications/resources, and a reproducible sidecar workflow.

> ## Run it 100% local — for $0/call
>
> Point this plugin at any **OpenAI-compatible local server** and generate images
> or speech without an API key, network round-trip, or dollar spent. Everything
> else (sidecar, cache, regenerate, iterate, variants, post-processing) just works.
>
> **Recommended backends:**
>
> | Backend | Install | Modality | Notes |
> |---|---|---|---|
> | [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) | `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest` | TTS | **default.** Kokoro-82M, CPU-capable, 50+ voices. Currently #1 on TTS Arena. |
> | [Speaches](https://github.com/speaches-ai/speaches) | docker-compose | TTS + STT | Kokoro + Piper + Whisper in one container. |
> | [Orpheus-FastAPI](https://github.com/Lex-au/Orpheus-FastAPI) | clone + pip + LLM backend | TTS | Orpheus-3B with emotion tags (`<laugh>`, `<sigh>`, ...). Two processes. |
> | [Chatterbox-TTS-API](https://github.com/travisvn/chatterbox-tts-api) | `uv sync && uv run main.py` | TTS | Voice cloning. GPU recommended. |
>
> ```sh
> # Kokoro-FastAPI is default; for any other server, override the base URL:
> export LOCAL_BASE_URL=http://localhost:8880/v1
>
> # See what's loaded
> node mcp-server/dist/cli.js --check-local
>
> # TTS against the local server
> node mcp-server/dist/cli.js --speech -p "hello world" \
>   --provider local --model kokoro
> ```
>
> Opt in via `LOCAL_ENABLED=true` to include the local provider in the failover chain.
>
> **Not supported as a TTS backend: [LM Studio](https://lmstudio.ai/).** LM Studio's
> OpenAI-compatible server only exposes `/v1/chat/completions`, `/v1/completions`,
> and `/v1/embeddings` — no `/v1/audio/speech` or `/v1/images/generations`. Running
> Orpheus or a diffusion model inside LM Studio will not make TTS or image
> generation work through this provider. Use Kokoro-FastAPI (or one of the others
> above) instead. `check_local` will flag an LM-Studio-style server with a warning.

## Features

### Generation
- **5 providers** behind a single tier abstraction (`small | mid | pro`):
  - **Google Gemini** (image: Flash + Imagen, TTS declared)
  - **OpenAI** (image: gpt-image-1 ×3 quality; TTS: tts-1, gpt-4o-mini-tts, tts-1-hd)
  - **OpenRouter** (image passthrough)
  - **ElevenLabs** (TTS with friendly voice names + raw voice IDs)
  - **🖥 Local (`provider: local`)** — any OpenAI-compatible server (Kokoro-FastAPI, Speaches, Orpheus-FastAPI, Chatterbox, ...). $0/call, no API key, no rate limit.
- **Image-to-image edits** via reference image input (gpt-image-1, Gemini multimodal, local server if it supports `/v1/images/edits`)
- **Long-form TTS** auto-chunked at sentence boundaries, concat'd via ffmpeg
- **SRT / VTT captions** from ElevenLabs word-level timestamps
- **TTS auto-play** on macOS via `afplay` (opt-in)
- **Zero-shot voice cloning** via `--reference-audio <path>` against `--provider local` + Chatterbox-TTS or a Coqui-TTS / XTTS server (for ElevenLabs cloning, create the voice on elevenlabs.io/voice-lab and pass its ID via `--voice`)

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

### Claude Code (recommended)

Two commands inside a Claude Code session — no clone, no build:

```
/plugin marketplace add sherifButt/claude-image-tts-gen
/plugin install claude-image-tts-gen@claude-image-tts-gen-marketplace
```

Then set at least one provider key (see [Configuration](#configuration)) and start a new session. The plugin registers its slash commands (`/gen-image`, `/gen-speech`, …) and MCP tools automatically.

System dependencies (optional but recommended):
- **`ffmpeg`** — required for long-text TTS concat and audio post-processing. macOS: `brew install ffmpeg`.
- **`sharp`** — bundled with the MCP server via npm; no manual install needed.

### Manual / development install

If you want to hack on the MCP server, run the CLI standalone, or use this outside Claude Code:

```sh
git clone https://github.com/sherifButt/claude-image-tts-gen.git
cd claude-image-tts-gen/mcp-server
npm install
npm run build      # bundles dist/server.js, dist/cli.js, dist/refresh.js
```

Wire the built server into Claude Code manually:

```sh
claude mcp add --transport stdio claude-image-tts-gen \
  --env GEMINI_API_KEY=$GEMINI_API_KEY \
  -- node /absolute/path/to/claude-image-tts-gen/mcp-server/dist/server.js
```

Or point any MCP-aware client at `dist/server.js` directly — the `mcpServers` block in `.claude-plugin/plugin.json` shows the env the server reads.

## Configuration

Set at least one provider key — **or** run a local OpenAI-compatible server (no key required):

```sh
export GEMINI_API_KEY=...        # default image + TTS provider
export OPENAI_API_KEY=...        # image (gpt-image-1) + TTS (tts-1, gpt-4o-mini-tts, tts-1-hd)
export OPENROUTER_API_KEY=...    # image passthrough
export ELEVENLABS_API_KEY=...    # TTS with timestamps

# Local server (Kokoro-FastAPI / Speaches / Orpheus-FastAPI / ...)
export LOCAL_BASE_URL=http://localhost:8880/v1   # default (Kokoro-FastAPI's port)
export LOCAL_ENABLED=true                         # opt-in to failover chain
# Back-compat: LMSTUDIO_BASE_URL / LMSTUDIO_ENABLED are still read.
```

Optional:

```sh
export GEMINI_IMAGE_MODEL=gemini-2.5-flash-image  # override default model
export IMAGE_OUTPUT_DIR=./generated-images
export AUDIO_OUTPUT_DIR=./generated-audio
export STATE_DIR=~/.claude-image-tts-gen          # ledger + cache + presets + budget
export REWRITE_PROMPTS=true                       # MCP-sampling prompt rewriter
export AUTOPLAY=false                             # macOS afplay after TTS
export EMIT_SIDECAR=false                         # skip .regenerate.json per output (see below)
export LOG_LEVEL=info
```

## Sidecars (`.regenerate.json`)

Every generation writes a hidden sidecar file next to the output — e.g. for
`docs/blog/hero.png`, the plugin writes `docs/blog/.hero.png.regenerate.json`.
The sidecar captures the full recipe (prompt, provider, model, tier, aspect
ratio, params, cost, lineage) so two tools work later:

- **`regenerate <path>`** — re-run the exact same brief. Useful for a fresh
  roll of the dice on a prompt you liked.
- **`iterate <path> --adjustment "warmer lighting"`** — re-run with a tweak,
  parent → child lineage tracked in the new sidecar.

### How to deal with them

- **Just use them.** The dotfile name keeps `ls` and most git UIs tidy.
  `.gitignore` them with `.*.regenerate.json` if you don't want them in VCS.
- **One-shot, don't want it:** pass `sidecar: false` (MCP) or `--no-sidecar` (CLI).
- **Project never uses regenerate/iterate:** set `EMIT_SIDECAR=false`.
- **Old-style sidecars** from v0.2 and earlier (`foo.png.regenerate.json`
  without the leading dot) are still read as a fallback — no migration needed.

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

# Free local TTS via Kokoro-FastAPI
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest  # in another terminal
node mcp-server/dist/cli.js --check-local
node mcp-server/dist/cli.js --speech -p "hello world" \
  --provider local --model kokoro

# Zero-shot voice cloning via Chatterbox-TTS (or any XTTS-style server)
# Start the backend on its own port, then:
export LOCAL_BASE_URL=http://localhost:4123/v1
node mcp-server/dist/cli.js --speech -p "read this in my voice" \
  --provider local --model chatterbox \
  --reference-audio ~/voice-samples/me.wav
```

## Status

v0.4.0 — see commit log for the full feature timeline. Implemented since v0.2:
- **Google image pro** (Imagen 4) — photoreal landscape/portrait without needing OPENAI_API_KEY.
- **Google TTS sync** (Gemini 2.5 Flash TTS / Pro TTS) — 30 prebuilt voices, default `Kore`. Returns `.wav`.

Known deferred items:
- **Gemini TTS batch** — sync implementation shipped in 0.4.0; batch uses the same SDK shape and will follow.
- **Multi-chunk TTS captions** — single-chunk only in v1 (offset math deferred).
- **Quality fallback** for low-tier text rendering — postponed (needs OCR heuristic).

## Credits

Inspired by [guinacio/claude-image-gen](https://github.com/guinacio/claude-image-gen).
