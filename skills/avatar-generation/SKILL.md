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
It runs on Replicate via the `generate_avatar` tool, across two models: **Pruna
p-video** on the cheap tiers and **VEED Fabric 1.0** on the expensive ones.

## It needs two inputs: an image AND audio

The tool takes an **image** (photo, illustration, 3D render, mascot — front-facing
faces lip-sync best) + **speech audio** (mp3/wav/m4a/aac) and returns a video
lip-synced to the audio. The p-video tiers also accept an optional `prompt` for
body motion; Fabric takes none — there the audio drives everything.

If the user only has an idea, build the pieces first — this is the money pipeline:

1. **`generate_image`** — the avatar. A clear front-facing headshot works best;
   illustrations/mascots also work.
2. **`generate_speech`** — the voice line. Use any TTS provider. For *the user's
   own voice* (personalized outreach at scale), clone it via Voicebox/local
   (`--referenceAudioPath`) or an ElevenLabs voice ID.
3. **`generate_avatar --image <img> --audio <audio>`** — the talking clip.

## Cost — say it out loud, every time

Billed **per second of output**, and the output length **equals the audio length**.
Five tiers spanning 30x in price:

| tier | model | output | $/sec | 30s clip | max audio |
| --- | --- | --- | --- | --- | --- |
| `draft` | p-video | 720p preview | **$0.005** | $0.15 | 20s |
| `low` | p-video | 720p | **$0.02** | $0.60 | 20s |
| `normal` *(default)* | p-video | 1080p | **$0.04** | $1.20 | 20s |
| `high` | Fabric | 480p | **$0.08** | $2.40 | none |
| `ultra` | Fabric | 720p | **$0.15** | $4.50 | none |

**Iterate on `draft`.** At $0.005/sec you can try twenty framings for the price of
one `ultra` take. Move up only once the image, script and timing are settled.

Always surface the estimated cost (audio duration × rate) before generating. The
pre-call budget guard blocks runs over the cap; if it fires, offer a cheaper tier,
a shorter script, or `set_budget`.

## The 20-second wall on draft/low/normal

p-video **silently truncates** audio past 20 seconds — it returns a successful
prediction containing only the first 20s, with no error and nothing in the
response to detect it from. `generate_avatar` therefore refuses over-length audio
on those tiers before spending anything.

When you hit it, you have two options, and it is the **user's** call which:

1. **Go to `high`/`ultra`** — Fabric has no cap and does the whole thing in one
   take. Quote the price.
2. **Deliver it as several shots** — split the script, generate one clip per
   segment, and assemble. Per-second billing makes this cost-neutral: 5×18s at
   `normal` is the same $3.60 as one 90s clip would be.

If the user chooses to split, these are the craft rules — a 90-second unbroken
talking head reads as uncanny anyway, so cutting is usually the better film:

- **Split the text, never the rendered audio.** Chunk the script at sentence
  boundaries first, `generate_speech` each chunk, then one `generate_avatar` per
  chunk. Cutting an existing mp3 lands mid-word.
- **Target ~17s per segment, not 20.** TTS pacing varies by voice, and going over
  truncates. Keep a floor around 6–8s and merge short tails backward, or the piece
  ends on a three-second orphan shot.
- **Vary the shot across cuts.** Adjacent shots need to differ by roughly 20% in
  subject size or the cut reads as a jump cut. Cycle medium → medium-close →
  close → medium-close. Never cut wide straight to extreme close-up.
- **Hard cuts, no crossfades.** Dissolves on a talking head read as amateur.

The tool renders exactly the image and audio you hand it — one clip per call. The
splitting, shot selection and assembly are yours to do.

## Requirements

- `REPLICATE_API_TOKEN` — if missing you'll get a `CONFIG_ERROR`; tell the user to set it.
- `ffmpeg` — needed to read the audio duration for pricing/budget. If absent, the
  tool errors with install guidance; relay it rather than retrying.
- Generation is async and can take a couple of minutes — that's expected, not a hang.

## Good practices

- **One clearly-framed subject per image.** On the p-video tiers a contact sheet,
  crowd, or ambiguous frame makes the model *ignore the image entirely* and invent
  an unrelated person — and it still reports success. Fabric refuses instead.
  Verified the hard way: a 6-panel portrait sheet produced a stranger.
- Front-facing, evenly-lit, single-subject images lip-sync cleanest.
- Keep scripts tight for outreach — 15–30s converts better and costs less.
- For a batch of personalized messages, reuse one avatar image and generate a
  per-recipient voice line, then one `generate_avatar` per recipient. Watch the
  running spend (`session_spend`) — costs add up fast at per-second billing.

## Reproducibility

Each output writes a `.regenerate.json` sidecar recording the image + audio paths,
tier params and motion prompt, so `regenerate` reproduces the exact clip. Sidecars
written before this ladder existed record `tier: small|mid`; those still resolve to
Fabric 480p/720p, so old work regenerates at its original model and price.
