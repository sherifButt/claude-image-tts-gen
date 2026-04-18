---
description: View or update spend caps (daily / weekly / monthly)
argument-hint: [--daily <usd>] [--weekly <usd>] [--monthly <usd>]
allowed-tools:
  - mcp__claude-image-tts-gen__set_budget
  - mcp__claude-image-tts-gen__session_spend
---

Manage the spend budget: $ARGUMENTS

If the user passed any of `--daily`, `--weekly`, or `--monthly`:
- Use `set_budget` with those values (numbers in USD).
- Pass `null` to clear a cap.

If they didn't pass anything (just `/gen-budget`):
- Run `session_spend` and surface today's spend alongside the current caps.

Default cap is `$5/day`. Soft warning at 80%, hard block at 100%.
