---
description: Generate a video from a prompt (text-to-video) or an input image (image-to-video)
argument-hint: [motion prompt] [--image frame.png] [--duration 1-20] [--tier draft|low|normal|high|ultra]
allowed-tools:
  - mcp__claude-image-tts-gen__generate_video
  - mcp__claude-image-tts-gen__generate_image
  - mcp__claude-image-tts-gen__list_providers
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__iterate
  - mcp__claude-image-tts-gen__regenerate
---

Generate a video based on the user's request: $ARGUMENTS

Use the `generate_video` MCP tool (provider `replicate`; model depends on tier —
`prunaai/p-video` on draft/low/normal, `xai/grok-imagine-video-1.5` on high/ultra).

**Text-to-video or image-to-video.** On draft/low/normal the input frame is optional —
omit `imagePath` and the clip comes from the prompt alone. On high/ultra a frame is
required. Tiers, all billed per second: `draft` $0.005 · `low` $0.02 · `normal` $0.04
(default) · `high` $0.08 · `ultra` $0.14. Max duration 20s on p-video, 15s on grok. The `prompt` should describe the **motion**
(how the subject and camera move, pacing, ambient sound) — the frame already sets the scene.

Pick the tier from intent — it maps to resolution:

- **small** — 480p, ~$0.08/sec (default, cheapest)
- **mid** — 720p, ~$0.14/sec (crisper, for hero/marketing clips)

`duration` is 1–15 seconds (default 5). Cost = duration × per-second rate, so a 5s
480p clip is ~$0.40. Audio (sfx, ambience, speech) is synthesized in the same pass at
no extra charge. Requires `REPLICATE_API_TOKEN`.

Before a long or high-res run, offer an `estimate_cost --modality video --seconds <n>`
dry-run. After generating, surface the file path, duration, and the per-call + today's spend.
