import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import {
  getDefaultProvider,
  getDefaultTier,
  listDeclared,
} from "./providers/registry.js";
import { batchStatus } from "./tools/batch-status.js";
import { batchSubmit } from "./tools/batch-submit.js";
import { createAssets, type CreateAssetsMode } from "./tools/create-assets.js";
import { estimateCostDryRun } from "./tools/estimate-cost.js";
import { generateImage } from "./tools/generate-image.js";
import { generateSpeech } from "./tools/generate-speech.js";
import { healthCheck } from "./tools/health-check.js";
import { regenerate } from "./tools/regenerate.js";
import { sessionSpend } from "./tools/session-spend.js";
import { setBudget } from "./tools/set-budget.js";
import { asStructuredError } from "./util/errors.js";
import type { Modality, ProviderId, Tier } from "./providers/types.js";

const VERSION = "0.0.1";

function printHelp(imageOutputDir: string, audioOutputDir: string): void {
  process.stdout.write(`
claude-image-tts-gen-cli v${VERSION}

Usage:
  cli [options]                            # generate image (default)
  cli --speech -p "..." [options]          # generate TTS audio

Options:
  -p, --prompt <text>      Prompt (image) or text (speech). Required for generation.
  -P, --provider <id>      Provider. Default image: ${getDefaultProvider("image")}, default tts: ${getDefaultProvider("tts")}.
  -t, --tier <tier>        Quality/cost tier: small | mid | pro (default: ${getDefaultTier()})
  -m, --model <model>      Explicit model override (skips registry)
  -v, --voice <voice>      Voice ID for TTS (registry-validated)
  -o, --output <path>      Output file path (auto-generated if omitted)
  -d, --output-dir <dir>   Output directory (image: ${imageOutputDir}, audio: ${audioOutputDir})
      --speech             Generate speech audio instead of an image
      --list-providers <m> List declared providers for modality m (image|tts)
      --session-spend      Show running spend totals (today/week/month/all-time)
  -R, --regenerate <path>  Re-run a prior generation from its sidecar or output path
      --estimate-cost      Dry-run cost estimate across implemented providers/tiers
      --set-budget-daily <n>    Set daily cap (USD; "null" to clear)
      --set-budget-weekly <n>   Set weekly cap
      --set-budget-monthly <n>  Set monthly cap
      --batch-submit <file>     Submit batch from a JSON file: {modality, prompts, provider?, tier?}
      --batch-status <jobId>    Poll a batch job
      --batch-list              List all batch jobs
      --create-assets <file>    Orchestrator: takes {modality, prompts[]} JSON file
      --mode <mode>             create-assets mode: batch | sync | auto (default sync from CLI)
  -h, --help               Show this help

Environment:
  GEMINI_API_KEY           Required for google provider
  OPENAI_API_KEY           Required for openai provider
  OPENROUTER_API_KEY       (not yet wired)
  ELEVENLABS_API_KEY       (not yet wired)
`);
}

function isProvider(s: string | undefined): s is ProviderId {
  return s === "google" || s === "openai" || s === "openrouter" || s === "elevenlabs";
}
function isTier(s: string | undefined): s is Tier {
  return s === "small" || s === "mid" || s === "pro";
}
function isModality(s: string | undefined): s is Modality {
  return s === "image" || s === "tts";
}

async function main(): Promise<void> {
  try {
    const { values } = parseArgs({
      options: {
        prompt: { type: "string", short: "p" },
        provider: { type: "string", short: "P" },
        tier: { type: "string", short: "t" },
        model: { type: "string", short: "m" },
        voice: { type: "string", short: "v" },
        output: { type: "string", short: "o" },
        "output-dir": { type: "string", short: "d" },
        speech: { type: "boolean", default: false },
        "list-providers": { type: "string" },
        "session-spend": { type: "boolean", default: false },
        regenerate: { type: "string", short: "R" },
        "estimate-cost": { type: "boolean", default: false },
        "set-budget-daily": { type: "string" },
        "set-budget-weekly": { type: "string" },
        "set-budget-monthly": { type: "string" },
        "health-check": { type: "boolean", default: false },
        "batch-submit": { type: "string", description: "Path to JSON file with prompts array" },
        "batch-status": { type: "string", description: "Job ID to poll" },
        "batch-list": { type: "boolean", default: false },
        "create-assets": { type: "string", description: "Path to JSON file with prompts array (orchestrator)" },
        mode: { type: "string", description: "create-assets mode: batch | sync | auto (default sync from CLI)" },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    });

    const config = loadConfig({
      ...process.env,
      ...(values["output-dir"] && values.speech
        ? { AUDIO_OUTPUT_DIR: values["output-dir"] }
        : {}),
      ...(values["output-dir"] && !values.speech
        ? { IMAGE_OUTPUT_DIR: values["output-dir"] }
        : {}),
    });

    if (values.help) {
      printHelp(config.imageOutputDir, config.audioOutputDir);
      process.exit(0);
    }

    if (values["list-providers"] !== undefined) {
      const modality = values["list-providers"];
      if (!isModality(modality)) {
        throw new Error(`--list-providers requires 'image' or 'tts', got: ${modality}`);
      }
      const entries = listDeclared(modality);
      process.stdout.write(JSON.stringify({ modality, entries }, null, 2) + "\n");
      process.exit(0);
    }

    if (values["session-spend"]) {
      const result = await sessionSpend();
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values.regenerate) {
      const result = await regenerate(
        { path: values.regenerate, outputPath: values.output },
        config,
      );
      process.stdout.write(JSON.stringify(result) + "\n");
      process.exit(0);
    }

    if (values["estimate-cost"]) {
      const modality = values.speech ? "tts" : "image";
      const result = estimateCostDryRun({
        modality,
        text: modality === "tts" ? values.prompt : undefined,
        provider: values.provider as ProviderId | undefined,
        tier: values.tier as Tier | undefined,
      });
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values["health-check"]) {
      const result = await healthCheck(config);
      process.stdout.write(result.text + "\n");
      process.exit(result.ok ? 0 : 1);
    }

    if (values["batch-list"]) {
      const result = await batchStatus({ list: true }, config);
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values["batch-status"]) {
      const result = await batchStatus({ jobId: values["batch-status"] }, config);
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values["batch-submit"]) {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(values["batch-submit"], "utf8");
      const parsed = JSON.parse(raw) as {
        modality: "image" | "tts";
        prompts: Array<{ text: string; voice?: string }>;
        provider?: ProviderId;
        tier?: Tier;
        model?: string;
      };
      const result = await batchSubmit(parsed, config);
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values["create-assets"]) {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(values["create-assets"], "utf8");
      const parsed = JSON.parse(raw) as {
        modality: "image" | "tts";
        prompts: Array<{ text: string; voice?: string }>;
        provider?: ProviderId;
        tier?: Tier;
        model?: string;
      };
      const mode = (values.mode ?? "sync") as CreateAssetsMode;
      if (mode !== "batch" && mode !== "sync" && mode !== "auto") {
        throw new Error(`Invalid --mode: ${values.mode} (use batch | sync | auto)`);
      }
      const result = await createAssets({ ...parsed, mode }, config);
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (
      values["set-budget-daily"] !== undefined ||
      values["set-budget-weekly"] !== undefined ||
      values["set-budget-monthly"] !== undefined
    ) {
      const parseCap = (v: string | undefined): number | null | undefined => {
        if (v === undefined) return undefined;
        if (v === "null" || v === "none" || v === "off") return null;
        const n = Number(v);
        if (Number.isNaN(n)) throw new Error(`Invalid budget value: ${v}`);
        return n;
      };
      const result = await setBudget({
        daily: parseCap(values["set-budget-daily"]),
        weekly: parseCap(values["set-budget-weekly"]),
        monthly: parseCap(values["set-budget-monthly"]),
      });
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (!values.prompt) {
      printHelp(config.imageOutputDir, config.audioOutputDir);
      process.exit(1);
    }

    if (values.provider !== undefined && !isProvider(values.provider)) {
      throw new Error(`Invalid --provider: ${values.provider}`);
    }
    if (values.tier !== undefined && !isTier(values.tier)) {
      throw new Error(`Invalid --tier: ${values.tier}`);
    }

    const result = values.speech
      ? await generateSpeech(
          {
            text: values.prompt,
            provider: values.provider as ProviderId | undefined,
            tier: values.tier as Tier | undefined,
            model: values.model,
            voice: values.voice,
            outputPath: values.output,
          },
          config,
        )
      : await generateImage(
          {
            prompt: values.prompt,
            provider: values.provider as ProviderId | undefined,
            tier: values.tier as Tier | undefined,
            model: values.model,
            outputPath: values.output,
          },
          config,
        );

    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    const structured = asStructuredError(err, "GENERATION_ERROR");
    process.stdout.write(JSON.stringify(structured.toJSON()) + "\n");
    process.exit(1);
  }
}

main();
