---
description: Generate a talking-avatar (lip-sync) video from an image + speech audio (VEED Fabric 1.0)
argument-hint: --image face.png --audio voice.mp3 [--tier small|mid]
allowed-tools:
  - mcp__claude-image-tts-gen__generate_avatar
  - mcp__claude-image-tts-gen__generate_image
  - mcp__claude-image-tts-gen__generate_speech
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__regenerate
---

Generate a talking-avatar (lip-sync) video: $ARGUMENTS

Use the `generate_avatar` MCP tool (provider `replicate`, model `veed/fabric-1.0`).
It takes an **image** (a face/person/illustration) + **speech audio** and produces a
video where the mouth, head, and subtle body motion are lip-synced to the audio.

**Both inputs are required.** The natural pipeline for outreach / personalized messages:

1. `generate_image` → the avatar (a headshot, illustration, mascot, …).
2. `generate_speech` → the voice line (any provider; clone a voice via Voicebox/local if you want *their* voice).
3. `generate_avatar --image <img> --audio <audio>` → the talking video.

Key facts to surface to the user:

- **The output length equals the audio length**, and it's **billed per second**: small = 480p ($0.08/s), mid = 720p ($0.15/s). So a 30s clip is ~$2.40 (480p) / ~$4.50 (720p). Offer an `estimate_cost` sense-check or the audio duration before a long/expensive run.
- Needs `REPLICATE_API_TOKEN` **and** `ffmpeg` (to read the audio duration for pricing). If either is missing, the tool returns a clear structured error — relay it rather than retrying.
- Generation is asynchronous and can take a couple of minutes; that's normal.

After generating, give the file path, duration, and per-call + today's spend.
