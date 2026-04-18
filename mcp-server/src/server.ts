import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import {
  getDefaultProvider,
  getDefaultTier,
  listDeclared,
} from "./providers/registry.js";
import { batchStatus, type BatchStatusArgs } from "./tools/batch-status.js";
import { batchSubmit, type BatchSubmitArgs } from "./tools/batch-submit.js";
import { estimateCostDryRun, type EstimateCostArgs } from "./tools/estimate-cost.js";
import { generateImage, type GenerateImageArgs } from "./tools/generate-image.js";
import { generateSpeech, type GenerateSpeechArgs } from "./tools/generate-speech.js";
import { healthCheck } from "./tools/health-check.js";
import { regenerate, type RegenerateArgs } from "./tools/regenerate.js";
import { sessionSpend } from "./tools/session-spend.js";
import { setBudget, type SetBudgetArgs } from "./tools/set-budget.js";
import { formatBudgetWarning } from "./state/budget.js";
import { asStructuredError } from "./util/errors.js";

const VERSION = "0.0.1";
const config = loadConfig();

const server = new Server(
  { name: "claude-image-tts-gen", version: VERSION },
  { capabilities: { tools: {} } },
);

const imageInputSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "What to generate." },
    provider: {
      type: "string",
      enum: ["google", "openai", "openrouter"],
      description: `Provider. Default: ${getDefaultProvider("image")}.`,
    },
    tier: {
      type: "string",
      enum: ["small", "mid", "pro"],
      description: `Quality/cost tier. Default: ${getDefaultTier()}.`,
    },
    model: { type: "string", description: "Optional explicit model override." },
    outputPath: { type: "string", description: "Optional explicit output path." },
  },
  required: ["prompt"],
} as const;

const speechInputSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Text to speak." },
    provider: {
      type: "string",
      enum: ["openai", "google", "elevenlabs"],
      description: `Provider. Default: ${getDefaultProvider("tts")}.`,
    },
    tier: {
      type: "string",
      enum: ["small", "mid", "pro"],
      description: `Quality/cost tier. Default: ${getDefaultTier()}.`,
    },
    model: { type: "string", description: "Optional explicit model override." },
    voice: { type: "string", description: "Voice ID. Per-provider list via list_providers." },
    outputPath: { type: "string", description: "Optional explicit output path." },
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
      description: `Generate speech audio. Default ${getDefaultProvider("tts")}/${getDefaultTier()}. Output dir: ${config.audioOutputDir}.`,
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
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
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
  const result = await generateImage((args ?? {}) as GenerateImageArgs, config);
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
  if (result.budgetWarning) lines.push(formatBudgetWarning(result.budgetWarning));
  return {
    structuredContent: result,
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

async function handleSessionSpend() {
  const result = await sessionSpend();
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

async function handleBatchSubmit(args: unknown) {
  const result = await batchSubmit((args ?? {}) as BatchSubmitArgs, config);
  return {
    structuredContent: result,
    content: [{ type: "text", text: result.text }],
  };
}

async function handleBatchStatus(args: unknown) {
  const result = await batchStatus((args ?? {}) as BatchStatusArgs, config);
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

function handleListProviders(args: unknown) {
  const { modality } = (args ?? {}) as { modality?: "image" | "tts" };
  if (modality !== "image" && modality !== "tts") {
    throw new Error("modality must be 'image' or 'tts'");
  }
  const entries = listDeclared(modality);
  const lines = entries.map(
    (e) =>
      `  ${e.provider}/${e.tier}: ${e.model}` +
      `${e.batchable ? " [batch]" : ""}` +
      `${e.voices.length > 0 ? ` voices=${e.voices.join("|")}` : ""}` +
      `${e.implemented ? "" : " (not yet implemented)"}`,
  );
  return {
    structuredContent: { modality, entries },
    content: [{ type: "text", text: `Declared ${modality} providers:\n${lines.join("\n")}` }],
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
      return await handleSessionSpend();
    }
    if (name === "estimate_cost") {
      return handleEstimateCost(request.params.arguments);
    }
    if (name === "set_budget") {
      return await handleSetBudget(request.params.arguments);
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
