# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-04-19

### Fixed

- **Google Gemini image batch** (`batch_submit` for `google`/image): corrected
  the outbound payload shape against the `@google/genai` SDK. `submit` now
  passes `src: InlinedRequest[]` instead of the ignored `requests` key (which
  was causing a 400 `"Must specify either an input file or a non-empty list of
  inlined requests"` from the Gemini Batch API). `poll` now reads results from
  `BatchJob.dest.inlinedResponses[]` and status from the `JOB_STATE_*` enum
  (was the non-existent `BATCH_STATE_*`). Batches of Gemini Flash Image now
  actually run and save the advertised 50% vs sync.

## [0.5.0] - 2026-04-18

### Changed

- Renamed `lmstudio` provider to the more general `local` (works with any
  OpenAI-compatible local server: Kokoro-FastAPI, Speaches, Orpheus-FastAPI,
  Chatterbox-TTS, LM Studio, …). `LMSTUDIO_BASE_URL` / `LMSTUDIO_ENABLED` env
  vars are still honored as deprecated aliases.
- Default `LOCAL_BASE_URL` is now `http://localhost:8880/v1` (Kokoro-FastAPI's
  port). Override per-backend.
- All provider adapters now validate response bodies before surfacing them.

## [0.4.0] - 2026-04-18

### Added

- Google `image/pro` tier implemented via **Imagen 4**
  (`imagen-4.0-generate-001`).
- Google TTS `small` and `pro` tiers implemented sync
  (`gemini-2.5-flash-preview-tts` and `gemini-2.5-pro-preview-tts`).

## [0.3.0] - 2026-04-18

### Fixed

- `regenerate` and `iterate` now forward the full original recipe (model, tier,
  params, voice, aspect ratio) so re-runs are truly reproducible.
- Sidecars are written as dotfiles (`.regenerate.json`) by default; opt-out via
  env.

## [0.2.0] - 2026-04-18

### Fixed

- Tools no longer silently swap providers on failure — the user-selected
  provider is honored, and tier errors now list concrete alternatives
  (`availableTiers`, `providersForTier`) in the structured error.

## [0.1.0] - 2026-04-18

### Added

- `aspectRatio` parameter on `generate_image`. For Imagen it routes through
  `imageConfig.aspectRatio`; for Gemini Flash Image it's injected into the
  prompt.

## [0.0.1] - 2026-04-18

### Added

- Initial v0+v1 release: multi-provider MCP server (Google, OpenAI,
  OpenRouter, ElevenLabs, local) with tier abstraction, cost tracking, budget
  enforcement, batch submission (Google image + OpenAI image), cache, presets,
  sidecar-based regenerate, health check, and the plugin bundle (skills, slash
  commands, hooks).

[0.5.1]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.5.1
[0.5.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.5.0
[0.4.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.4.0
[0.3.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.3.0
[0.2.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.2.0
[0.1.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.1.0
[0.0.1]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.0.1
