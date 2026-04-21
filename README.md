# Claude Image & TTS Generator

Multi-provider AI image and text-to-speech generation, packaged as a Claude Code plugin and MCP server.

Provides multi-provider support, tier abstraction, batch mode, end-to-end cost tracking, MCP elicitation/sampling/notifications/resources, and a reproducible sidecar workflow.

## Why this MCP is different

There are plenty of MCP servers that wrap one vendor. This one wraps **five** (Google Gemini, OpenAI, OpenRouter, ElevenLabs, and any OpenAI-compatible local server) behind a consistent interface, and adds the cross-cutting concerns that a thin wrapper leaves to you:

- **One knob (`small | mid | pro`) spans every provider.** Code written for Gemini works unchanged against OpenAI or a local Kokoro model — swap `--provider` and the call still runs. No per-vendor quirks in your prompt code.
- **Cost-aware from the first call.** Per-call + session + per-project ledgers, hard daily/weekly/monthly budget caps enforced *pre-call* (not after the charge), dry-run `estimate_cost` that ranks every provider/tier combo, and a $0 cache for identical repeats. You know what a generation costs before you spend, and after.
- **Reproducibility built-in.** Every output gets a hidden `.regenerate.json` sidecar with the full recipe (prompt, model, tier, params, lineage). `regenerate` re-runs it; `iterate` adds a tweak and threads parent → child. Prompts never get lost in chat history.
- **Cross-cutting work is handled once, not per provider.** Provider failover with logged cost delta. Batch mode (50% off) where the vendor supports it. Long-text TTS auto-chunked at sentence boundaries and stitched via ffmpeg — **including reactive chunking when a provider rejects a single-call input as too long** (v0.7.0). SRT/VTT captions from ElevenLabs timestamps. Image post-processing presets for OG / Twitter / favicon / etc.
- **Free local escape hatch.** Same plugin, same skills, same sidecars, no API key, no network, no bill — route to Kokoro-FastAPI, Speaches, Orpheus-FastAPI, or Chatterbox-TTS. The local provider is a first-class citizen, not a bolt-on.
- **Proactive skills.** Claude invokes the plugin automatically when a task needs an image or narration, without the user having to ask. Slash commands exist for explicit control (`/gen-image`, `/gen-speech`, `/gen-cost`, …), but the default path is ambient.
- **MCP-native UX.** Elicitation (`create_assets` asks batch-vs-sync when ≥2 prompts queued), sampling (prompt rewriter), notifications (batch job completion), resources (recent outputs in the asset panel), and structured errors everywhere — no raw provider error blobs.
- **Zero-shot voice cloning.** `--reference-audio my-voice.wav` + local Chatterbox-TTS or Coqui-TTS/XTTS. Reference fingerprint is mixed into the cache key so the same text with different references doesn't collide. For ElevenLabs cloning, pass the Voice Lab ID via `--voice`.

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
- **Long-form TTS** auto-chunked at sentence boundaries, concat'd via ffmpeg. Triggers both pre-emptively (text > provider's `maxCharsPerCall`) *and* reactively (provider rejects a shorter input as too long for output-duration / token reasons — a new `INPUT_TOO_LONG` code catches that and retries with chunking on the same provider, preserving voice)
- **SRT / VTT captions** from ElevenLabs word-level timestamps
- **TTS auto-play** on macOS via `afplay` (opt-in)
- **Zero-shot voice cloning** via `--reference-audio <path>` against `--provider local` + Chatterbox-TTS or a Coqui-TTS / XTTS server (for ElevenLabs cloning, create the voice on elevenlabs.io/voice-lab and pass its ID via `--voice`)
- **Per-provider default voice env vars** (`GEMINI_DEFAULT_VOICE`, `OPENAI_DEFAULT_VOICE`, `ELEVENLABS_DEFAULT_VOICE`, `LOCAL_DEFAULT_VOICE`) so you don't have to pass `--voice` on every call. Only applied when the value is valid for the resolved slot, so a Gemini name won't leak into an ElevenLabs call.
- **`voiceDefaulted` signal** on every TTS response — when you didn't spec a voice, the response says so, letting Claude catch mismatches before spending on a long run

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

**Installation:**
```prompt
/plugin marketplace add sherifButt/claude-image-tts-gen
/plugin install claude-image-tts-gen@claude-image-tts-gen-marketplace
```

The install prompts once for your **Google Gemini API key** (the only required field — grab a free one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Every other provider key and preference is optional and falls through to sensible defaults — see [Configuration](#configuration) for how to set those later. The plugin registers its slash commands (`/gen-image`, `/gen-speech`, …) and MCP tools automatically on enable.

**Update:**
```prompt
/plugin marketplace update claude-image-tts-gen-marketplace
```

> Note: Claude Code caches marketplace data. If `/plugin install` shows an older version than [the latest release](https://github.com/sherifButt/claude-image-tts-gen/releases), run the update command above first.

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

Or point any MCP-aware client at `dist/server.js` directly — the `mcpServers` block in `.mcp.json` at the repo root shows the env the server reads. (`userConfig` lives in `.claude-plugin/plugin.json`; the server spawn config is intentionally split into `.mcp.json` — this matches the pattern Claude Code requires when `userConfig` values are referenced in the env block.)

## Configuration

**Installed via Claude Code:** the plugin declares an 18-field `userConfig` schema. On install, Claude Code prompts for the **one required field** (`gemini_api_key`) and stores it in the system keychain. The other 17 fields are optional.

**Setting optional fields after install** (voice defaults, output dirs, enabling the local provider, additional provider keys):

- **Preferred:** `/plugin` → Installed → `claude-image-tts-gen` → **Configure**. Opens the full 18-field form. *(Blocked by an upstream UI bug in Claude Code v2.1.112 where Tab/Enter don't advance between fields — tracked at [anthropics/claude-code#51538](https://github.com/anthropics/claude-code/issues/51538). Until that's fixed, use the workaround below.)*
- **Workaround for non-sensitive fields:** edit `~/.claude/settings.json` directly:
  ```json
  {
    "pluginConfigs": {
      "claude-image-tts-gen@claude-image-tts-gen-marketplace": {
        "options": {
          "gemini_default_voice": "Charon",
          "local_enabled": "true",
          "audio_output_dir": "./generated-audio"
        }
      }
    }
  }
  ```
  Additional sensitive API keys (`openai_api_key`, `elevenlabs_api_key`, etc.) can't be set this way — they go into the keychain. Until the Configure UI works, use shell env vars instead (below), or temporarily `/plugin uninstall` + reinstall to re-trigger the install prompt.

**Shell env vars still work** for direct CLI invocation, local development, and project-level overrides via `.claude/settings.json`:

```sh
# Keys — set at least one, or run a local server (no key required)
export GEMINI_API_KEY=...        # default image + TTS provider
export OPENAI_API_KEY=...        # image (gpt-image-1) + TTS (tts-1, gpt-4o-mini-tts, tts-1-hd)
export OPENROUTER_API_KEY=...    # image passthrough
export ELEVENLABS_API_KEY=...    # TTS with timestamps

# Per-provider default TTS voices (optional but recommended — saves passing --voice on every call)
export GEMINI_DEFAULT_VOICE=Charon     # male baritone (Kore is the Gemini default; Charon, Puck, Fenrir, ... are male-leaning)
export OPENAI_DEFAULT_VOICE=onyx       # male
export ELEVENLABS_DEFAULT_VOICE=<id>   # from elevenlabs.io/voice-lab
export LOCAL_DEFAULT_VOICE=am_adam     # depends on backend (am_* = male Kokoro voices)

# Local server (Kokoro-FastAPI / Speaches / Orpheus-FastAPI / ...)
export LOCAL_BASE_URL=http://localhost:8880/v1   # default (Kokoro-FastAPI's port)
export LOCAL_ENABLED=true                         # opt-in to failover chain
# Back-compat: LMSTUDIO_BASE_URL / LMSTUDIO_ENABLED are still read.
```

Other optional:

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

**Budget** isn't an env var — it's persisted in `~/.claude-image-tts-gen/budget.json` and managed via the `set_budget` MCP tool or `/gen-budget` slash command.

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

**v0.7.4** — install-flow stabilized on top of the v0.7.0 architectural pump. See [CHANGELOG.md](./CHANGELOG.md) for the full feature timeline. Highlights since v0.6:

- **Reactive chunk-on-length-error** (v0.7.0). Long-text TTS used to fail when a provider rejected the input on duration/token grounds, forcing callers to chunk externally and lose voice/cache/sidecar fidelity. A new `INPUT_TOO_LONG` error code catches those rejections and auto-retries with chunking on the same provider.
- **Per-provider default voices** (v0.7.0). `GEMINI_DEFAULT_VOICE=Charon` etc., scoped per provider so voice names don't leak across incompatible namespaces. Applied at every slot resolution point.
- **Plugin `userConfig` migration** (v0.7.0 → v0.7.4). Marketplace-ready install flow: Claude Code prompts for `gemini_api_key` at install, stores it in the system keychain. `mcpServers` now lives in `.mcp.json` (not inline in `plugin.json`) because inline + `${user_config.*}` references break Claude Code's optional-field validator — working plugins like `housecallpro-mcp` follow the same split. The 18-field schema declares `type` + `title` on every field (required by the runtime, though undocumented as of 2026-04).
- **Zero-shot voice cloning** (v0.6.0). `--reference-audio` via Chatterbox-TTS or XTTS. Sidecar records the path so `regenerate`/`iterate` reproduces the cloned voice.
- **Google image pro** (v0.4.0). Imagen 4 for photoreal landscape/portrait.
- **Google TTS sync** (v0.4.0). Gemini 2.5 Flash TTS / Pro TTS with 30 prebuilt voices.

Known deferred items:

- **Gemini TTS batch** — sync shipped; batch uses the same SDK shape and will follow.
- **Multi-chunk TTS captions** — single-chunk only (multi-chunk timestamp-offset math deferred).
- **Quality fallback** for low-tier text rendering — needs an OCR heuristic.
- **Post-install Configure UI** — blocked upstream on [anthropics/claude-code#51538](https://github.com/anthropics/claude-code/issues/51538); workaround documented above.
- **Video modality (HeyGen + Synthesia)** — coming in v0.8.0 as native provider adapters, not passthrough, so video inherits the same cost / sidecar / failover machinery.
