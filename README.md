# Claude Image & TTS Generator

Multi-provider AI image and text-to-speech generation, packaged as a Claude Code plugin and MCP server.

Inspired by [guinacio/claude-image-gen](https://github.com/guinacio/claude-image-gen) and extended with multi-provider support, tiered model selection, batch mode, and end-to-end cost awareness.

## Features

- **Multi-provider**: Google Gemini, OpenAI, OpenRouter (image), ElevenLabs (TTS)
- **Tiered models** (`small` / `mid` / `pro`) with live cost shown per call
- **Cost-aware**: per-call cost, session tally, daily budget cap, dry-run estimates
- **Batch mode**: 50% off via Gemini and OpenAI batch APIs (≤24h turnaround)
- **Reproducible**: every output ships with a `regenerate.json` sidecar
- **Cached**: identical prompt+params returns the existing file at $0
- **TTS extras**: long-text chunking, SRT/VTT captions, optional auto-play
- **Image extras**: variants + contact sheet, auto-targets (Open Graph / Twitter / app icon), reference-image edits
- **Personalization**: named style and voice presets

## Defaults (locked)

- Default provider (both modalities): **Google Gemini Flash** (cheapest, supports batch)
- Default budget: **$5/day**, hard cap (warn 80%, block 100%)
- Free-tier handling: every call treated as paid
- Prompt rewriter: **on** (opt out per project with `REWRITE_PROMPTS=false`)
- TTS auto-play: **off** (opt in with `AUTOPLAY=true`)

## Installation

To be published once v0 lands. See [`progress.md`](./progress.md) for status.

## Configuration

Set at least one provider key:

```sh
export GEMINI_API_KEY=...        # recommended (default provider)
export OPENAI_API_KEY=...
export OPENROUTER_API_KEY=...
export ELEVENLABS_API_KEY=...
```

Optional:

```sh
export BUDGET_USD_PER_DAY=5
export REWRITE_PROMPTS=true
export AUTOPLAY=false
export OUTPUT_DIR=./generated-images
```

## Status

Early development. See [`progress.md`](./progress.md) for the live task board and [`CLAUDE.md`](./CLAUDE.md) for architecture and conventions.

## Credits

Inspired by [guinacio/claude-image-gen](https://github.com/guinacio/claude-image-gen).
