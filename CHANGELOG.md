# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-04-19

### Fixed

- **Local provider lied about output mime.** `providers/local.ts` hard-coded
  `mimeType: "audio/mpeg"` regardless of what the server actually returned,
  even though local backends routinely ignore the `response_format: "mp3"`
  hint (Chatterbox-TTS, for one, always returns WAV). The
  `saveAudioRespectingPath` helper added in 0.5.2 saw the claimed mpeg mime
  agreed with the `.mp3` output path and skipped the transcode — producing
  WAV bytes saved at `.mp3`, same bug shape as 0.5.2 but one layer deeper.
  The provider now sniffs the first bytes (RIFF / ID3 / MPEG sync / OggS /
  fLaC) and reports the real mime. The existing save path then transcodes
  when the caller's extension disagrees.
- Affects both regular local TTS and voice-cloning calls.

## [0.6.0] - 2026-04-19

### Added

- **Zero-shot voice cloning** via `generate_speech --referenceAudioPath <path>`
  (CLI: `--reference-audio`). Pass a short `.wav`/`.mp3` sample and the
  `local` provider forwards it to a cloning-capable backend. Accepted shapes
  cover **Chatterbox-TTS** (`reference_audio` base64 + `audio_prompt_path`)
  and **Coqui-TTS / XTTS**-style servers (`speaker_wav` path) — backends
  ignore fields they don't recognize, so whichever key matches wins.
- The reference file's sha256 fingerprint is mixed into the cache key so
  identical text + voice with a different reference cache separately.
- The reference path is recorded in the sidecar input so `regenerate` and
  `iterate` reproduce the cloned voice without re-specifying it.
- New `pinToPreferred` option on the failover helper — cloning calls skip
  the fallback chain so we never silently swap to a provider that would
  ignore the reference audio.
- For ElevenLabs cloning, no plugin change is needed: create the voice on
  elevenlabs.io/voice-lab and pass its voice ID via `--voice` (raw IDs were
  already accepted by the ElevenLabs adapter).

### Rejected

- `referenceAudioPath` on providers other than `local` throws a
  `VALIDATION_ERROR` pointing at ElevenLabs's voice lab for managed cloning,
  instead of silently ignoring the reference.

## [0.5.2] - 2026-04-19

### Fixed

- **Chunked TTS concat** (`generate_speech` for long text): chunks were written
  under a relative `./generated-audio/.chunks/` path while the ffmpeg concat
  listfile lived in `/tmp/`. ffmpeg's concat demuxer resolves relative paths
  against the listfile's directory, so it looked for the chunks under `/tmp/`
  and failed with `Error opening input: No such file or directory`. Chunk
  paths and the concat listfile are now absolute.
- **WAV bytes saved at `.mp3` path** (`generate_speech` with explicit
  `outputPath`): when the provider returned `audio/wav` but the user asked for
  `foo.mp3`, raw WAV bytes were written to `foo.mp3`. The file on disk now
  matches its extension — if the extensions differ, the file is transcoded via
  ffmpeg (`libmp3lame` for `.mp3`, `pcm_s16le` for `.wav`, etc.), and the
  response `mimeType` reflects what actually landed on disk. Missing ffmpeg
  produces a structured `CONFIG_ERROR` instead of a misnamed file.
- Applied uniformly across cached hits, chunked output, explicit-model, and
  failover paths.

### Added

- `saveAudioRespectingPath`, `copyAudioRespectingPath`, `transcodeAudio`, and
  `audioMimeForPath` helpers in `post/concat.ts`. `concatAudioFiles` now picks
  codec from the output extension, so a mixed-format concat (e.g. wav chunks →
  mp3 final) works in a single ffmpeg pass.

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

[0.6.1]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.6.1
[0.6.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.6.0
[0.5.2]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.5.2
[0.5.1]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.5.1
[0.5.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.5.0
[0.4.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.4.0
[0.3.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.3.0
[0.2.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.2.0
[0.1.0]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.1.0
[0.0.1]: https://github.com/sherifButt/claude-image-tts-gen/releases/tag/v0.0.1
