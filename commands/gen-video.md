---
description: Generate a video from an input image (image-to-video via grok-imagine-video-1.5)
argument-hint: [motion prompt] --image <frame.png> [--duration 1-15] [--tier small|mid]
allowed-tools:
  - mcp__claude-image-tts-gen__generate_video
  - mcp__claude-image-tts-gen__generate_image
  - mcp__claude-image-tts-gen__list_providers
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__iterate
  - mcp__claude-image-tts-gen__regenerate
---

Generate a video based on the user's request: $ARGUMENTS

Use the `generate_video` MCP tool (provider `replicate`, model grok-imagine-video-1.5).

**This is image-to-video only** — every generation needs an input frame (`imagePath`).
If the user hasn't supplied a still image, generate one first with `generate_image`,
then feed its path into `generate_video`. The `prompt` should describe the **motion**
(how the subject and camera move, pacing, ambient sound) — the frame already sets the scene.

Pick the tier from intent — it maps to resolution:

- **small** — 480p, ~$0.08/sec (default, cheapest)
- **mid** — 720p, ~$0.14/sec (crisper, for hero/marketing clips)

`duration` is 1–15 seconds (default 5). Cost = duration × per-second rate, so a 5s
480p clip is ~$0.40. Audio (sfx, ambience, speech) is synthesized in the same pass at
no extra charge. Requires `REPLICATE_API_TOKEN`.

Before a long or high-res run, offer an `estimate_cost --modality video --seconds <n>`
dry-run. After generating, surface the file path, duration, and the per-call + today's spend.
