import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import {
  getDefaultProvider,
  getDefaultTier,
  listDeclared,
} from "./providers/registry.js";
import { batchStatus } from "./tools/batch-status.js";
import { batchSubmit } from "./tools/batch-submit.js";
import { checkLmStudio } from "./tools/check-lmstudio.js";
import { createAssets, type CreateAssetsMode } from "./tools/create-assets.js";
import { estimateCostDryRun } from "./tools/estimate-cost.js";
import { exportSpend } from "./tools/export-spend.js";
import { generateImage } from "./tools/generate-image.js";
import { generateSpeech } from "./tools/generate-speech.js";
import { healthCheck } from "./tools/health-check.js";
import { iterate } from "./tools/iterate.js";
import { pickVariant } from "./tools/pick-variant.js";
import { postProcess } from "./tools/post-process.js";
import type { PresetName } from "./post/image-presets.js";
import {
  listPresets,
  saveStylePreset,
  saveVoicePreset,
} from "./tools/presets.js";
import { regenerate } from "./tools/regenerate.js";
import { sessionSpend } from "./tools/session-spend.js";
import { setBudget } from "./tools/set-budget.js";
import { variants } from "./tools/variants.js";
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
      --captions <mode>    TTS only: none (default) | srt | vtt | both
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
      --iterate <path>          Iterate on a prior gen (sidecar or output path)
      --adjustment <text>       Required with --iterate ("make it more dramatic")
      --variants <prompt>       Generate N variants + contact sheet
      --n <count>               Variant count (default 4)
      --pick-keeper <path>      Keeper file for pick-variant; requires --pick-variants
      --pick-variants <a,b,c>   Comma-separated variant paths
      --pick-sheet <path>       Optional contact-sheet to also trash
      --post-process <input>    Resize an image; use --presets and/or --webp
      --presets <a,b,c>         Preset list: og, twitter, favicon, app-icon, linkedin, instagram-square, instagram-story
      --webp                    Also emit .webp variants
      --webp-quality <n>        Default 85
      --style <name>            Apply saved image style preset on generation
      --reference <path>        Reference image (image-to-image edit)
      --voice-preset <name>     Apply saved TTS voice preset on speech gen
      --save-style <name>       Save a style preset (use --provider/--tier/--prefix/--suffix)
      --save-voice <name>       Save a voice preset (use --provider/--tier/--voice)
      --prefix <text>           Style prompt prefix (with --save-style)
      --suffix <text>           Style prompt suffix (with --save-style)
      --list-presets [style|voice|all]   List saved presets
  -h, --help               Show this help

Environment:
  GEMINI_API_KEY           Required for google provider
  OPENAI_API_KEY           Required for openai provider
  OPENROUTER_API_KEY       Required for openrouter provider (image only)
  ELEVENLABS_API_KEY       Required for elevenlabs provider (TTS only)
  REWRITE_PROMPTS          true (default) | false  — opt out of MCP-sampling prompt rewrite
  AUTOPLAY                 false (default) | true  — afplay TTS output (macOS)
  STATE_DIR                ~/.claude-image-tts-gen (default)
  LMSTUDIO_BASE_URL        http://localhost:1234/v1 (default)
  LMSTUDIO_ENABLED         false (default) | true  — include lmstudio in failover chain
`);
}

function isProvider(s: string | undefined): s is ProviderId {
  return (
    s === "google" ||
    s === "openai" ||
    s === "openrouter" ||
    s === "elevenlabs" ||
    s === "lmstudio"
  );
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
        captions: { type: "string", description: "TTS captions: none | srt | vtt | both" },
        output: { type: "string", short: "o" },
        "output-dir": { type: "string", short: "d" },
        speech: { type: "boolean", default: false },
        "list-providers": { type: "string" },
        "session-spend": { type: "boolean", default: false },
        "project-spend": { type: "boolean", default: false, description: "With --session-spend, scope to current project" },
        "export-spend": { type: "boolean", default: false, description: "Export ledger; pair with --month / --format" },
        month: { type: "string", description: "YYYY-MM filter for --export-spend" },
        format: { type: "string", description: "csv | json (default csv)" },
        regenerate: { type: "string", short: "R" },
        "estimate-cost": { type: "boolean", default: false },
        "set-budget-daily": { type: "string" },
        "set-budget-weekly": { type: "string" },
        "set-budget-monthly": { type: "string" },
        "health-check": { type: "boolean", default: false },
        "check-lmstudio": { type: "boolean", default: false },
        "batch-submit": { type: "string", description: "Path to JSON file with prompts array" },
        "batch-status": { type: "string", description: "Job ID to poll" },
        "batch-list": { type: "boolean", default: false },
        "create-assets": { type: "string", description: "Path to JSON file with prompts array (orchestrator)" },
        mode: { type: "string", description: "create-assets mode: batch | sync | auto (default sync from CLI)" },
        iterate: { type: "string", description: "Iterate on a prior gen: path to its sidecar/output" },
        adjustment: { type: "string", description: "Adjustment text for --iterate" },
        variants: { type: "string", description: "Generate N variants of a prompt (text)" },
        n: { type: "string", description: "Number of variants (default 4)" },
        "pick-keeper": { type: "string", description: "Keeper file for pick-variant" },
        "pick-variants": { type: "string", description: "Comma-separated variant paths for pick-variant" },
        "pick-sheet": { type: "string", description: "Optional contact-sheet path to also trash" },
        "post-process": { type: "string", description: "Path to image to post-process" },
        presets: { type: "string", description: "Comma-separated preset names" },
        webp: { type: "boolean", default: false },
        "webp-quality": { type: "string", description: "1..100, default 85" },
        style: { type: "string", description: "Apply saved style preset on image gen" },
        reference: { type: "string", description: "Reference image path (image-to-image)" },
        "voice-preset": { type: "string", description: "Apply saved voice preset on TTS" },
        "save-style": { type: "string", description: "Save image style preset (name); --provider/--tier/--prefix/--suffix" },
        "save-voice": { type: "string", description: "Save voice preset (name); --provider/--tier/--voice" },
        prefix: { type: "string", description: "Style prefix" },
        suffix: { type: "string", description: "Style suffix" },
        "list-presets": { type: "string", description: "List presets: 'style' | 'voice' | 'all'" },
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

    if (values["save-style"]) {
      const result = await saveStylePreset({
        name: values["save-style"],
        preset: {
          provider: values.provider as ProviderId | undefined,
          tier: values.tier as Tier | undefined,
          model: values.model,
          promptPrefix: values.prefix,
          promptSuffix: values.suffix,
        },
      });
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values["save-voice"]) {
      const result = await saveVoicePreset({
        name: values["save-voice"],
        preset: {
          provider: values.provider as ProviderId | undefined,
          tier: values.tier as Tier | undefined,
          model: values.model,
          voice: values.voice,
        },
      });
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values["list-presets"] !== undefined) {
      const kind = values["list-presets"] || "all";
      if (kind !== "style" && kind !== "voice" && kind !== "all") {
        throw new Error(`--list-presets must be 'style', 'voice', or 'all'`);
      }
      const result = await listPresets({ kind: kind as "style" | "voice" | "all" });
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values["export-spend"]) {
      const fmt = (values.format ?? "csv") as "csv" | "json";
      const result = await exportSpend({ month: values.month, format: fmt });
      process.stdout.write(result.text);
      process.exit(0);
    }

    if (values["session-spend"]) {
      const result = await sessionSpend({ project: values["project-spend"] });
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

    if (values["check-lmstudio"]) {
      const result = await checkLmStudio(config);
      process.stdout.write(result.text + "\n");
      process.exit(result.reachable ? 0 : 1);
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

    if (values.iterate) {
      if (!values.adjustment) {
        throw new Error("--iterate requires --adjustment <text>");
      }
      const result = await iterate(
        { path: values.iterate, adjustment: values.adjustment, outputPath: values.output },
        config,
      );
      process.stdout.write(JSON.stringify(result) + "\n");
      process.exit(0);
    }

    if (values.variants) {
      const n = values.n ? Number(values.n) : 4;
      if (Number.isNaN(n)) throw new Error(`Invalid --n: ${values.n}`);
      const result = await variants(
        {
          prompt: values.variants,
          n,
          provider: values.provider as ProviderId | undefined,
          tier: values.tier as Tier | undefined,
          model: values.model,
        },
        config,
      );
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values["post-process"]) {
      const presets = (values.presets ?? "").split(",").map((s) => s.trim()).filter(Boolean) as PresetName[];
      const quality = values["webp-quality"] ? Number(values["webp-quality"]) : undefined;
      const result = await postProcess({
        input: values["post-process"],
        presets,
        webp: values.webp,
        webpQuality: quality,
      });
      process.stdout.write(result.text + "\n");
      process.exit(0);
    }

    if (values["pick-keeper"]) {
      if (!values["pick-variants"]) {
        throw new Error("--pick-keeper requires --pick-variants <comma-separated paths>");
      }
      const variantPaths = values["pick-variants"].split(",").map((s) => s.trim()).filter(Boolean);
      const result = await pickVariant({
        keeper: values["pick-keeper"],
        variants: variantPaths,
        contactSheet: values["pick-sheet"],
      });
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

    const captions = values.captions as
      | "none"
      | "srt"
      | "vtt"
      | "both"
      | undefined;
    if (
      captions !== undefined &&
      captions !== "none" &&
      captions !== "srt" &&
      captions !== "vtt" &&
      captions !== "both"
    ) {
      throw new Error(`Invalid --captions: ${values.captions}`);
    }

    const result = values.speech
      ? await generateSpeech(
          {
            text: values.prompt,
            provider: values.provider as ProviderId | undefined,
            tier: values.tier as Tier | undefined,
            model: values.model,
            voice: values.voice,
            captions,
            voicePreset: values["voice-preset"],
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
            style: values.style,
            referenceImagePath: values.reference,
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
