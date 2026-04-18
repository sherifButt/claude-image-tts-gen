---
description: List, save, or delete style/voice presets
argument-hint: [list | save-style <name> | save-voice <name> | delete <kind> <name>]
allowed-tools:
  - mcp__claude-image-tts-gen__list_presets
  - mcp__claude-image-tts-gen__save_style_preset
  - mcp__claude-image-tts-gen__save_voice_preset
  - mcp__claude-image-tts-gen__delete_preset
---

Manage saved presets: $ARGUMENTS

Routes:
- `list` (or no args) → `list_presets`
- `save-style <name>` → ask the user for provider, tier, optional prompt
  prefix/suffix, then `save_style_preset`
- `save-voice <name>` → ask for provider, tier, optional voice, then
  `save_voice_preset`
- `delete <style|voice> <name>` → `delete_preset`

Saved presets can be applied at gen time via `style: '<name>'` (image)
or `voicePreset: '<name>'` (speech). Explicit args still override preset
fields.
