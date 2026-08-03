---
description: Generate talking-avatar (lip-sync) videos — a person/face image + speech audio → a video where the mouth and head move in sync with the voice. Ideal for outreach videos, personalized messages, spokesperson clips, explainer intros, and UGC-style talking heads. Triggers when the user asks to "make a talking avatar", "lip-sync this", "have this person say X", "turn this photo into a talking video", "personalized video message", "spokesperson video", or "talking head".
allowed-tools:
  - mcp__claude-image-tts-gen__generate_avatar
  - mcp__claude-image-tts-gen__generate_image
  - mcp__claude-image-tts-gen__generate_speech
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__regenerate
  - mcp__claude-image-tts-gen__session_spend
---

# Talking-avatar (lip-sync) generation

Use this skill when the user wants a **talking video** of a person/character —
outreach videos, personalized messages, a spokesperson, an explainer intro.
It runs **VEED Fabric 1.0** on Replicate via the `generate_avatar` tool.

## It needs two inputs: an image AND audio

Fabric takes an **image** (photo, illustration, 3D render, mascot — front-facing
faces lip-sync best) + **speech audio** (mp3/wav/m4a/aac) and returns a video
lip-synced to the audio. There is no motion prompt — the audio drives everything.

If the user only has an idea, build the pieces first — this is the money pipeline:

1. **`generate_image`** — the avatar. A clear front-facing headshot works best;
   illustrations/mascots also work.
2. **`generate_speech`** — the voice line. Use any TTS provider. For *the user's
   own voice* (personalized outreach at scale), clone it via Voicebox/local
   (`--referenceAudioPath`) or an ElevenLabs voice ID.
3. **`generate_avatar --image <img> --audio <audio>`** — the talking clip.

## Cost — say it out loud, every time

Billed **per second of output**, and the output length **equals the audio length**:

- **small** — 480p, **$0.08/sec**
- **mid** — 720p, **$0.15/sec**

So a **30-second** clip is **~$2.40 (480p) / ~$4.50 (720p)**; a 2-minute one is
~$9.60 / ~$18. This is the most expensive thing in the plugin per run — always
surface the estimated cost (audio duration × rate) before generating, and default
to `small` (480p) unless the user asks for 720p. The pre-call budget guard will
block runs over the cap; if it does, offer 480p, a shorter script, or `set_budget`.

## Requirements

- `REPLICATE_API_TOKEN` — if missing you'll get a `CONFIG_ERROR`; tell the user to set it.
- `ffmpeg` — needed to read the audio duration for pricing/budget. If absent, the
  tool errors with install guidance; relay it rather than retrying.
- Generation is async and can take a couple of minutes — that's expected, not a hang.

## Good practices

- Front-facing, evenly-lit, single-subject images lip-sync cleanest.
- Keep scripts tight for outreach — 15–30s converts better and costs less.
- For a batch of personalized messages, reuse one avatar image and generate a
  per-recipient voice line, then one `generate_avatar` per recipient. Watch the
  running spend (`session_spend`) — costs add up fast at per-second billing.

## Reproducibility

Each output writes a `.regenerate.json` sidecar recording the image + audio paths
and resolution, so `regenerate` reproduces the exact clip.
