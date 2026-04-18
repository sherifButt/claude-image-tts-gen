---
description: Dry-run cost estimate across implemented providers
argument-hint: [image|tts] [count or text] [--provider <id>] [--tier <tier>]
allowed-tools:
  - mcp__claude-image-tts-gen__estimate_cost
  - mcp__claude-image-tts-gen__list_providers
---

Estimate cost for what the user is about to generate: $ARGUMENTS

Use `estimate_cost` with the modality. For image: pass `count` (default 1).
For TTS: pass `text` (char count is computed) or `chars` directly.

The output sorts implemented (provider, tier) combos by cost and shows
batch prices alongside standard. Tell the user the cheapest standard and
cheapest batch options.

If the user is comparing multiple options, run estimate_cost twice and
diff the results.
