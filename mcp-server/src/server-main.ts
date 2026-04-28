import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadConfig } from "./config.js";
import {
  getDefaultProvider,
  getDefaultTier,
  listDeclared,
} from "./providers/registry.js";
import { z } from "zod";
import { batchStatus, type BatchStatusArgs } from "./tools/batch-status.js";
import { batchSubmit, type BatchSubmitArgs } from "./tools/batch-submit.js";
import { checkLocal } from "./tools/check-local.js";
import { checkVoicebox } from "./tools/check-voicebox.js";
import {
  checkBatchAvailability,
  createAssets,
  type CreateAssetsArgs,
  type CreateAssetsMode,
} from "./tools/create-assets.js";
import { estimateCostDryRun, type EstimateCostArgs } from "./tools/estimate-cost.js";
import { exportSpend, type ExportSpendArgs } from "./tools/export-spend.js";
import { generateImage, type GenerateImageArgs } from "./tools/generate-image.js";
import { generateSpeech, type GenerateSpeechArgs } from "./tools/generate-speech.js";
import { healthCheck } from "./tools/health-check.js";
import { iterate, type IterateArgs } from "./tools/iterate.js";
import { pickVariant, type PickVariantArgs } from "./tools/pick-variant.js";
import { postProcess, type PostProcessArgs } from "./tools/post-process.js";
import {
  deletePreset,
  listPresets,
  saveStylePreset,
  saveVoicePreset,
  type DeletePresetArgs,
  type ListPresetsArgs,
  type SaveStylePresetArgs,
  type SaveVoicePresetArgs,
} from "./tools/presets.js";
import { regenerate, type RegenerateArgs } from "./tools/regenerate.js";
import { sessionSpend } from "./tools/session-spend.js";
import { setBudget, type SetBudgetArgs } from "./tools/set-budget.js";
import { variants, type VariantsArgs } from "./tools/variants.js";
import { PRESETS } from "./post/image-presets.js";
import { rewritePromptViaMcpSampling } from "./rewriter/sampling.js";
import { formatBudgetWarning } from "./state/budget.js";
import { readSession } from "./state/store.js";
import { asStructuredError } from "./util/errors.js";

const VERSION = "0.0.1";
const config = loadConfig();

const server = new Server(
  { name: "claude-image-tts-gen", version: VERSION },
  { capabilities: { tools: {}, resources: { listChanged: false } } },
);

// Expose recently generated assets as MCP resources so the host
// (Claude Desktop) can render them in an asset panel.
const RESOURCE_PREFIX = "claude-image-tts-gen://output/";
const RECENT_RESOURCE_LIMIT = 50;

function fileExtToMime(p: string): string {
  const ext = p.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "opus") return "audio/ogg";
  if (ext === "srt" || ext === "vtt") return "text/plain";
  return "application/octet-stream";
}

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const session = await readSession();
  const recent = session.calls.slice(-RECENT_RESOURCE_LIMIT).reverse();
  const resources = recent
    .filter((c) => c.files.length > 0 && existsSync(c.files[0]))
    .map((c) => ({
      uri: `${RESOURCE_PREFIX}${encodeURIComponent(c.files[0])}`,
      name: basename(c.files[0]),
      description: `${c.tool} via ${c.provider}/${c.tier} on ${c.ts.slice(0, 19)}Z (USD ${c.cost.toFixed(4)})`,
      mimeType: fileExtToMime(c.files[0]),
    }));
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (!uri.startsWith(RESOURCE_PREFIX)) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }
  const filePath = decodeURIComponent(uri.slice(RESOURCE_PREFIX.length));
  if (!existsSync(filePath)) {
    throw new Error(`Resource file no longer exists: ${filePath}`);
  }
  const mimeType = fileExtToMime(filePath);
  const data = await readFile(filePath);
  if (mimeType.startsWith("text/")) {
    return {
      contents: [{ uri, mimeType, text: data.toString("utf8") }],
    };
  }
  return {
    contents: [{ uri, mimeType, blob: data.toString("base64") }],
  };
});

const imageInputSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "What to generate." },
    provider: {
      type: "string",
      enum: ["google", "openai", "openrouter", "local"],
      description: `Provider. Default: ${getDefaultProvider("image")}. local uses LOCAL_BASE_URL (Kokoro-FastAPI / Speaches / Orpheus-FastAPI / etc.).`,
    },
    tier: {
      type: "string",
      enum: ["small", "mid", "pro"],
      description: `Quality/cost tier. Default: ${getDefaultTier()}.`,
    },
    model: { type: "string", description: "Optional explicit model override." },
    outputPath: { type: "string", description: "Optional explicit output path." },
    style: { type: "string", description: "Apply a saved style preset by name." },
    referenceImagePath: {
      type: "string",
      description: "Path to a reference image (image-to-image). Supports gpt-image-2 / gpt-image-1 (edits) and Gemini multimodal.",
    },
    aspectRatio: {
      type: "string",
      enum: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
      description:
        "Output aspect ratio. Defaults to 1:1 if omitted. OG / social-landscape → 16:9 or 3:2; story/mobile portrait → 9:16; Instagram square → 1:1.",
    },
    outputDir: {
      type: "string",
      description:
        "Directory for the auto-generated filename (ignored if outputPath is passed). Overrides the image output dir from env.",
    },
    sidecar: {
      type: "boolean",
      description:
        "Write a hidden .<name>.regenerate.json sidecar next to the output. Default true (enables regenerate/iterate). Set false for one-shot throwaway renders.",
    },
  },
  required: ["prompt"],
} as const;

const speechInputSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Text to speak." },
    provider: {
      type: "string",
      enum: ["openai", "google", "elevenlabs", "local", "voicebox"],
      description: `Provider. Default: ${getDefaultProvider("tts")}. local uses LOCAL_BASE_URL (Kokoro-FastAPI / Speaches / Orpheus-FastAPI / etc.). voicebox uses VOICEBOX_BASE_URL (default http://localhost:17493 — voicebox.sh).`,
    },
    tier: {
      type: "string",
      enum: ["small", "mid", "pro"],
      description: `Quality/cost tier. Default: ${getDefaultTier()}.`,
    },
    model: { type: "string", description: "Optional explicit model override." },
    voice: { type: "string", description: "Voice ID. Per-provider list via list_providers." },
    outputPath: { type: "string", description: "Optional explicit output path." },
    captions: {
      type: "string",
      enum: ["none", "srt", "vtt", "both"],
      description: "Write caption files alongside audio. Requires provider with word-level timestamps (ElevenLabs).",
    },
    voicePreset: { type: "string", description: "Apply a saved voice preset by name." },
    referenceAudioPath: {
      type: "string",
      description:
        "Path to a reference audio file (wav/mp3) for zero-shot voice cloning. Only the `local` provider supports this — run Chatterbox-TTS or a Coqui-TTS / XTTS server. For ElevenLabs cloning, create the voice on elevenlabs.io/voice-lab and pass its ID via `voice`.",
    },
    outputDir: {
      type: "string",
      description:
        "Directory for the auto-generated filename (ignored if outputPath is passed). Overrides the audio output dir from env.",
    },
    sidecar: {
      type: "boolean",
      description:
        "Write a hidden .<name>.regenerate.json sidecar next to the output. Default true. Set false for one-shot throwaway renders.",
    },
    debug: {
      type: "boolean",
      description:
        "Include per-chunk file paths (chunkFiles) in the response for troubleshooting. Default false. files[0] is always the stitched deliverable — do not re-concat chunks yourself.",
    },
    maxCharsPerChunk: {
      type: "number",
      minimum: 1,
      description:
        "Override the per-chunk character ceiling. Lower this when a neural TTS engine degrades on long inputs (Voicebox Qwen3-TTS / Chatterbox / Kokoro typically peak at ~300 chars per call). Chunker stays sentence-aware. Defaults to the provider slot's value (Voicebox: 300, Gemini: 4000, OpenAI: 4096, ElevenLabs: 5000).",
    },
  },
  required: ["text"],
} as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_image",
      description: `Generate an image. Default ${getDefaultProvider("image")}/${getDefaultTier()}. Output dir: ${config.imageOutputDir}.`,
      inputSchema: imageInputSchema,
    },
    {
      name: "generate_speech",
      description: `Generate speech audio. Default ${getDefaultProvider("tts")}/${getDefaultTier()}. Output dir: ${config.audioOutputDir}. Pass the full text in one call — this tool chunks long text at sentence boundaries and stitches the result into a single file via ffmpeg; pre-chunking externally loses voice/cache/sidecar fidelity. files[0] is always the final stitched deliverable.`,
      inputSchema: speechInputSchema,
    },
    {
      name: "create_asset",
      description: "Generic media asset alias. v1: routes to generate_image (TTS via generate_speech).",
      inputSchema: imageInputSchema,
    },
    {
      name: "list_providers",
      description: "List declared providers, tiers, models, and voices for a modality.",
      inputSchema: {
        type: "object",
        properties: {
          modality: { type: "string", enum: ["image", "tts"] },
        },
        required: ["modality"],
      },
    },
    {
      name: "session_spend",
      description:
        "Show running spend totals (today / week / month / all-time), per-provider, per-tier, plus 10 most recent calls.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "boolean", description: "Scope to current project (cwd-hashed) instead of global session" },
        },
      },
    },
    {
      name: "export_spend",
      description: "Export the spend ledger as CSV or JSON, optionally filtered to a YYYY-MM month.",
      inputSchema: {
        type: "object",
        properties: {
          month: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "Optional YYYY-MM filter" },
          format: { type: "string", enum: ["csv", "json"], description: "Default: csv" },
        },
      },
    },
    {
      name: "estimate_cost",
      description:
        "Dry-run cost estimate across implemented providers and tiers for a given modality. Shows standard + batch prices and identifies the cheapest option.",
      inputSchema: {
        type: "object",
        properties: {
          modality: { type: "string", enum: ["image", "tts"] },
          count: { type: "number", description: "Number of images (default 1)" },
          text: { type: "string", description: "TTS text — char count is used" },
          chars: { type: "number", description: "Override TTS char count directly" },
          provider: { type: "string", enum: ["google", "openai", "openrouter", "elevenlabs"] },
          tier: { type: "string", enum: ["small", "mid", "pro"] },
        },
        required: ["modality"],
      },
    },
    {
      name: "set_budget",
      description:
        "Update spend caps. Pass null to clear a cap. softThreshold is 0..1 (default 0.8 = warn at 80%).",
      inputSchema: {
        type: "object",
        properties: {
          daily: { type: ["number", "null"] },
          weekly: { type: ["number", "null"] },
          monthly: { type: ["number", "null"] },
          softThreshold: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    {
      name: "health_check",
      description:
        "Ping each configured provider to verify auth, report latency, and check pricing staleness.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "check_local",
      description:
        "Hit the local OpenAI-compatible server's /v1/models endpoint and report which models are loaded, which backend it looks like (Kokoro-FastAPI, Orpheus-FastAPI, Speaches, LM Studio, ...), and whether TTS/image models are available. Reads LOCAL_BASE_URL.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "check_voicebox",
      description:
        "Probe the Voicebox server (voicebox.sh) at VOICEBOX_BASE_URL and report: server health (model loaded, GPU), profiles you have (voice IDs, language, voice_type), available engines with capabilities (qwen=cloning+instruct, chatterbox_turbo=tags like [laugh]/[sigh], kokoro=preset-only, ...), and preset voice counts per engine. Use this before calling generate_speech via Voicebox to pick the right engine for tags / cloning / multi-language needs.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "create_assets",
      description:
        "Generate multiple media assets at once. With mode:'auto' (default), the server elicits the user to choose batch (50% off, ≤24h) vs sync when ≥2 prompts and the provider supports batch. mode:'sync' runs parallel calls; mode:'batch' submits a batch job.",
      inputSchema: {
        type: "object",
        properties: {
          modality: { type: "string", enum: ["image", "tts"] },
          prompts: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" }, voice: { type: "string" } },
              required: ["text"],
            },
            minItems: 1,
          },
          provider: { type: "string", enum: ["google", "openai", "openrouter", "elevenlabs"] },
          tier: { type: "string", enum: ["small", "mid", "pro"] },
          model: { type: "string" },
          mode: { type: "string", enum: ["batch", "sync", "auto"], description: "Default: auto" },
        },
        required: ["modality", "prompts"],
      },
    },
    {
      name: "batch_submit",
      description:
        "Submit multiple prompts as a batch (50% off vs sync, ≤24h SLA). Currently implemented: google/image. Returns a jobId to poll with batch_status.",
      inputSchema: {
        type: "object",
        properties: {
          modality: { type: "string", enum: ["image", "tts"] },
          prompts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                voice: { type: "string" },
              },
              required: ["text"],
            },
            minItems: 1,
          },
          provider: { type: "string", enum: ["google", "openai", "openrouter", "elevenlabs"] },
          tier: { type: "string", enum: ["small", "mid", "pro"] },
          model: { type: "string" },
        },
        required: ["modality", "prompts"],
      },
    },
    {
      name: "batch_status",
      description:
        "Poll a batch job by jobId, or list all jobs. On completion, downloads results, writes files + sidecars + ledger entries.",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          list: { type: "boolean" },
        },
      },
    },
    {
      name: "save_style_preset",
      description: "Save a named image style preset (defaults + prompt prefix/suffix). Reference it later via the 'style' field on generate_image.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
          preset: {
            type: "object",
            properties: {
              provider: { type: "string", enum: ["google", "openai", "openrouter"] },
              tier: { type: "string", enum: ["small", "mid", "pro"] },
              model: { type: "string" },
              promptPrefix: { type: "string" },
              promptSuffix: { type: "string" },
              notes: { type: "string" },
            },
          },
        },
        required: ["name", "preset"],
      },
    },
    {
      name: "save_voice_preset",
      description: "Save a named TTS voice preset. Reference it via 'voicePreset' on generate_speech.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
          preset: {
            type: "object",
            properties: {
              provider: { type: "string", enum: ["openai", "google", "elevenlabs", "local", "voicebox"] },
              tier: { type: "string", enum: ["small", "mid", "pro"] },
              model: { type: "string" },
              voice: { type: "string" },
              notes: { type: "string" },
            },
          },
        },
        required: ["name", "preset"],
      },
    },
    {
      name: "list_presets",
      description: "List saved style and/or voice presets.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["style", "voice", "all"], description: "Default: all" },
        },
      },
    },
    {
      name: "delete_preset",
      description: "Delete a saved preset by kind + name.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["style", "voice"] },
          name: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
        },
        required: ["kind", "name"],
      },
    },
    {
      name: "post_process",
      description:
        `Resize, webp-convert, or strip background from an image. Presets: ${Object.keys(PRESETS).join(", ")}. bgRemove uses a local ONNX model — no API cost.`,
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to source image" },
          presets: {
            type: "array",
            items: { type: "string", enum: Object.keys(PRESETS) },
          },
          webp: { type: "boolean", description: "Also emit a .webp" },
          webpQuality: { type: "number", minimum: 1, maximum: 100, description: "Default 85" },
          bgRemove: { type: "boolean", description: "Strip background to a transparent PNG. Runs before presets so cutouts cascade through resizes. Best on photographic subjects (portraits, products, single objects on a plain background) — can mis-segment dense illustration scenes (crowds, where's-waldo-style art) because the underlying model is photo-trained." },
        },
        required: ["input"],
      },
    },
    {
      name: "iterate",
      description:
        "Iterate on a prior generation by appending an adjustment to its prompt (e.g. 'make it more dramatic'). Lineage is preserved in the new sidecar.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Sidecar path or original output file" },
          adjustment: { type: "string", description: "Tweak instruction" },
          mode: {
            type: "string",
            enum: ["append", "replace"],
            description: "append (default) appends to original; replace replaces it entirely",
          },
          outputPath: { type: "string" },
        },
        required: ["path", "adjustment"],
      },
    },
    {
      name: "variants",
      description:
        "Generate N variants of a prompt in parallel and produce a contact-sheet PNG for selection. Use pick_variant to keep one.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          n: { type: "number", minimum: 2, maximum: 9, description: "Default 4" },
          provider: { type: "string", enum: ["google", "openai", "openrouter"] },
          tier: { type: "string", enum: ["small", "mid", "pro"] },
          model: { type: "string" },
        },
        required: ["prompt"],
      },
    },
    {
      name: "pick_variant",
      description:
        "Soft-deletes non-keeper variants (and their sidecars + contact sheet) into a .trash/ subdirectory.",
      inputSchema: {
        type: "object",
        properties: {
          keeper: { type: "string" },
          variants: { type: "array", items: { type: "string" }, minItems: 1 },
          contactSheet: { type: "string" },
        },
        required: ["keeper", "variants"],
      },
    },
    {
      name: "regenerate",
      description:
        "Re-run a prior generation from its sidecar (.regenerate.json). Pass the original output path or the sidecar path. Lineage is tracked.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the original output file or its .regenerate.json sidecar.",
          },
          outputPath: {
            type: "string",
            description: "Optional output path for the new file. Auto-generated if omitted.",
          },
        },
        required: ["path"],
      },
    },
  ],
}));

async function handleImageCall(args: unknown) {
  const parsed = (args ?? {}) as GenerateImageArgs;

  // Optional MCP-sampling-based prompt rewrite (image only). Falls back gracefully.
  let rewriteNote: string | null = null;
  if (config.rewritePrompts && parsed.prompt) {
    const providerHint = parsed.provider ?? getDefaultProvider("image");
    const rewrite = await rewritePromptViaMcpSampling(server, parsed.prompt, providerHint);
    if (rewrite) {
      rewriteNote = `Prompt rewritten via MCP sampling for ${providerHint}.`;
      parsed.prompt = rewrite.rewritten;
    }
  }

  const result = await generateImage(parsed, config);
  const lines = [
    `Image generated.`,
    `File: ${result.files[0]}`,
    `Provider: ${result.providerUsed} (${result.tier} tier)`,
    `Model: ${result.modelUsed}`,
    `Cost: ${result.cost.currency} ${result.cost.total.toFixed(4)}` +
      `${result.cached ? ` [cached, would have been ${result.cost.currency} ${result.cost.pricePerUnit.toFixed(4)}]` : result.cost.isBatchPrice ? " [batch]" : ""}`,
    `Today: ${result.sessionTotal.currency} ${result.sessionTotal.today.cost.toFixed(4)} ` +
      `(${result.sessionTotal.today.callCount} calls)`,
  ];
  if (rewriteNote) lines.push(rewriteNote);
  if (result.budgetWarning) lines.push(formatBudgetWarning(result.budgetWarning));
  return {
    structuredContent: result,
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

async function handleSpeechCall(args: unknown) {
  const result = await generateSpeech((args ?? {}) as GenerateSpeechArgs, config);
  const lines = [
    `Speech generated.`,
    `File: ${result.files[0]}`,
    `Provider: ${result.providerUsed} (${result.tier} tier)`,
    `Model: ${result.modelUsed}`,
    `Voice: ${result.voiceUsed ?? "(default)"}`,
    `Cost: ${result.cost.currency} ${result.cost.total.toFixed(4)} (${result.cost.units} chars)` +
      `${result.cached ? " [cached]" : ""}`,
    `Today: ${result.sessionTotal.currency} ${result.sessionTotal.today.cost.toFixed(4)} ` +
      `(${result.sessionTotal.today.callCount} calls)`,
  ];
  if (result.chunkCount > 1) lines.push(`Chunks: ${result.chunkCount} (concat'd via ffmpeg)`);
  if (result.captions?.srt) lines.push(`SRT: ${result.captions.srt}`);
  if (result.captions?.vtt) lines.push(`VTT: ${result.captions.vtt}`);
  if (result.captionsSkipped) lines.push(result.captionsSkipped);
  if (result.budgetWarning) lines.push(formatBudgetWarning(result.budgetWarning));
  return {
    structuredContent: result,
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

async function handleExportSpend(args: unknown) {
  const result = await exportSpend((args ?? {}) as ExportSpendArgs);
  return {
    structuredContent: { ...result, text: undefined },
    content: [{ type: "text", text: result.text }],
  };
}

async function handleSessionSpend(args: unknown) {
  const parsed = (args ?? {}) as { project?: boolean };
  const result = await sessionSpend({ project: parsed.project });
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

function handleEstimateCost(args: unknown) {
  const result = estimateCostDryRun((args ?? {}) as EstimateCostArgs);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleSetBudget(args: unknown) {
  const result = await setBudget((args ?? {}) as SetBudgetArgs);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

const ElicitResultSchema = z.object({
  action: z.enum(["accept", "decline", "cancel"]),
  content: z.record(z.unknown()).optional(),
});

async function elicitBatchVsSync(args: CreateAssetsArgs): Promise<CreateAssetsMode | null> {
  const availability = checkBatchAvailability(args);
  if (!availability.available) return "sync";
  if (availability.savings === undefined || availability.savings <= 0) return "sync";

  const message =
    `You queued ${args.prompts.length} ${args.modality} prompts for ${args.provider ?? "the default provider"}. ` +
    `Run as batch (${availability.currency} ${availability.batchCost?.toFixed(4)}, 50% off, up to 24h) ` +
    `or sync now (${availability.currency} ${availability.syncCost?.toFixed(4)}, immediate)?`;

  try {
    const result = await server.request(
      {
        method: "elicitation/create",
        params: {
          message,
          requestedSchema: {
            type: "object",
            properties: {
              mode: {
                type: "string",
                enum: ["batch", "sync"],
                description: "batch = wait ≤24h for 50% off; sync = run now at full price",
              },
            },
            required: ["mode"],
          },
        },
      },
      ElicitResultSchema,
    );
    if (result.action === "accept") {
      const mode = result.content?.mode;
      if (mode === "batch" || mode === "sync") return mode;
    }
    return "sync";
  } catch {
    // Client doesn't support elicitation, or it failed — fall back to sync.
    return null;
  }
}

async function handleCreateAssets(args: unknown) {
  const parsed = (args ?? {}) as CreateAssetsArgs;
  if (parsed.mode === undefined || parsed.mode === "auto") {
    const elicited = await elicitBatchVsSync(parsed);
    parsed.mode = elicited ?? "sync";
  }
  const result = await createAssets(parsed, config);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleBatchSubmit(args: unknown) {
  const result = await batchSubmit((args ?? {}) as BatchSubmitArgs, config);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleBatchStatus(args: unknown) {
  const result = await batchStatus((args ?? {}) as BatchStatusArgs, config);
  if (result.transitioned && result.job) {
    try {
      await server.notification({
        method: "notifications/message",
        params: {
          level: result.job.status === "completed" ? "info" : "warning",
          logger: "claude-image-tts-gen",
          data:
            `Batch ${result.job.jobId} ${result.job.status}: ` +
            `${result.job.outputs.length} files, ` +
            `${result.job.currency} ${result.job.actualCost.toFixed(4)} actual cost.`,
        },
      });
    } catch {
      // ignore — not all clients support notifications/message
    }
  }
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleHealthCheck() {
  const result = await healthCheck(config);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleCheckLocal() {
  const result = await checkLocal(config);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleCheckVoicebox() {
  const result = await checkVoicebox(config);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleSaveStylePreset(args: unknown) {
  const result = await saveStylePreset((args ?? {}) as SaveStylePresetArgs);
  return { structuredContent: result, content: [{ type: "text", text: result.text }] };
}
async function handleSaveVoicePreset(args: unknown) {
  const result = await saveVoicePreset((args ?? {}) as SaveVoicePresetArgs);
  return { structuredContent: result, content: [{ type: "text", text: result.text }] };
}
async function handleListPresets(args: unknown) {
  const result = await listPresets((args ?? {}) as ListPresetsArgs);
  return { structuredContent: result, content: [{ type: "text", text: result.text }] };
}
async function handleDeletePreset(args: unknown) {
  const result = await deletePreset((args ?? {}) as DeletePresetArgs);
  return { structuredContent: result, content: [{ type: "text", text: result.text }] };
}

async function handlePostProcess(args: unknown) {
  const result = await postProcess((args ?? {}) as PostProcessArgs);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleIterate(args: unknown) {
  const result = await iterate((args ?? {}) as IterateArgs, config);
  const tool = "voiceUsed" in result ? "generate_speech" : "generate_image";
  return {
    structuredContent: result,
    content: [
      {
        type: "text",
        text:
          `Iterated (${tool}).\n` +
          `File: ${result.files[0]}\n` +
          `Sidecar: ${result.sidecar}\n` +
          `Cost: ${result.cost.currency} ${result.cost.total.toFixed(4)}`,
      },
    ],
  };
}

async function handleVariants(args: unknown) {
  const result = await variants((args ?? {}) as VariantsArgs, config);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handlePickVariant(args: unknown) {
  const result = await pickVariant((args ?? {}) as PickVariantArgs);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleRegenerate(args: unknown) {
  const result = await regenerate((args ?? {}) as RegenerateArgs, config);
  const tool = "voiceUsed" in result ? "generate_speech" : "generate_image";
  return {
    structuredContent: result,
    content: [
      {
        type: "text",
        text:
          `Regenerated (${tool}).\n` +
          `File: ${result.files[0]}\n` +
          `Sidecar: ${result.sidecar}\n` +
          `Cost: ${result.cost.currency} ${result.cost.total.toFixed(4)}` +
          `${result.cost.isBatchPrice ? " [batch]" : ""}`,
      },
    ],
  };
}

function providerKeyConfigured(providerId: string): boolean {
  switch (providerId) {
    case "google":
      return Boolean(config.geminiApiKey);
    case "openai":
      return Boolean(config.openaiApiKey);
    case "openrouter":
      return Boolean(config.openrouterApiKey);
    case "elevenlabs":
      return Boolean(config.elevenlabsApiKey);
    case "local":
      return config.localEnabled;
    default:
      return false;
  }
}

function handleListProviders(args: unknown) {
  const { modality } = (args ?? {}) as { modality?: "image" | "tts" };
  if (modality !== "image" && modality !== "tts") {
    throw new Error("modality must be 'image' or 'tts'");
  }
  const entries = listDeclared(modality).map((e) => ({
    ...e,
    keyConfigured: providerKeyConfigured(e.provider),
    usable: e.implemented && providerKeyConfigured(e.provider),
  }));
  const lines = entries.map(
    (e) =>
      `  ${e.provider}/${e.tier}: ${e.model}` +
      `${e.batchable ? " [batch]" : ""}` +
      `${e.voices.length > 0 ? ` voices=${e.voices.join("|")}` : ""}` +
      `${e.implemented ? "" : " (not yet implemented)"}` +
      `${e.keyConfigured ? "" : " (no API key — unusable now)"}`,
  );
  const usableCount = entries.filter((e) => e.usable).length;
  return {
    structuredContent: { modality, entries, usableCount },
    content: [
      {
        type: "text",
        text:
          `Declared ${modality} providers (${usableCount} usable right now):\n` +
          lines.join("\n") +
          `\n\nPick from the rows without "(no API key…)" or "(not yet implemented)" for a guaranteed call.`,
      },
    ],
  };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  try {
    if (name === "generate_image" || name === "create_asset") {
      return await handleImageCall(request.params.arguments);
    }
    if (name === "generate_speech") {
      return await handleSpeechCall(request.params.arguments);
    }
    if (name === "list_providers") {
      return handleListProviders(request.params.arguments);
    }
    if (name === "session_spend") {
      return await handleSessionSpend(request.params.arguments);
    }
    if (name === "export_spend") {
      return await handleExportSpend(request.params.arguments);
    }
    if (name === "estimate_cost") {
      return handleEstimateCost(request.params.arguments);
    }
    if (name === "set_budget") {
      return await handleSetBudget(request.params.arguments);
    }
    if (name === "create_assets") {
      return await handleCreateAssets(request.params.arguments);
    }
    if (name === "batch_submit") {
      return await handleBatchSubmit(request.params.arguments);
    }
    if (name === "batch_status") {
      return await handleBatchStatus(request.params.arguments);
    }
    if (name === "health_check") {
      return await handleHealthCheck();
    }
    if (name === "check_local") {
      return await handleCheckLocal();
    }
    if (name === "check_voicebox") {
      return await handleCheckVoicebox();
    }
    if (name === "save_style_preset") return await handleSaveStylePreset(request.params.arguments);
    if (name === "save_voice_preset") return await handleSaveVoicePreset(request.params.arguments);
    if (name === "list_presets") return await handleListPresets(request.params.arguments);
    if (name === "delete_preset") return await handleDeletePreset(request.params.arguments);
    if (name === "post_process") {
      return await handlePostProcess(request.params.arguments);
    }
    if (name === "iterate") {
      return await handleIterate(request.params.arguments);
    }
    if (name === "variants") {
      return await handleVariants(request.params.arguments);
    }
    if (name === "pick_variant") {
      return await handlePickVariant(request.params.arguments);
    }
    if (name === "regenerate") {
      return await handleRegenerate(request.params.arguments);
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    const structured = asStructuredError(
      err,
      name === "list_providers" ? "VALIDATION_ERROR" : "GENERATION_ERROR",
    );
    return {
      isError: true,
      structuredContent: structured.toJSON(),
      content: [
        {
          type: "text",
          text: `${name} failed [${structured.code}]: ${structured.message}\nFix: ${structured.suggestedFix}`,
        },
      ],
    };
  }
});

async function main(): Promise<void> {
  process.on("uncaughtException", (err) => {
    process.stderr.write(`uncaughtException: ${String(err)}\n`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`unhandledRejection: ${String(reason)}\n`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `claude-image-tts-gen MCP server v${VERSION} started ` +
      `(image=${config.imageOutputDir}, audio=${config.audioOutputDir})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`startup failed: ${String(err)}\n`);
  process.exit(1);
});
