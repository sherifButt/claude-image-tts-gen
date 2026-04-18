---
description: Generate an image with the cheapest sensible provider
argument-hint: [prompt] [--tier small|mid|pro] [--provider google|openai|openrouter]
allowed-tools:
  - mcp__claude-image-tts-gen__generate_image
  - mcp__claude-image-tts-gen__list_providers
  - mcp__claude-image-tts-gen__estimate_cost
---

Generate an image based on the user's request: $ARGUMENTS

Use the `generate_image` MCP tool. Pick the tier from the prompt's intent:

- **small** — icons, diagrams, UI mockups, simple line art (cheapest, ~$0.04 default)
- **mid** — illustrated content, social posts, mid-complexity scenes
- **pro** — photoreal hero images, marketing material, high-detail compositions

Default provider is Google Gemini Flash (also cheapest, supports batch).
If the user explicitly named a provider/tier in their prompt, use that.

After generating, surface the file path and the per-call + today's spend.
If you used a non-default provider, say why.
