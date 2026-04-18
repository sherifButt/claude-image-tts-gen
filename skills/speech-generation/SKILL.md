---
description: Generate spoken audio (TTS) for narration, podcasts, voiceover, app sounds, or any text the user wants read aloud. Triggers when the user asks for "narration", "voice over", "read this aloud", "make audio of X", "TTS", or asks for an audio explainer.
allowed-tools:
  - mcp__claude-image-tts-gen__generate_speech
  - mcp__claude-image-tts-gen__create_assets
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__list_providers
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
provider's per-call limit (OpenAI 4096, ElevenLabs 5000). Chunks are
generated in parallel and concatenated with ffmpeg. Single-chunk output
is faster, so prefer breaking very long content into smaller chunks
yourself if speed matters more than seamlessness.

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
