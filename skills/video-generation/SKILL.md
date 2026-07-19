---
description: Generate short videos from a still image (image-to-video) for product demos, hero loops, social clips, and animated mockups. Triggers when the user asks to "animate this image", "make a video of X", "turn this frame into a clip", "generate a video", "create a short motion loop", or wants an image brought to life with movement and sound.
allowed-tools:
  - mcp__claude-image-tts-gen__generate_video
  - mcp__claude-image-tts-gen__generate_image
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__list_providers
  - mcp__claude-image-tts-gen__iterate
  - mcp__claude-image-tts-gen__regenerate
  - mcp__claude-image-tts-gen__session_spend
---

# Video generation

Use this skill when the user wants a short video clip. It runs xAI's
**grok-imagine-video-1.5** on Replicate via the `generate_video` tool.
Examples: "animate this hero image", "make a 6-second product loop from
this render", "turn this frame into a clip with the camera panning left".

## This is image-to-video only

Every generation **requires an input frame** (`imagePath`). There is no
text-to-video path here. If the user only has a text idea:

1. Generate a still first with `generate_image` (pick tier/aspect from intent).
2. Feed that file's path into `generate_video` as `imagePath`.

Tell the user you're doing this two-step so the cost is clear (they pay for
the image *and* the video).

## Write the prompt as motion, not scene

The still frame already establishes subject, setting, and style. The `prompt`
should describe **what changes over time**: camera movement (pan, dolly, orbit,
push-in), subject action, pacing, and any ambient sound. "Slow push-in as steam
rises from the cup, warm cafe murmur" beats re-describing the photo.

Audio (sfx, ambience, and speech) is synthesized in the same pass at no extra cost.

## Pick the tier (= resolution)

| Intent                                        | Tier      | Resolution | Rate       |
|-----------------------------------------------|-----------|------------|------------|
| Draft, social clip, quick preview             | `small`   | 480p       | ~$0.08/sec |
| Hero loop, marketing, crisp detail            | `mid`     | 720p       | ~$0.14/sec |

Default to `small`. There is no `pro` tier — 720p is the ceiling for this model.

## Duration drives cost

`duration` is **1–15 seconds** (default 5). Cost = duration × per-second rate:

- 5s @ 480p ≈ **$0.40**
- 5s @ 720p ≈ **$0.70**
- 10s @ 720p ≈ **$1.40**

Before a long or high-res run, do an `estimate_cost` dry-run with
`modality:"video"` and `seconds:<n>` and surface the number. A single default
clip can exceed the whole daily image budget many times over — be explicit.

## Aspect ratio

Pass `aspectRatio` when the target shape is known: `9:16` for stories/TikTok,
`16:9` for landscape/hero, `1:1` for square social. Supported: 1:1, 16:9, 9:16,
4:3, 3:4, 3:2, 2:3. **21:9 is not supported** for video. Omit for the model's auto.

## Provider + config

Only provider is `replicate`; it needs `REPLICATE_API_TOKEN`. If you get a
`CONFIG_ERROR`, tell the user to set that token rather than retrying. Call
`list_providers` with `modality:"video"` if you want to confirm what's usable.

Generation is asynchronous under the hood (create prediction → poll) and can
take tens of seconds to a few minutes; that's normal, not a hang.

## Cost discipline

- Always state the cost — video is the most expensive modality in this plugin.
- Cache hits (`cached: true`) cost $0 — identical prompt + image + params.
- On `BUDGET_EXCEEDED`, offer to shorten `duration`, drop to `small` (480p),
  or raise the cap with `set_budget`.

## Reproducibility

Each output writes a `.regenerate.json` sidecar recording the input image,
prompt, duration, and resolution. Use `iterate` to nudge the motion
("add a slow zoom") or `regenerate` to reproduce the exact clip.
