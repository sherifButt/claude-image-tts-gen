---
description: Generate AI images for the user's task — websites, presentations, marketing, icons, hero shots. Triggers when the user asks for an image, mockup, illustration, icon, banner, hero, OG card, social post, or any visual asset that doesn't exist yet.
allowed-tools:
  - mcp__claude-image-tts-gen__generate_image
  - mcp__claude-image-tts-gen__create_assets
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__list_providers
  - mcp__claude-image-tts-gen__post_process
  - mcp__claude-image-tts-gen__variants
  - mcp__claude-image-tts-gen__pick_variant
  - mcp__claude-image-tts-gen__iterate
  - mcp__claude-image-tts-gen__regenerate
  - mcp__claude-image-tts-gen__session_spend
  - mcp__claude-image-tts-gen__batch_submit
  - mcp__claude-image-tts-gen__batch_status
---

# Image generation

Use this skill when the user needs an image that doesn't already exist.
Examples: "make a hero image for the landing page", "generate an icon
for X", "I need an OG card", "draw a diagram of Y".

## Pick the tier from intent

| Intent                                       | Tier       | Why                       |
|---------------------------------------------|-----------|---------------------------|
| Icon, diagram, simple line art              | `small`   | Cheapest tier handles it  |
| UI mockup, illustration, social post         | `small`   | Still good enough usually |
| Photoreal hero, marketing visual             | `pro`     | Detail justifies the cost |
| User explicitly asks for "high quality"      | `pro`     | Honor the request         |
| User explicitly asks for "cheap" / "draft"   | `small`   | Honor the request         |

Default to `small` when in doubt. Surface the cost in your reply so the
user can ask for `pro` if they want more.

## Pick the aspect ratio

Always pass `aspectRatio` when the user's intent implies a shape — don't rely
on pixel dimensions in the prompt text (providers ignore them). Default `1:1`
when nothing is implied.

| Intent                                         | `aspectRatio` |
|-----------------------------------------------|---------------|
| Square post, avatar, icon, logo               | `1:1`         |
| Open Graph card, blog hero, Twitter card, LinkedIn | `16:9`    |
| Photo landscape, marketing banner             | `3:2`         |
| Photo portrait, magazine cover                | `2:3`         |
| Instagram story, TikTok, mobile hero, 9:16 video thumb | `9:16` |
| Ultra-wide cinematic                          | `21:9`        |
| Classic 4:3 (slides, older displays)          | `4:3`         |

The 1200×630 OG preset maps to `16:9` (closest bucket on gpt-image-2 / gpt-image-1) or `3:2`.
For exact OG dimensions, generate at `16:9` then pipe through `post_process --presets og`.

## Pick the provider

Before choosing anything other than the default, **call `list_providers` with
`modality:"image"` once per session**. The response marks each slot with
`implemented`, `keyConfigured`, and `usable`. Only pick rows where
`usable: true`. If none of the usable rows match the intent (e.g. user asked
for `pro` tier but only `small` is usable), tell the user which env var to
set instead of thrashing through fallbacks.

- **Default `google`** (Gemini Flash Image) — cheapest, supports batch,
  good quality at small tier. Only implemented tier: `small`.
- Switch to `openai` (gpt-image-2) when the user wants better text
  rendering inside the image or photoreal portraits. Tiers `small | mid | pro`
  all implemented — but requires `OPENAI_API_KEY`.
- `openrouter` is a passthrough — only use when the user explicitly
  asks for it (single-key billing across providers).

If you call `generate_image` and get a `VALIDATION_ERROR` with `meta.availableTiers`
or `meta.providersForTier`, use those lists instead of re-guessing. If you get a
`CONFIG_ERROR` saying a provider's key isn't set, tell the user — don't retry
the same provider or switch providers silently.

## When the user has multiple prompts

If the user asks for ≥2 images of the same modality and there's no
explicit deadline, prefer `create_assets` with `mode:'auto'` — the
server will elicit the user to pick batch (50% off, ≤24h) vs sync
(immediate, full price).

If they need everything now, pass `mode:'sync'` to skip the prompt.

## Variants for "I'm not sure what I want"

When the user is exploring a concept (logo ideas, hero composition options),
call `variants` with `n: 4` to get a contact sheet. Then ask which one to
keep and call `pick_variant`.

## After-the-fact share targets

If the user mentions OG / Twitter card / favicon / app icon / social,
follow up with `post_process --presets <list>` against the generated PNG.
The webp flag is worth it for web embeds (~75× smaller than PNG).

## Style presets

If the user has a recurring brand style ("our blog hero style", "our
docs diagram look"), suggest saving it via `save_style_preset` so future
calls just reference the name.

## Cost discipline

- Mention the cost in your reply (the tool returns it).
- If the user is iterating heavily, surface today's running total.
- Cache hits (`cached: true` in the response) cost $0 — don't re-tell
  the user that's a paid call.
- If you hit BUDGET_EXCEEDED, tell the user the cap and suggest either
  raising it via `set_budget` or switching to a cheaper tier.

## Reproducibility

Every output writes a `.regenerate.json` sidecar next to the file. To
re-run an image with a tweak, use `iterate` with an adjustment phrase.
To re-run identically, use `regenerate`.
