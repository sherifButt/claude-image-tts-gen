import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { buildCacheKey } from "../cache/key.js";
import { copyFromCache, lookupCache, storeInCache } from "../cache/store.js";
import type { Config } from "../config.js";
import { mediaDurationSeconds } from "../post/thumbnail.js";
import { tryEstimateCost, unknownCostEstimate } from "../pricing/load.js";
import type { CostEstimate } from "../pricing/types.js";
import {
  avatarRate,
  createAvatarProvider,
  DEFAULT_AVATAR_TIER,
  resolveAvatarSlot,
} from "../providers/registry.js";
import type {
  AvatarTier,
  AvatarTierInput,
  ProviderId,
  ReferenceAudio,
  ReferenceImage,
} from "../providers/types.js";
import { readLineageFromParent, writeSidecar } from "../sidecar/metadata.js";
import { checkBudget, formatBudgetBlockError } from "../state/budget.js";
import { appendCall } from "../state/store.js";
import { summarize } from "../state/spend.js";
import type { BudgetWarning, CallEntry, PeriodTotal } from "../state/types.js";
import { mapProviderError, StructuredError } from "../util/errors.js";
import { buildOutputPath, saveBinary } from "../util/output.js";

const DEFAULT_PROVIDER: ProviderId = "replicate";

/** p-video is a general video model with audio conditioning, so it needs a
 *  motion prompt even though the audio drives the lip-sync. */
const DEFAULT_AVATAR_PROMPT = "The person speaks, moving their hands naturally.";

export interface GenerateAvatarArgs {
  /** Avatar / person image to lip-sync (jpg/png). Required. */
  imagePath: string;
  /** Speech audio the mouth is synced to (mp3/wav/m4a/aac). Required. */
  audioPath: string;
  provider?: ProviderId;
  tier?: AvatarTierInput;
  /** Motion prompt for the p-video tiers (draft/low/normal). Ignored by
   *  high/ultra, which run Fabric — there the audio alone drives the shot. */
  prompt?: string;
  model?: string;
  outputPath?: string;
  outputDir?: string;
  sidecar?: boolean;
}

export interface GenerateAvatarOutput {
  success: true;
  files: string[];
  providerUsed: ProviderId;
  modelUsed: string;
  tier: AvatarTier;
  mimeType: string;
  durationSeconds: number;
  isAvatar: true;
  cost: CostEstimate;
  sessionTotal: {
    today: PeriodTotal;
    allTime: PeriodTotal;
    currency: string;
  };
  sidecar: string;
  cached: boolean;
  budgetWarning: BudgetWarning | null;
}

export interface GenerateAvatarOpts {
  parentSidecar?: string;
}

function imageMime(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

function audioMime(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "mp3";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  if (ext === "aac") return "audio/aac";
  if (ext === "ogg" || ext === "opus") return "audio/ogg";
  if (ext === "flac") return "audio/flac";
  return "audio/mpeg";
}

export async function generateAvatar(
  args: GenerateAvatarArgs,
  config: Config,
  opts: GenerateAvatarOpts = {},
): Promise<GenerateAvatarOutput> {
  if (!args.imagePath) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "imagePath is required — a talking avatar needs a face/person image",
      "Pass an avatar image via imagePath (CLI: --image). Generate one with generate_image first.",
    );
  }
  if (!args.audioPath) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "audioPath is required — the avatar is lip-synced to this speech audio",
      "Pass a speech file via audioPath (CLI: --audio). Generate one with generate_speech first.",
    );
  }
  if (!existsSync(args.imagePath)) {
    throw new StructuredError("NOT_FOUND", `Image not found: ${args.imagePath}`, "Pass an existing image path.");
  }
  if (!existsSync(args.audioPath)) {
    throw new StructuredError("NOT_FOUND", `Audio not found: ${args.audioPath}`, "Pass an existing audio path.");
  }

  const requestedProvider = args.provider ?? DEFAULT_PROVIDER;
  const requestedTier = args.tier ?? DEFAULT_AVATAR_TIER;

  // Output length = audio duration; cost = duration × per-second rate. We must
  // know the duration to price + budget-guard this (it can be expensive), so
  // ffprobe is required here.
  const duration = await mediaDurationSeconds(args.audioPath);
  if (duration === null) {
    throw new StructuredError(
      "PROVIDER_ERROR",
      "Could not read the audio duration (ffprobe unavailable or unreadable file)",
      "Talking-avatar cost is billed per second of output, so the audio length is needed to price it and enforce your budget. Install ffmpeg (macOS: `brew install ffmpeg`) or pass a readable mp3/wav/m4a/aac.",
    );
  }
  const durationSeconds = Math.round(duration * 10) / 10;

  const resolved = resolveAvatarSlot(requestedTier);
  const tier = resolved.tier;
  const slot = args.model
    ? { ...resolved, model: args.model, params: {} as Record<string, unknown> }
    : resolved;
  const modelId = slot.model;
  const prompt = slot.needsPrompt ? (args.prompt?.trim() || DEFAULT_AVATAR_PROMPT) : undefined;

  // The p-video tiers silently truncate past their cap: the prediction comes
  // back `succeeded` with a short clip and no warning, so a caller would only
  // notice by watching the output. Refuse before spending instead, and price
  // the alternatives from the real duration so the choice is concrete.
  const cap = slot.maxAudioSeconds;
  if (cap !== null && durationSeconds > cap) {
    const priced = (t: AvatarTier) => `$${(durationSeconds * avatarRate(t)).toFixed(2)}`;
    throw new StructuredError(
      "VALIDATION_ERROR",
      `audio is ${durationSeconds}s; tier "${tier}" caps at ${cap}s and would silently return only the first ${cap}s`,
      [
        `Use tier high (Fabric 480p, no cap): ${priced("high")}.`,
        `Use tier ultra (Fabric 720p, no cap): ${priced("ultra")}.`,
        `Or supply audio of ${cap}s or less at tier "${tier}" — split the script at sentence boundaries and generate one clip per segment (see the avatar-generation skill for shot variation across cuts).`,
      ].join(" "),
    );
  }

  const image: ReferenceImage = {
    data: await readFile(args.imagePath),
    mimeType: imageMime(args.imagePath),
    path: args.imagePath,
  };
  const audio: ReferenceAudio = {
    data: await readFile(args.audioPath),
    mimeType: audioMime(args.audioPath),
    path: args.audioPath,
  };

  const costQuery = {
    provider: requestedProvider,
    model: modelId,
    modality: "video" as const,
    params: slot.params,
  };

  const cacheKey = buildCacheKey({
    provider: requestedProvider,
    model: modelId,
    modality: "video",
    // Empty on Fabric (audio alone drives it); the motion prompt on p-video.
    text: prompt ?? "",
    params: {
      ...slot.params,
      image: args.imagePath,
      audio: args.audioPath,
      duration: durationSeconds,
    },
  });
  const cached = await lookupCache(cacheKey);

  let budgetWarning: BudgetWarning | null = null;
  if (!cached) {
    const projected = tryEstimateCost(costQuery, durationSeconds) ?? { total: 0 };
    const check = await checkBudget(projected.total);
    if (check.block) {
      throw new StructuredError(
        "BUDGET_EXCEEDED",
        formatBudgetBlockError(check.block),
        `A ${durationSeconds}s clip at tier "${tier}" costs ~$${projected.total.toFixed(2)}. Raise the cap with set_budget --daily ${(check.block.cap * 2).toFixed(2)}, drop to --tier draft (~$${(durationSeconds * avatarRate("draft")).toFixed(2)}, preview quality), shorten the audio, or wait for the period to reset.`,
      );
    }
    budgetWarning = check.warning;
  }

  let mimeType: string;
  let modelUsed: string;
  let filePath: string;

  if (cached) {
    mimeType = cached.meta.mimeType;
    modelUsed = modelId;
    filePath = buildOutputPath({
      prompt: `avatar-${args.imagePath.split("/").pop() ?? "clip"}`,
      mimeType,
      outputDir: args.outputDir ?? config.videoOutputDir,
      explicitPath: args.outputPath,
    });
    await copyFromCache(cached, filePath);
  } else {
    const provider = createAvatarProvider(requestedProvider, config);
    let result;
    try {
      result = await provider.generateAvatar({
        model: modelId,
        image,
        audio,
        prompt,
        params: slot.params,
        durationSeconds,
      });
    } catch (err) {
      throw mapProviderError(err, requestedProvider);
    }
    mimeType = result.mimeType;
    modelUsed = result.modelUsed;
    filePath = buildOutputPath({
      prompt: `avatar-${args.imagePath.split("/").pop() ?? "clip"}`,
      mimeType,
      outputDir: args.outputDir ?? config.videoOutputDir,
      explicitPath: args.outputPath,
    });
    await saveBinary(filePath, result.data);
    await storeInCache(cacheKey, filePath, {
      mimeType,
      modelKey: `${requestedProvider}/${modelUsed}`,
    });
  }

  const cost = tryEstimateCost(costQuery, durationSeconds) ?? unknownCostEstimate(costQuery, durationSeconds);
  const isCached = cached !== null;
  const chargedCost = isCached ? 0 : cost.total;

  const entry: CallEntry = {
    ts: new Date().toISOString(),
    tool: "generate_avatar",
    provider: requestedProvider,
    model: modelUsed,
    tier,
    modality: "video",
    units: durationSeconds,
    unit: cost.unit,
    pricePerUnit: cost.pricePerUnit,
    isBatchPrice: cost.isBatchPrice,
    cost: chargedCost,
    files: [filePath],
    cached: isCached,
  };
  const session = await appendCall(entry);
  const summary = summarize(session);

  const shouldEmitSidecar = args.sidecar ?? config.emitSidecar;
  let sidecarPath = "";
  if (shouldEmitSidecar) {
    const lineage = await readLineageFromParent(opts.parentSidecar);
    sidecarPath = await writeSidecar(filePath, {
      version: 1,
      createdAt: entry.ts,
      tool: "generate_avatar",
      modality: "video",
      provider: requestedProvider,
      model: modelUsed,
      tier,
      params: slot.params,
      input: {
        imagePath: args.imagePath,
        audioPath: args.audioPath,
        durationSeconds,
        ...(prompt ? { prompt } : {}),
      },
      output: { files: [filePath], mimeType },
      cost: { ...cost, total: chargedCost },
      lineage,
      cached: isCached,
    });
  }

  return {
    success: true,
    files: [filePath],
    providerUsed: requestedProvider,
    modelUsed,
    tier,
    mimeType,
    durationSeconds,
    isAvatar: true,
    cost: { ...cost, total: chargedCost },
    sessionTotal: {
      today: summary.totals.today,
      allTime: summary.totals.allTime,
      currency: session.currency,
    },
    sidecar: sidecarPath,
    cached: isCached,
    budgetWarning,
  };
}
