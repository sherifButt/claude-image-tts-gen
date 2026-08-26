---
description: Check every configured provider's credentials + capabilities before you spend anything
argument-hint: [pocket|voicebox|local|all]
allowed-tools:
  - mcp__claude-image-tts-gen__health_check
  - mcp__claude-image-tts-gen__check_pocket
  - mcp__claude-image-tts-gen__check_voicebox
  - mcp__claude-image-tts-gen__check_local
  - mcp__claude-image-tts-gen__list_providers
---

Run a credentials + capability check: $ARGUMENTS

Pick the tool from the argument (default `all`):

- **`all`** (or no argument) → `health_check`. Pings every configured provider, reports
  latency, flags anything unconfigured or failing, and warns when the pricing table is
  stale (>30 days). Surfaces per-provider **capability notes** too — a provider can be
  reachable and still be missing something.
- **`pocket`** → `check_pocket`. Reachability, the 26 built-in voices, and whether **voice
  cloning actually works** (it clones a probe clip rather than trusting `/health`, which
  reports `healthy` even when the gated cloning weights failed to load). $0, ~0.5s.
- **`voicebox`** → `check_voicebox`. Profiles, engines, per-engine capabilities.
- **`local`** → `check_local`. Which models the OpenAI-compatible server exposes, and
  which backend it looks like.

Run this **before** a long or expensive run rather than discovering a broken provider
part-way through — that's the entire point of these tools. Especially worth it before:

- a long narration run on pocket-tts or Voicebox (a mid-run failure wastes the whole batch)
- anything using voice cloning (the failure mode is a *stranger's voice*, not an error)
- an expensive video or avatar batch (confirm `REPLICATE_API_TOKEN` works first)

Report back plainly: what works, what doesn't, and the exact fix for anything broken.
Don't paper over a failure — if cloning is unavailable, say so, because the tools will
refuse a cloning request rather than quietly substituting a stock voice.
