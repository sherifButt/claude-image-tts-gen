---
description: Generate speech audio (TTS) with sensible voice + tier
argument-hint: [text] [--voice <id>] [--tier small|mid|pro] [--captions srt|vtt|both]
allowed-tools:
  - mcp__claude-image-tts-gen__generate_speech
  - mcp__claude-image-tts-gen__list_providers
---

Generate speech for the user's text: $ARGUMENTS

Use `generate_speech`. Tier guidance:

- **small** — short notifications, UI strings, throwaway clips (~$0.075/5K chars on tts-1)
- **mid** — narration, podcasts, walkthroughs (gpt-4o-mini-tts is the cheapest mid)
- **pro** — character voices, branded marketing audio (tts-1-hd or ElevenLabs Multilingual v2)

If the user wants captions for video work, set `captions: 'srt'` or `'vtt'` —
ElevenLabs is the only provider that returns word-level timestamps in v1.

If the text is over ~4000 chars, the tool auto-chunks at sentence boundaries
and concats with ffmpeg. Single-chunk output is faster.
