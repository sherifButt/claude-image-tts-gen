---
description: Generate a talking-avatar (lip-sync) video from an image + speech audio
argument-hint: --image face.png --audio voice.mp3 [--tier draft|low|normal|high|ultra]
allowed-tools:
  - mcp__claude-image-tts-gen__generate_avatar
  - mcp__claude-image-tts-gen__generate_image
  - mcp__claude-image-tts-gen__generate_speech
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__regenerate
---

Generate a talking-avatar (lip-sync) video: $ARGUMENTS

Use the `generate_avatar` MCP tool (provider `replicate`; model depends on tier —
`prunaai/p-video` on draft/low/normal, `veed/fabric-1.0` on high/ultra).
It takes an **image** (a face/person/illustration) + **speech audio** and produces a
video where the mouth, head, and subtle body motion are lip-synced to the audio.

**Both inputs are required.** The natural pipeline for outreach / personalized messages:

1. `generate_image` → the avatar (a headshot, illustration, mascot, …).
2. `generate_speech` → the voice line (any provider; clone a voice via Voicebox/local if you want *their* voice).
3. `generate_avatar --image <img> --audio <audio>` → the talking video.

Key facts to surface to the user:

- **The output length equals the audio length**, and it's **billed per second**:
  `draft` 720p preview $0.005/s · `low` 720p $0.02/s · `normal` 1080p $0.04/s (default) · `high` 480p $0.08/s · `ultra` 720p $0.15/s.
  A 30s clip runs $0.15 → $4.50 depending on tier. Iterate on `draft`, deliver on `normal` or above.
- **draft/low/normal cap the audio at 20s.** Past that the model silently returns only the first 20 seconds, so the tool refuses up front. Offer the user `high`/`ultra` (no cap, priced in the error) or splitting the script into sub-20s segments — see the avatar-generation skill for how to cut between shots.
- **Pass one clearly-framed subject.** On the p-video tiers a multi-subject or ambiguous image makes the model ignore it and generate an unrelated person, while still reporting success.
- Needs `REPLICATE_API_TOKEN` **and** `ffmpeg` (to read the audio duration for pricing). If either is missing, the tool returns a clear structured error — relay it rather than retrying.
- Generation is asynchronous and can take a couple of minutes; that's normal.

After generating, give the file path, duration, and per-call + today's spend.
