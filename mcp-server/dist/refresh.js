#!/usr/bin/env node
import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// src/pricing/pricing.json
var pricing_default = {
  last_updated: "2026-04-18",
  currency: "USD",
  sources: [
    "https://ai.google.dev/gemini-api/docs/pricing",
    "https://openai.com/api/pricing/",
    "https://platform.openai.com/docs/pricing",
    "https://openrouter.ai/models",
    "https://elevenlabs.io/pricing"
  ],
  models: {
    "google/gemini-2.5-flash-image": {
      modality: "image",
      pricing: {
        type: "image",
        standard: 0.039,
        batch: 0.0195
      },
      notes: "1290 output tokens per image at $30/1M output. Batch via batchGenerateContent (50% off)."
    },
    "google/imagen-4.0-generate-001": {
      modality: "image",
      pricing: {
        type: "image",
        standard: 0.04
      },
      notes: "Imagen 4 standard. No batch pricing."
    },
    "google/gemini-3-pro-image-preview": {
      modality: "image",
      pricing: {
        type: "image",
        standard: 0.134,
        batch: 0.067
      },
      notes: "Gemini 3 Pro Image Preview. Estimate per image; verify against current quote."
    },
    "openai/gpt-image-1:low": {
      modality: "image",
      pricing: {
        type: "image",
        standard: 0.011,
        batch: 55e-4
      },
      notes: "1024x1024 low quality."
    },
    "openai/gpt-image-1:medium": {
      modality: "image",
      pricing: {
        type: "image",
        standard: 0.042,
        batch: 0.021
      },
      notes: "1024x1024 medium quality."
    },
    "openai/gpt-image-1:high": {
      modality: "image",
      pricing: {
        type: "image",
        standard: 0.167,
        batch: 0.0835
      },
      notes: "1024x1024 high quality. Larger sizes (1024x1536, 1536x1024) cost ~$0.25."
    },
    "openai/tts-1": {
      modality: "tts",
      pricing: {
        type: "million_chars",
        standard: 15
      },
      notes: "Standard TTS. Not on Batch API."
    },
    "openai/tts-1-hd": {
      modality: "tts",
      pricing: {
        type: "million_chars",
        standard: 30
      },
      notes: "High-definition TTS. Not on Batch API."
    },
    "openai/gpt-4o-mini-tts": {
      modality: "tts",
      pricing: {
        type: "million_chars",
        standard: 12
      },
      notes: "Approximate per-char rate; OpenAI also bills per-token internally. Not on Batch API."
    },
    "elevenlabs/eleven_turbo_v2_5": {
      modality: "tts",
      pricing: {
        type: "million_chars",
        standard: 100
      },
      notes: "Pay-As-You-Go effective rate (~$0.10/1K chars). Plans differ \u2014 Creator/Pro/Scale."
    },
    "elevenlabs/eleven_multilingual_v2": {
      modality: "tts",
      pricing: {
        type: "million_chars",
        standard: 180
      },
      notes: "Pay-As-You-Go effective rate (~$0.18/1K chars). Plans differ."
    },
    "openrouter/google/gemini-2.5-flash-image": {
      modality: "image",
      pricing: {
        type: "image",
        standard: 0.039
      },
      notes: "Passthrough to Google Gemini Flash Image. OpenRouter may apply small margin (~5%); verify your invoices."
    },
    "openrouter/google/gemini-3-pro-image-preview": {
      modality: "image",
      pricing: {
        type: "image",
        standard: 0.134
      },
      notes: "Passthrough to Gemini 3 Pro Image. OpenRouter may apply small margin."
    }
  }
};

// src/pricing/load.ts
var TABLE = pricing_default;
var STALE_THRESHOLD_DAYS = 30;
function getPriceTable() {
  return TABLE;
}
function getStaleness(now = /* @__PURE__ */ new Date()) {
  const lastUpdated = TABLE.last_updated;
  const last = /* @__PURE__ */ new Date(`${lastUpdated}T00:00:00Z`);
  const ms = now.getTime() - last.getTime();
  const daysAgo = Math.max(0, Math.floor(ms / (1e3 * 60 * 60 * 24)));
  return {
    lastUpdated,
    daysAgo,
    threshold: STALE_THRESHOLD_DAYS,
    isStale: daysAgo > STALE_THRESHOLD_DAYS
  };
}

// src/pricing/refresh.ts
function main() {
  const table = getPriceTable();
  const staleness = getStaleness();
  process.stdout.write(`Pricing table:
`);
  process.stdout.write(`  last_updated: ${staleness.lastUpdated} (${staleness.daysAgo} days ago)
`);
  process.stdout.write(`  status:       ${staleness.isStale ? "STALE" : "fresh"} (threshold ${staleness.threshold} days)
`);
  process.stdout.write(`  currency:     ${table.currency}
`);
  process.stdout.write(`  models:       ${Object.keys(table.models).length}

`);
  process.stdout.write(`Sources to verify (open each, compare to pricing.json):
`);
  for (const source of table.sources) {
    process.stdout.write(`  - ${source}
`);
  }
  process.stdout.write(`
To refresh:
`);
  process.stdout.write(`  1. Open each source URL above and check current rates.
`);
  process.stdout.write(`  2. Edit src/pricing/pricing.json (update standard/batch rates per model).
`);
  process.stdout.write(`  3. Update last_updated to today's date (YYYY-MM-DD).
`);
  process.stdout.write(`  4. Run npm run build to bundle the new prices into dist/.
`);
  process.stdout.write(`  5. Run npm run pricing:refresh again to confirm last_updated changed.
`);
}
main();
