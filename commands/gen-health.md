---
description: Verify each configured provider's auth + pricing freshness
allowed-tools:
  - mcp__claude-image-tts-gen__health_check
---

Run `health_check` and report:

1. Which provider keys are configured and which pings succeed
2. Per-provider latency (ms)
3. Pricing table staleness (warn if >30 days)

If any configured provider fails, suggest the fix from the structured
error (usually "verify the X_API_KEY env var" or "rotate the key").
