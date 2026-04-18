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
import { generateImage, type GenerateImageArgs } from "./tools/generate-image.js";
import { generateSpeech, type GenerateSpeechArgs } from "./tools/generate-speech.js";
import { regenerate, type RegenerateArgs } from "./tools/regenerate.js";
import { sessionSpend } from "./tools/session-spend.js";

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
  return {
    structuredContent: result,
    content: [
      {
        type: "text",
        text:
          `Image generated.\n` +
          `File: ${result.files[0]}\n` +
          `Provider: ${result.providerUsed} (${result.tier} tier)\n` +
          `Model: ${result.modelUsed}\n` +
          `Cost: ${result.cost.currency} ${result.cost.total.toFixed(4)}` +
          `${result.cached ? ` [cached, would have been ${result.cost.currency} ${result.cost.pricePerUnit.toFixed(4)}]` : result.cost.isBatchPrice ? " [batch]" : ""}\n` +
          `Today: ${result.sessionTotal.currency} ${result.sessionTotal.today.cost.toFixed(4)} ` +
          `(${result.sessionTotal.today.callCount} calls)`,
      },
    ],
  };
}

async function handleSpeechCall(args: unknown) {
  const result = await generateSpeech((args ?? {}) as GenerateSpeechArgs, config);
  return {
    structuredContent: result,
    content: [
      {
        type: "text",
        text:
          `Speech generated.\n` +
          `File: ${result.files[0]}\n` +
          `Provider: ${result.providerUsed} (${result.tier} tier)\n` +
          `Model: ${result.modelUsed}\n` +
          `Voice: ${result.voiceUsed ?? "(default)"}\n` +
          `Cost: ${result.cost.currency} ${result.cost.total.toFixed(4)} ` +
          `(${result.cost.units} chars)` +
          `${result.cached ? " [cached]" : ""}\n` +
          `Today: ${result.sessionTotal.currency} ${result.sessionTotal.today.cost.toFixed(4)} ` +
          `(${result.sessionTotal.today.callCount} calls)`,
      },
    ],
  };
}

async function handleSessionSpend() {
  const result = await sessionSpend();
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
    if (name === "regenerate") {
      return await handleRegenerate(request.params.arguments);
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      structuredContent: {
        success: false,
        errorCode: name === "list_providers" ? "VALIDATION_ERROR" : "GENERATION_ERROR",
        error: message,
      },
      content: [{ type: "text", text: `${name} failed: ${message}` }],
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
