# Claude Image & TTS Generator — Project Board

## To Do

### TTS long-form support

  - due: 2026-05-06
  - tags: [tts, post-process]
  - priority: medium
  - workload: Medium
  - defaultExpanded: true
  - steps:
      - [ ] "Make it more X" rewrites the prior prompt; preserves lineage in sidecar
      - [ ] `n=4` variants in one call where the provider supports it
      - [ ] Auto-composite contact sheet (sharp grid) for variant selection
      - [ ] User picks keeper → other variants moved to trash subdirectory

### TTS long-form support

  - due: 2026-05-06
  - tags: [tts, post-process]
  - priority: medium
  - workload: Medium
  - steps:
      - [ ] Sentence-boundary chunker (respects provider char limits)
      - [ ] ffmpeg concat into a single file
      - [ ] Detect missing ffmpeg → return structured "install ffmpeg" error
      - [ ] Single-chunk fallback if input fits in one call

### TTS captions (SRT / VTT)

  - due: 2026-05-07
  - tags: [tts, post-process]
  - priority: medium
  - workload: Medium
  - steps:
      - [ ] Pull word-level timestamps where the provider returns them
      - [ ] Emit `.srt` and `.vtt` alongside the audio file
      - [ ] Skip silently when timestamps are unavailable

### Auto-play (opt-in)

  - due: 2026-05-07
  - tags: [tts, ux]
  - priority: low
  - workload: Easy
  - steps:
      - [ ] `AUTOPLAY=true` triggers `afplay` on macOS after TTS gen
      - [ ] Off by default; documented in README and CLAUDE.md

### Image post-processing presets

  - due: 2026-05-08
  - tags: [image, post-process]
  - priority: medium
  - workload: Medium
  - steps:
      - [ ] Open Graph (1200×630), Twitter card (1200×675), favicon, app icon (1024×1024)
      - [ ] webp conversion
      - [ ] sharp dependency check; structured error if missing
      - [ ] Exposed via `tools/post-process.ts` and chainable from `generate_image`

### Style & voice presets

  - due: 2026-05-09
  - tags: [presets, ux]
  - priority: medium
  - workload: Medium
  - steps:
      - [ ] `presets/styles.json` and `presets/voices.json`
      - [ ] `save_style_preset`, `save_voice_preset`, `list_presets` tools
      - [ ] Presets resolve at gen time; user references them by name
      - [ ] Slash command for quick save

### Reference image input

  - due: 2026-05-09
  - tags: [image, providers]
  - priority: medium
  - workload: Medium
  - steps:
      - [ ] Pass reference image to `gpt-image-1` (edits endpoint)
      - [ ] Pass reference image to Gemini multimodal input
      - [ ] Sidecar records reference path for reproducibility

### Prompt rewriter via MCP sampling (opt-out)

  - due: 2026-05-10
  - tags: [ux, mcp, sampling]
  - priority: medium
  - workload: Medium
  - steps:
      - [ ] Server uses MCP sampling to ask the host LLM to improve the prompt
      - [ ] Provider-specific best-practice templates (Imagen verbose, gpt-image-1 concise)
      - [ ] On by default; disabled per project with `REWRITE_PROMPTS=false`
      - [ ] Sidecar stores both original and rewritten prompt

### MCP resources for asset panel

  - due: 2026-05-10
  - tags: [mcp, ux]
  - priority: low
  - workload: Medium
  - steps:
      - [ ] Expose generated outputs as MCP resources
      - [ ] Claude Desktop renders a navigable thumbnail / audio list

### Per-project tracking

  - due: 2026-05-10
  - tags: [cost, state]
  - priority: low
  - workload: Easy
  - steps:
      - [ ] Hash cwd → `projects/<hash>.json`
      - [ ] Append per-call cost to project file alongside session
      - [ ] `session_spend --project` shows per-repo totals

### CSV receipt export

  - due: 2026-05-11
  - tags: [cost, export]
  - priority: low
  - workload: Easy
  - steps:
      - [ ] `tools/export-spend.ts` with `--month`, `--format csv|json`
      - [ ] Columns: timestamp, provider, model, units, cost, project

### Quality fallback for text rendering

  - due: 2026-05-11
  - tags: [quality, image]
  - priority: low
  - workload: Hard
  - steps:
      - [ ] Detect garbled text in `small` tier image outputs (heuristic, not OCR-perfect)
      - [ ] Elicit "retry at mid tier? +$X"
      - [ ] On approval, regenerate at the next tier; preserve lineage

### Slash commands & skill heuristics polish

  - due: 2026-05-11
  - tags: [skill, slash, ux]
  - priority: medium
  - workload: Easy
  - steps:
      - [ ] `/gen-image`, `/gen-speech`, `/gen-cost`, `/gen-budget`, `/gen-batch-status`, `/gen-presets`, `/gen-health`
      - [ ] Skill tier-suggestion heuristics in `skills/*/SKILL.md` (icon → small, hero → pro, narration → mid)
      - [ ] Skill instructs Claude to prefer batch when ≥2 prompts queued and no rush

## Done

### Iteration loop & variants

  - due: 2026-05-03
  - tags: [ux, image, iteration]
  - priority: medium
  - workload: Medium
  - steps:
      - [x] `tools/iterate.ts` — reads parent sidecar, builds new prompt (`append` or `replace` mode), calls underlying gen with `parentSidecar` so lineage threads
      - [x] `tools/variants.ts` — N parallel `generateImage` calls + auto contact sheet (default n=4, max 9 → 3x3)
      - [x] `post/contact-sheet.ts` — sharp-based grid composer; sqrt-based layout (4→2x2, 9→3x3), white background, 12px gap, 512px cells; clear "install sharp" error if missing
      - [x] `tools/pick-variant.ts` — soft-deletes non-keepers, their sidecars, and the contact sheet to `{dir}/.trash/`
      - [x] MCP tools: `iterate`, `variants`, `pick_variant`
      - [x] CLI: `--iterate <path> --adjustment <text>`, `--variants <prompt> --n <count>`, `--pick-keeper / --pick-variants / --pick-sheet`
      - [x] Smoke tested end-to-end: 4 inputs → 446KB contact sheet PNG → pick var-2 → keeper retained, others + sheet in `.trash/`
    ```md
    Variants always runs sync-parallel (no provider-specific n>1 path) — keeps
    the implementation provider-agnostic. Sharp loaded lazily so its absence
    only fails contact-sheet calls, not the rest of the server.
    ```

### Provider failover with logged reason

  - due: 2026-05-04
  - tags: [reliability, providers]
  - priority: medium
  - workload: Medium
  - steps:
      - [x] `util/failover.ts` — `getFailoverOrder`, `isRetryable`, `withFailover` generic wrapper
      - [x] Default order: image=google,openai,openrouter; tts=openai,google,elevenlabs
      - [x] Filters providers without an API key (won't try them)
      - [x] Skips providers where the requested tier isn't implemented (silently in chain; clear error if it's the preferred provider on first attempt)
      - [x] Retryable codes: `RATE_LIMIT`, `PROVIDER_ERROR`, `PROVIDER_TIMEOUT`. Auth/content-policy/validation/budget all stop immediately.
      - [x] `generate_image` and `generate_speech` use `withFailover`; explicit `--model` overrides skip failover
      - [x] Result carries `failover: {originalProvider, originalModel, originalError, fallbackProvider, fallbackModel, costDelta, currency}` when failover occurred
      - [x] Smoke tested: no keys → CONFIG_ERROR with "set at least one"; only OPENAI key → google filtered, openai attempted directly with real 401 (AUTH_FAILED, not retried — correct).
    ```md
    Failover wrapper is generic over the provider call (callback). The tool
    computes costDelta after success by re-estimating both original and
    fallback prices. Pre-existing pricing-key bug for explicit --model on
    OpenAI surfaces here (variant-keyed entries) — separate follow-up.
    ```

### Batch UX — elicitation & notifications

  - due: 2026-05-02
  - tags: [batch, ux, mcp]
  - priority: high
  - workload: Medium
  - steps:
      - [x] `tools/create-assets.ts` orchestrator with `mode: 'batch' | 'sync' | 'auto'`
      - [x] `checkBatchAvailability` returns `{available, syncCost, batchCost, savings}` for any (modality, prompts, provider, tier)
      - [x] Single prompt OR non-batchable → forced sync
      - [x] Sync mode runs parallel `generateImage`/`generateSpeech` calls via `Promise.all`
      - [x] MCP elicitation in `server.ts handleCreateAssets`: when `mode='auto'` and ≥2 batchable prompts, sends `elicitation/create` with batch-vs-sync schema
      - [x] Graceful fallback: client without elicitation support → defaults to sync
      - [x] MCP `notifications/message` sent when `batch_status` observes in_progress→completed/partial_failure/failed transition
      - [x] `batch_status` returns `transitioned` flag so handler can fire one-shot notification
      - [x] CLI `--create-assets <file> --mode batch|sync|auto` (auto defaults to sync from CLI)
      - [x] Existing `regenerate` already works on any sidecar — batch outputs included
      - [x] Smoke tested: batch+openai → CONFIG_ERROR; sync+openai → CONFIG_ERROR; batch+openrouter → VALIDATION_ERROR (no batch)
    ```md
    Tool stays pure: it accepts a resolved 'batch' | 'sync' mode. The MCP
    handler in server.ts intercepts 'auto' mode, runs MCP elicitation, then
    calls the tool with the resolved mode. CLI can't elicit so 'auto' falls
    back to 'sync' there.
    ```

### Batch infrastructure (Google image + OpenAI image; Gemini TTS deferred)

  - due: 2026-05-01
  - tags: [batch, providers, async]
  - priority: high
  - workload: Hard
  - steps:
      - [x] `batch/types.ts` — `BatchJob`, `BatchPrompt`, `BatchOutput`, `BatchStatus`
      - [x] `batch/store.ts` — locked read/write of `~/.claude-image-tts-gen/batch/<jobId>.json`, `listJobs`, `updateJob`
      - [x] `batch/provider.ts` — `BatchProvider` interface (`submit`, `poll`)
      - [x] `batch/google.ts` — Gemini Image batch via `@google/genai` `batches.create`/`batches.get` (cast through unknown)
      - [x] `batch/openai.ts` — OpenAI Image batch via Files API + `batches.create` JSONL flow + `output_file_id` download
      - [x] `batch/provider-registry.ts` — factory with `StructuredError(VALIDATION_ERROR)` for unimplemented combos
      - [x] `tools/batch-submit.ts` — pre-flight budget check at batch rate (50% off), persist job, submit
      - [x] `tools/batch-status.ts` — poll, on completion: download outputs, save files, write sidecars + cache + ledger entries
      - [x] MCP tools: `batch_submit`, `batch_status` (with optional `list:true`)
      - [x] CLI flags: `--batch-submit <file>`, `--batch-status <jobId>`, `--batch-list`
      - [x] `requireXxxKey` helpers refactored to throw `StructuredError("CONFIG_ERROR", ...)` with the right env-var fix
      - [x] Smoke tested: empty list, unimplemented combo (openrouter), missing key (openai) all give clean structured errors
      - [ ] Live Gemini Image batch test (deferred — costs real money + requires verifying SDK `batches.*` shape)
      - [ ] Live OpenAI Image batch test (deferred — costs real money)
      - [ ] Gemini TTS batch (deferred — Gemini TTS sync impl not yet built)
    ```md
    Framework + 2 of 3 declared batch providers wired. Gemini TTS batch
    blocked on Gemini TTS sync impl (separate future card). SDK shape for
    Gemini batches is cast through unknown — will need verification on
    first live run.
    ```

### Health check & structured errors

  - due: 2026-04-27
  - tags: [reliability, ux]
  - priority: high
  - workload: Medium
  - steps:
      - [x] `util/errors.ts` — `StructuredError` class + `mapProviderError` heuristic mapper
      - [x] Error codes: `AUTH_FAILED`, `RATE_LIMIT`, `CONTENT_POLICY`, `VALIDATION_ERROR`, `PROVIDER_ERROR`, `PROVIDER_TIMEOUT`, `BUDGET_EXCEEDED`, `CONFIG_ERROR`, `GENERATION_ERROR`, `NOT_FOUND`, `UNKNOWN`
      - [x] Each error carries `code`, `message`, `suggestedFix`, optional `cause` (raw provider blob)
      - [x] `tools/health-check.ts` pings Google `/models`, OpenAI `/models`, OpenRouter `/auth/key`, ElevenLabs `/user` with 8s timeout
      - [x] Pricing staleness reported (last_updated, daysAgo, isStale, threshold)
      - [x] Provider calls in gen tools wrapped with `mapProviderError`
      - [x] Budget block raises `StructuredError("BUDGET_EXCEEDED", ...)`
      - [x] `server.ts` and `cli.ts` error paths surface code + suggestedFix
      - [x] CLI: `--health-check` (exit 1 if not all configured providers ok)
      - [x] Smoke tested: empty config + fake keys (real 401s) + budget-block all give clean structured output
    ```md
    Heuristic mapper extracts HTTP status from message strings (regex /\b[45]\d\d\b/)
    plus keyword matches for content policy / rate limit / auth / not found.
    Health check uses Promise.all so 4 pings run in parallel; per-call 8s
    timeout via AbortController.
    ```

### Cost preview & budget enforcement

  - due: 2026-04-27
  - tags: [cost, budget, ux]
  - priority: high
  - workload: Medium
  - steps:
      - [x] `state/types.ts` — `Budget`, `BudgetWarning`, `BudgetBlock`, `BudgetPeriod`
      - [x] `state/budget.ts` — read/write `~/.claude-image-tts-gen/budget.json` (lock-protected); `checkBudget(addCost)` returns block + warning
      - [x] Default `$5/day` seeded on first read (matches CLAUDE.md decision)
      - [x] `tools/estimate-cost.ts` — dry-run across implemented slots, sorted by cost, identifies cheapest standard + cheapest batch
      - [x] `tools/set-budget.ts` — daily/weekly/monthly + softThreshold (0..1)
      - [x] Pre-call hard block in `generate_image` and `generate_speech` (skipped when cached)
      - [x] Soft warn at 80% returned in `result.budgetWarning` (non-blocking)
      - [x] CLI: `--estimate-cost`, `--set-budget-daily/weekly/monthly` (`null` to clear)
      - [x] Smoke tested: estimate sorts correctly; tiny cap blocks pre-call with clear message; clearing cap allows again
    ```md
    Budget enforcement is pre-call inside the tool — hooks would run too
    late. Cached calls bypass the check (cost=0). Daily cap default is
    $5; user can set/clear caps independently per period.
    ```

### Hash-based cache

  - due: 2026-04-26
  - tags: [cache, cost]
  - priority: high
  - workload: Easy
  - steps:
      - [x] `cache/key.ts` — `sha256(provider+model+modality+text+voice+sortedParams)` truncated to 16 hex chars
      - [x] `cache/store.ts` — `lookupCache`, `storeInCache`, `copyFromCache` against `~/.claude-image-tts-gen/cache/<hash>/`
      - [x] Cache miss: API call → save → also copy to cache for future hits
      - [x] Cache hit: copy cached file → cost.total=0 → entry.cached=true → sidecar.cached=true → result.cached=true
      - [x] CostEstimate keeps pricePerUnit so user sees what they saved
      - [x] Tool text shows `[cached, would have been $X]` annotation on hit
      - [x] Smoke tested end-to-end with pre-populated cache entry: API call skipped, file copied, sidecar written, ledger entry has cost=0
    ```md
    Identical (provider, model, modality, text, voice, params) tuple gets the
    same SHA256 hash → cache hit → $0. Trivial whitespace change misses cache,
    by design. No eviction in v1 — `rm -rf ~/.claude-image-tts-gen/cache/`
    to clear.
    ```

### Sidecar metadata & regenerate tool

  - due: 2026-04-26
  - tags: [reproducibility, sidecar]
  - priority: high
  - workload: Medium
  - steps:
      - [x] `sidecar/types.ts` — SidecarMetadata + SidecarLineage with version field
      - [x] `sidecar/metadata.ts` — `sidecarPathFor`, `writeSidecar`, `readSidecar`, `readLineageFromParent`
      - [x] Every `generate_image` and `generate_speech` call writes `<output>.regenerate.json`
      - [x] Optional `opts.parentSidecar` threads lineage when regenerating
      - [x] `regenerate` MCP tool + `-R/--regenerate <path>` CLI flag
      - [x] Accepts either output path or sidecar path (auto-derives)
      - [x] Smoke tested: missing sidecar → clean ENOENT; valid sidecar → correct dispatch to provider, hits missing-key error path
    ```md
    Sidecar lives next to the output (image.png → image.png.regenerate.json).
    Stores everything needed to reproduce: prompt/text/voice, provider, model,
    tier, params, cost, lineage. Regenerate reads it, calls the underlying
    tool with parentSidecar set so the new sidecar tracks lineage.parent +
    iteration counter — sets up the iteration loop card later.
    ```

### Cost tracking & session tally

  - due: 2026-04-26
  - tags: [cost, hooks, state]
  - priority: high
  - workload: Medium
  - steps:
      - [x] `state/types.ts` — `CallEntry`, `Session`, `PeriodTotal`, `SpendSummary`
      - [x] `state/store.ts` — `proper-lockfile` parallel-safe writes to `~/.claude-image-tts-gen/session.json`
      - [x] `state/spend.ts` — today / week / month / all-time + per-provider + per-tier rollups + recent 10 calls
      - [x] `generate_image` and `generate_speech` resolve price, append entry, return `{cost, sessionTotal}`
      - [x] `session_spend` MCP tool + `--session-spend` CLI flag
      - [x] Tool text output now shows per-call cost + today's running total
      - [x] PostToolUse hook left no-op (tool writes session.json directly — see CLAUDE.md decision #5)
      - [x] Smoke tested: 5 parallel `appendCall`s all persisted; totals + breakdowns + recent list correct
    ```md
    Tool writes session.json itself (with file lock) so the same call's
    response can include the *new* sessionTotal. Hook stays no-op for v1
    — repurposed for audit logging in v2 if needed. STATE_DIR env var
    overrides the default `~/.claude-image-tts-gen/` for testing.
    ```

### Pricing table & refresh script

  - due: 2026-04-25
  - tags: [pricing, cost]
  - priority: high
  - workload: Medium
  - steps:
      - [x] `pricing/types.ts` — interfaces (`PriceTable`, `PriceQuery`, `ResolvedPrice`, `CostEstimate`, `Staleness`)
      - [x] `pricing/pricing.json` — 13 model entries spanning all wired providers, with `last_updated`, `currency`, `sources[]`
      - [x] `pricing/load.ts` — `resolvePrice`, `estimateCost`, `makePriceKey`, `getStaleness`, `unitsForModality`
      - [x] Composite key handles params variants (e.g. `openai/gpt-image-1:high`)
      - [x] Unit types: `image`, `million_chars`, `million_tokens`
      - [x] Batch price returned when `useBatch: true` AND batch rate exists
      - [x] `pricing/refresh.ts` script + `npm run pricing:refresh` — prints sources, last_updated, staleness
      - [x] 30-day staleness threshold (used by health check next)
      - [x] Smoke tested: all 5 query/estimate paths return correct numbers (e.g. 4 Gemini batch images = $0.078; 5000-char ElevenLabs Multilingual = $0.90)
    ```md
    Pricing bundled into the server (rebuild required to apply changes —
    documented tradeoff for v1 simplicity). Refresh script prints source URLs
    and walks the user through manual update flow. Health check in next card
    will surface staleness in tool output.
    ```

### Add ElevenLabs provider (TTS only)

  - due: 2026-04-24
  - tags: [providers, tts, elevenlabs]
  - priority: medium
  - workload: Easy
  - steps:
      - [x] `eleven_turbo_v2_5` (small), `eleven_multilingual_v2` (mid)
      - [x] Friendly voice map: aria, roger, sarah, rachel, adam, brian → voice IDs
      - [x] Default voice: `aria`
      - [x] Custom raw voice IDs accepted via `customVoicesAllowed: true` slot flag
      - [x] Image marked NA in registry
      - [x] `ELEVENLABS_API_KEY` config + `requireElevenLabsKey`
      - [x] OpenAI strict voice validation preserved (`customVoicesAllowed: false`)
      - [x] Smoke tested: friendly + custom voice IDs both accepted; missing-key error clean
      - [ ] Live test against ElevenLabs API (blocked on user's `ELEVENLABS_API_KEY`)
    ```md
    Added `customVoicesAllowed` to Slot — when true, voice strings outside the
    declared list are passed through as raw IDs (cloned voices, etc).
    ElevenLabs sets it; OpenAI keeps strict validation. Direct fetch (no SDK).
    ```

### Add OpenRouter provider (image only)

  - due: 2026-04-24
  - tags: [providers, image, openrouter]
  - priority: medium
  - workload: Easy
  - steps:
      - [x] Image generation via direct fetch to `/api/v1/chat/completions` with `modalities:['image','text']`
      - [x] Parse image from `message.images[].image_url.url` data URL
      - [x] Tier mapping: small=`google/gemini-2.5-flash-image`, pro=`google/gemini-3-pro-image-preview`, mid=NA
      - [x] TTS marked NA in registry
      - [x] `OPENROUTER_API_KEY` config + `requireOpenRouterKey` helper
      - [x] HTTP-Referer and X-Title headers set per OpenRouter convention
      - [x] Smoke tested: list shows openrouter as implemented; missing-key error clean
      - [ ] Live test against OpenRouter API (blocked on user's `OPENROUTER_API_KEY`)
    ```md
    Used native fetch (not the OpenAI SDK) since OpenRouter's image extension
    (`modalities` field, `message.images` array) isn't in the OpenAI types.
    Mid tier left NA — Google's image lineup doesn't have a clean mid that
    adds value over small/pro. User can override with --model.
    ```

### Add OpenAI provider (image + TTS)

  - due: 2026-04-23
  - tags: [providers, image, tts, openai]
  - priority: high
  - workload: Medium
  - steps:
      - [x] `gpt-image-1` at low/medium/high quality (small/mid/pro) via `params.quality`
      - [x] `tts-1` (small), `gpt-4o-mini-tts` (mid), `tts-1-hd` (pro)
      - [x] Voice lists per model in registry (6 std voices for tts-1/-hd; 11 for gpt-4o-mini-tts)
      - [x] Default voice = `alloy`
      - [x] `OpenAIProvider` implements both `ImageProvider` and `TtsProvider`
      - [x] `generate_speech` tool + `--speech`/`--voice` CLI flags
      - [x] Split `OUTPUT_DIR` into `IMAGE_OUTPUT_DIR` / `AUDIO_OUTPUT_DIR` (shared `OUTPUT_DIR` still works as fallback)
      - [x] Voice validation against registry voice list with helpful error
      - [x] Smoke tests: bad voice → clear allowed-list; missing key → clear "set OPENAI_API_KEY"
      - [ ] Live test against OpenAI API (blocked on user's `OPENAI_API_KEY`)
    ```md
    OpenAI is the first provider implementing both modalities. Quality tiers
    map to the same gpt-image-1 model with different `quality` params (low/
    medium/high). TTS voices are declared per-slot in the registry — list_providers
    surfaces them so the user/skill can pick.
    ```

### Provider registry & capability matrix

  - due: 2026-04-22
  - tags: [providers, mcp, architecture]
  - priority: high
  - workload: Medium
  - steps:
      - [x] Expanded `providers/types.ts` with `Modality`, `Tier`, `ImageProvider`, `TtsProvider`
      - [x] Implemented `providers/registry.ts` — full matrix as single source of truth
      - [x] Tier abstraction (`small | mid | pro`) maps to `(provider, model, params)` slots
      - [x] `resolveSlot`, `listAvailable`, `listDeclared`, `createImageProvider` factory
      - [x] Refactored `tools/generate-image.ts` to take `{provider?, tier?, model?}` and resolve via registry
      - [x] Removed `defaultModel` from `GoogleProvider` constructor — model is per-call
      - [x] Added `list_providers` MCP tool + CLI `--list-providers` flag
      - [x] Smoke tested: list works, unimplemented tier error is clear, unimplemented provider error suggests fallback
    ```md
    Registry encodes all 4 providers × 2 modalities × 3 tiers = 24 slots,
    with `model`, `batchable`, `implemented`, optional `params` per slot.
    Only google/image/small is implemented today; everything else returns
    a clear "declared but not yet implemented" error pointing the user
    back to the working default.
    ```

### Wire Google Gemini Flash Image as first provider

  - due: 2026-04-21
  - tags: [providers, image, google]
  - priority: high
  - workload: Easy
  - steps:
      - [x] Implement `providers/google.ts` with `generateImage` for Gemini Flash Image
      - [x] Implement `tools/generate-image.ts` calling the provider
      - [x] Read `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`, `OUTPUT_DIR` from env
      - [x] Save output to disk; return `{ files, providerUsed, modelUsed, mimeType }`
      - [x] MCP server lists `create_asset` + `generate_image` tools
      - [x] CLI wired (`-p`, `-o`, `-m`, `-d`)
      - [x] Build green; structured error returned when key missing
      - [x] Live end-to-end test against Gemini API succeeded (teal cube PNG, 879KB)
    ```md
    Default model: `gemini-2.5-flash-image` (GA, no preview suffix).
    Initial preview-suffixed model name was stale; corrected to GA name after
    ListModels query. Override via GEMINI_IMAGE_MODEL.
    Output dir default: ./generated-images (override via OUTPUT_DIR).
    ```

### Bootstrap plugin & MCP server scaffold

  - due: 2026-04-20
  - tags: [setup, mcp, plugin]
  - priority: high
  - workload: Medium
  - steps:
      - [x] Create `.claude-plugin/plugin.json` and `marketplace.json`
      - [x] Create `mcp-server/` with `package.json`, `tsconfig.json`, esbuild config
      - [x] Implement `src/server.ts` — MCP server with `create_asset` placeholder tool
      - [x] Implement `src/cli.ts` — CLI entry returning placeholder JSON
      - [x] Add `hooks/post-tool-use.sh` no-op skeleton
      - [x] `npm run build` produces `dist/server.js` and `dist/cli.js`
      - [x] Verified: server responds to MCP `initialize` over stdio
    ```md
    Plugin scaffold installable. MCP server boots and responds to
    initialize. CLI returns placeholder JSON. Ready for v1 (provider
    wiring, tier abstraction, cost tracking).
    ```

### Project initialization

  - due: 2026-04-18
  - tags: [setup, docs]
  - priority: low
    ```md
    Repo created with initial commit, README placeholder, and empty
    `generated-images/` directory. Architecture and phased delivery plan
    locked in CLAUDE.md and progress.md.
    ```
