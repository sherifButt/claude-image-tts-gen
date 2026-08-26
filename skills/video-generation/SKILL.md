---
description: Generate short videos from a text prompt (text-to-video) or a still image (image-to-video) for product demos, hero loops, social clips, and animated mockups. Triggers when the user asks to "animate this image", "make a video of X", "turn this frame into a clip", "generate a video", "create a short motion loop", or wants an image brought to life with movement and sound.
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

Use this skill when the user wants a short video clip. It runs on Replicate
via the `generate_video` tool, across two models: **Pruna p-video** on the
cheap tiers and **xAI grok-imagine-video-1.5** on the expensive ones.
Examples: "animate this hero image", "make a 6-second product loop from
this render", "a clip of rain on a window at night".

## Text-to-video or image-to-video

On `draft`/`low`/`normal` (p-video) an input frame is **optional** — omit
`imagePath` and the clip is generated from the prompt alone. On `high`/`ultra`
(grok) a frame is **required**; the tool refuses without one and says so.

Supply a frame when the opening image matters — a product shot, a brand asset,
a face. Skip it when the clip is atmosphere or B-roll and you only care about
the motion. Generating a still first with `generate_image` and feeding it in
costs more (you pay for both), so say that out loud before doing it.

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

Billed **per second of output**, five tiers spanning 28x:

| tier | model | output | $/sec | 5s clip | max | frame |
| --- | --- | --- | --- | --- | --- | --- |
| `draft` | p-video | 720p preview | **$0.005** | $0.03 | 20s | optional |
| `low` | p-video | 720p | **$0.02** | $0.10 | 20s | optional |
| `normal` *(default)* | p-video | 1080p | **$0.04** | $0.20 | 20s | optional |
| `high` | grok | 480p | **$0.08** | $0.40 | 15s | required |
| `ultra` | grok | 720p | **$0.14** | $0.70 | 15s | required |

**Iterate on `draft`.** Motion prompts are hard to predict — at $0.005/sec you
can try a dozen phrasings for the price of one `ultra` take, then move up once
the movement is right.

**Reach for grok (`high`/`ultra`) for motion quality, not resolution.** p-video
at `normal` renders more pixels than grok at `ultra`; what grok buys you is
richer, more coherent movement. If the user wants a bigger frame, `normal` is
both cheaper and larger. Say which one you're optimising for.

- Always state the cost before generating.
- Cache hits (`cached: true`) cost $0 — identical prompt + image + params.
- On `BUDGET_EXCEEDED`, offer to shorten `duration`, drop to `draft`, or raise
  the cap with `set_budget`.
- `aspectRatio` only applies to text-to-video. With a frame supplied, the frame
  decides the shape and the ratio is ignored.

## Reproducibility

Each output writes a `.regenerate.json` sidecar recording the prompt, duration,
tier params, and the input image when there was one. A text-to-video run records
no `imagePath`, so `regenerate` reproduces it as text-to-video. Use `iterate` to
nudge the motion ("add a slow zoom") or `regenerate` to reproduce the exact clip.
Sidecars written before v0.12.0 record `tier: small|mid`; those still resolve to
grok 480p/720p, so old work regenerates at its original model and price.
