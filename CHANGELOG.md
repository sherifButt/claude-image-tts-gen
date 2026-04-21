# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.8] - 2026-04-21

### Changed

- **Reverted `plugin.json` to 0.6.x-style shell env var pattern.**
  After 0.7.0-0.7.7 (seven hotfix releases, six different approaches),
  `${user_config.foo}` substitution in the `mcpServers.env` block was
  conclusively the blocker that stopped Claude Code from spawning the
  plugin's MCP server (silent failure, no error surfaced). 0.6.0 —
  still running cleanly in older sessions per `ps` — uses
  `${SHELL_VAR:-default}` shell-style interpolation with no
  `userConfig`. That pattern is now restored.
- **`userConfig` schema removed from `plugin.json`.** Keeping it while
  env refers to shell env vars would be misleading: userConfig values
  would collect in the install prompt but never reach the MCP server.
  Users configure API keys and preferences via shell env vars
  (see `README.md` → Configuration). Keychain-stored secrets and the
  install-time prompt UX are trade-offs accepted to get a working
  plugin back.
- **All of today's v0.7.0 code improvements are retained** — auto-chunk
  on length errors (`INPUT_TOO_LONG`), `voiceDefaulted` signal,
  per-provider default voice env vars (`GEMINI_DEFAULT_VOICE`,
  `OPENAI_DEFAULT_VOICE`, `ELEVENLABS_DEFAULT_VOICE`,
  `LOCAL_DEFAULT_VOICE`), `debug: true` flag for chunk debugging.
  Only the plugin manifest surface reverted.

### Migration note

Users installing for the first time on 0.7.8+ need to set at least
`GEMINI_API_KEY` as a shell env var before starting Claude Code. If
you had values stored via the (now-removed) `userConfig` prompt in
0.7.0-0.7.7, copy them out of `~/.claude/settings.json` under
`pluginConfigs[<plugin-id>].options` and from the keychain, and
set them as shell env vars.

## [0.7.7] - 2026-04-21

### Fixed

- **Plugin MCP server silently failed to spawn with external
  `plugin-mcp.json`.** The `mcpServers` pointer in plugin.json
  (`"mcpServers": "./plugin-mcp.json"`) loaded the config correctly
  per `claude plugin list --json` but the MCP server never appeared
  in `/mcp` — at session start, Claude Code didn't resolve
  `${CLAUDE_PLUGIN_ROOT}` for externally-referenced mcp configs,
  leading to a silent spawn failure. Confirmed by v0.6.0 (inline
  mcpServers, still running in older sessions per `ps`) working
  fine with the exact same `${CLAUDE_PLUGIN_ROOT}` pattern. Moved
  mcpServers back inline in `plugin.json`, matching the pattern
  chrome-devtools-mcp and other working plugins use. Removed
  `plugin-mcp.json`.

## [0.7.6] - 2026-04-21

### Fixed

- **MCP server "✗ Failed to connect" caused by filename collision with
  Claude Code's project-MCP discovery.** `.mcp.json` at the plugin root
  doubles as a valid Claude Code *project*-level MCP config. When a
  user runs Claude Code inside the plugin's source repo (or any repo
  that has a `.mcp.json`), Claude Code picks it up as a project MCP
  config, where `${CLAUDE_PLUGIN_ROOT}` doesn't resolve — causing a
  failed-to-connect spawn. Renamed `.mcp.json` → `plugin-mcp.json`
  and updated the `mcpServers` pointer in `plugin.json` accordingly.
  Non-discovery name avoids the collision.

  To clean up the stale project-scope entry Claude Code may have
  registered while this was broken, run:
  ```
  claude mcp remove claude-image-tts-gen -s project
  ```

## [0.7.5] - 2026-04-21

### Fixed

- **MCP server not auto-discovered from `.mcp.json`.** Under Claude Code
  2.1.112, the plugin installed and enabled cleanly but its MCP server
  never appeared in `/mcp` — the `.mcp.json` at the plugin root wasn't
  being picked up by auto-discovery (unlike `housecallpro-mcp` and
  other reference plugins). Added an explicit `"mcpServers": "./.mcp.json"`
  pointer in `plugin.json` to force the plugin loader to find it. Likely
  a 2.1.112 regression; the explicit path works across versions.

## [0.7.4] - 2026-04-21

### Fixed

- **Install completed silently with no userConfig prompt.** 0.7.3 left
  every userConfig field optional (no `required: true` flags), which
  meant Claude Code skipped the configuration prompt entirely on
  install — the plugin landed with no API key set, silently unusable.
  `gemini_api_key` is now marked `required: true` so the install flow
  actually asks for it. Every other field stays optional and can be
  left blank to accept built-in defaults.

## [0.7.3] - 2026-04-21

### Fixed

- **Plugin still failed to enable after 0.7.2's fallback-syntax fix.**
  The `${user_config.foo:-<default>}` shell-style default didn't get
  evaluated by Claude Code's inline-manifest substitution path — the
  runtime kept rejecting the plugin with "Missing required user
  configuration value." Turns out the bare `${user_config.foo}` syntax
  works fine when the `mcpServers` block lives in a separate `.mcp.json`
  file at the plugin root, but not when inlined in `plugin.json`. The
  `mcpServers` block has been moved to `.mcp.json` (the pattern used by
  working plugins like `housecallpro-mcp`), and fallback syntax dropped
  since it's no longer needed.

## [0.7.2] - 2026-04-21

### Fixed

- **Plugin failed to enable when userConfig fields were left empty.**
  0.7.1's manifest referenced user_config values in `mcpServers.env` with
  bare `${user_config.foo}` syntax. The Claude Code runtime treats every
  such reference as a *required* input and refused to enable the plugin
  with "Missing required user configuration value: gemini_api_key" any
  time a field wasn't filled in. Every env reference now uses the
  shell-style fallback form `${user_config.foo:-<default>}`, matching
  how the original 0.6.x plugin.json read shell env vars:
  - String fields default to empty; config.ts applies its own defaults.
  - `local_enabled` / `autoplay` default to `false`; `rewrite_prompts`
    / `emit_sidecar` default to `true`; `log_level` defaults to `info`
    — matching the existing config.ts fallbacks.

## [0.7.1] - 2026-04-21

### Fixed

- **Plugin manifest validation failure on install.** `userConfig` fields in
  0.7.0 were missing the required `type` and `title` keys, causing Claude
  Code to reject the manifest with "expected one of string|number|boolean
  |directory|file" on every field. All 18 fields now declare the correct
  `type` (string / boolean / directory) and a human-readable `title`.
  Boolean fields (`local_enabled`, `autoplay`, `rewrite_prompts`,
  `emit_sidecar`) render as toggles in the install prompt; directory
  fields (`image_output_dir`, `audio_output_dir`, `state_dir`) render as
  path pickers.

## [0.7.0] - 2026-04-21

### Fixed

- **Long-text TTS no longer fails on provider length errors.** Single-call
  TTS that exceeded a provider's output duration or input token limit
  previously threw `VALIDATION_ERROR`, leaving callers to chunk the text
  externally. That escape hatch was the root cause of several downstream
  bugs: lost voice parameters across N separate calls, manual ffmpeg
  concat, cache misses, sidecar fragmentation. `mapProviderError` now
  detects length-related rejections and returns a new `INPUT_TOO_LONG`
  code; `generate_speech` catches it and auto-retries on the same provider
  via the built-in chunker, producing one stitched output file. Chunking
  triggers both pre-emptively (when text exceeds `maxCharsPerCall`) and
  reactively (when the provider rejects a shorter input for
  output-duration / token-limit reasons).
- **`chunkFiles` no longer appears in the default response.** The
  per-chunk file paths were only meant for debugging but showed up in
  every chunked call's JSON, inviting callers to stitch a second time.
  Gated behind a new `debug: true` argument; `files[0]` is always the
  sole deliverable.

### Added

- **`voiceDefaulted` flag** on the `generate_speech` response. `true` when
  neither `voice` nor `voicePreset` was passed and the slot default was
  used — surfaces the "you didn't spec a voice" case so callers catch
  voice mismatches before spending on a long run.
- **Per-provider default voice env vars**: `GEMINI_DEFAULT_VOICE`,
  `OPENAI_DEFAULT_VOICE`, `ELEVENLABS_DEFAULT_VOICE`,
  `LOCAL_DEFAULT_VOICE`. Each wins over the slot default when no
  explicit `--voice` or preset is passed, but only when the value is
  valid for the resolved slot's voice list — a Gemini name like
  `Charon` will be silently skipped on ElevenLabs instead of producing
  a cryptic provider 400. Applied at every slot resolution point
  (initial, per-chunk, per-failover-attempt), so defaults survive
  provider swaps and chunked retries.
- **Plugin `userConfig` schema** in `.claude-plugin/plugin.json`. Claude
  Code now prompts for API keys and preferences at install time; keys
  flagged `sensitive: true` are stored in the system keychain. Covers
  all 18 env vars the MCP server reads. Shell env vars still work for
  direct CLI invocation.

### Changed

- **`generate_speech` tool description** updated to tell callers: pass
  the full text in one call; the tool chunks and stitches automatically;
  pre-chunking externally loses voice/cache/sidecar fidelity.

### Removed

- **`BUDGET_USD_PER_DAY` env var** dropped from `plugin.json`. It was
  declared there but never read anywhere in the MCP server — budget
  lives in `~/.claude-image-tts-gen/budget.json` and is managed via the
  `set_budget` tool.
- **`LMSTUDIO_BASE_URL` / `LMSTUDIO_ENABLED`** removed from the install
  prompt surface. `config.ts` still reads them for backward compat if
  set via shell env, but new users configure `LOCAL_*` via `userConfig`.

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
