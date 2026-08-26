---
description: Generate spoken audio (TTS) for narration, podcasts, voiceover, app sounds, or any text the user wants read aloud. Triggers when the user asks for "narration", "voice over", "read this aloud", "make audio of X", "TTS", or asks for an audio explainer.
allowed-tools:
  - mcp__claude-image-tts-gen__generate_speech
  - mcp__claude-image-tts-gen__create_assets
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__list_providers
  - mcp__claude-image-tts-gen__check_voicebox
  - mcp__claude-image-tts-gen__check_pocket
  - mcp__claude-image-tts-gen__regenerate
  - mcp__claude-image-tts-gen__session_spend
---

# Speech generation

Use this skill when the user wants text spoken aloud — narration,
podcast clips, voice-over, walkthrough audio, character voices, etc.

## Pick the tier from intent

| Intent                                       | Tier      | Why                         |
|---------------------------------------------|----------|-----------------------------|
| Short notification, UI string, throwaway     | `small`  | tts-1 is cheap and fast     |
| Narration, podcast, walkthrough              | `mid`    | gpt-4o-mini-tts cheap+good  |
| Character voice, branded marketing audio     | `pro`    | tts-1-hd or ElevenLabs Pro  |
| User says "high quality" or "cinematic"      | `pro`    | Honor the request           |

Default to `mid` for narration-length text, `small` for very short clips.

## Pick the provider

- **Default `openai`** for general narration — wide voice list,
  reliable, well-supported.
- **`elevenlabs`** when the user wants:
  - Specific named voices (Aria, Roger, Sarah, Rachel, Adam, Brian)
  - Custom cloned voices (pass the raw voice ID)
  - SRT/VTT captions (ElevenLabs is the only provider with word-level
    timestamps in v1)
- **`pocket-tts`** when the user wants **$0/call** generation or **voice
  cloning** and has `pocket-tts serve` running (default `:8000`). 26 built-in
  voices; clone by passing `--referenceAudioPath <clean .wav>`, or a `.wav`
  path as `--voice`. ~4x realtime on CPU, 24 kHz mono.

  **Run `check_pocket` before any long run or any cloning request.** Its
  `/health` reports `healthy` even when the gated cloning weights failed to
  load, after which it would speak in a stock voice — `check_pocket` actually
  clones a probe clip, so it tells you the truth in about half a second for $0.
  `generate_speech` runs the same probe as a preflight and **refuses** a cloning
  request it cannot honour, rather than handing back a stranger's voice. If it
  refuses, relay the fix (accept the terms at
  https://huggingface.co/kyutai/pocket-tts, `hf auth login`, restart) instead of
  retrying or silently switching provider.
- **`voicebox`** when the user has [Voicebox](https://voicebox.sh)
  running locally and wants $0/call generation, voice cloning, or
  inline emotion tags. Voicebox bundles 7 engines with very different
  capabilities — **always call `check_voicebox` first** to see which
  engines and profiles are available, then pass the right engine via
  `params.engine`:
  - `chatterbox_turbo` → English + paralinguistic tags
    (`[laugh]`, `[chuckle]`, `[gasp]`, `[cough]`, `[sigh]`, `[groan]`,
    `[sniff]`, `[shush]`, `[clear throat]`). Use this for expressive /
    podcast / character work in English.
  - `qwen` (Qwen3-TTS) → voice cloning + natural-language delivery
    hints via the `instruct` field (e.g. "speak slowly", "whisper"),
    10 languages.
  - `qwen_custom_voice` → 9 preset voices with the same instruct
    control, no cloning needed.
  - `chatterbox` (multilingual) → broadest language coverage (23),
    but reads tags literally — use plain prose.
  - `kokoro` → smallest/fastest (82M params), 50 preset voices, 8
    languages — good default for fast iteration.
  - `luxtts`, `tada` → niche; check capabilities before suggesting.
- `google` TTS is declared in the registry but not yet implemented for
  sync calls.

## Voices

- OpenAI tts-1 / tts-1-hd: alloy, echo, fable, onyx, nova, shimmer
- OpenAI gpt-4o-mini-tts: above + ash, ballad, coral, sage, verse
- ElevenLabs friendly names: aria (default), roger, sarah, rachel,
  adam, brian — or any raw voice ID

If the user names a voice, use it. Otherwise let the default fire.

## Long text

The tool auto-chunks at sentence boundaries when text exceeds the
provider's per-call limit (OpenAI 4096, ElevenLabs 5000, Voicebox 300).
Chunks are generated in parallel and concatenated with ffmpeg.

For neural local engines (Voicebox Qwen3-TTS / Chatterbox / Kokoro),
quality drifts on long inputs — the 300-char default keeps prosody
clean. Pass `maxCharsPerChunk` (CLI: `--max-chars-per-chunk`) to dial
in any provider you observe degrading. Cache key includes the override,
so different chunk sizes don't collide on the same text.

## Captions for video work

When the user mentions video, subtitles, or captions, set
`captions: 'srt'` (or `'vtt'` or `'both'`). This requires ElevenLabs.
For chunked output, captions are skipped in v1 (multi-chunk timestamp
offsets aren't supported yet).

## Voice presets

If the user has a recurring voice ("my podcast voice", "the brand
narrator"), suggest saving it via `save_voice_preset` so future calls
reference the name.

## Cost discipline

ElevenLabs is ~10× more expensive per character than OpenAI tts-1. Use
the right tool for the job — don't burn ElevenLabs Pro on UI sounds.

Mention cost in your reply (the tool returns it). If the user is
iterating heavily on the same text, the cache returns it at $0.
