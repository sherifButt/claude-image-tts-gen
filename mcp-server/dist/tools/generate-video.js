import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { buildCacheKey } from "../cache/key.js";
import { copyFromCache, lookupCache, storeInCache } from "../cache/store.js";
import { tryEstimateCost, unknownCostEstimate } from "../pricing/load.js";
import { createVideoProvider, DEFAULT_VIDEO_TIER, getDefaultProvider, resolveVideoSlot, videoRate, } from "../providers/registry.js";
import { readLineageFromParent, writeSidecar } from "../sidecar/metadata.js";
import { checkBudget, formatBudgetBlockError } from "../state/budget.js";
import { appendCall } from "../state/store.js";
import { summarize } from "../state/spend.js";
import { mapProviderError, StructuredError } from "../util/errors.js";
import { buildOutputPath, saveBinary } from "../util/output.js";
/** Both models support these ratios (no 21:9); omit for "auto". Note that
 *  p-video ignores the ratio whenever an input frame is supplied — the frame
 *  decides — so it only bites on text-to-video. */
const VIDEO_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const DEFAULT_DURATION_SECONDS = 5;
const MIN_DURATION_SECONDS = 1;
function mimeForImage(path) {
    const ext = path.toLowerCase().split(".").pop() ?? "png";
    if (ext === "jpg" || ext === "jpeg")
        return "image/jpeg";
    if (ext === "webp")
        return "image/webp";
    return "image/png";
}
export async function generateVideo(args, config, opts = {}) {
    if (!args.prompt || args.prompt.trim().length === 0) {
        throw new StructuredError("VALIDATION_ERROR", "prompt is required", "Pass a non-empty motion prompt.");
    }
    const requestedTier = args.tier ?? DEFAULT_VIDEO_TIER;
    const resolved = resolveVideoSlot(requestedTier);
    const tier = resolved.tier;
    // grok cannot start from nothing; p-video can. Rather than a blanket
    // requirement, point at the tiers that would accept the call as written.
    if (!args.imagePath && resolved.requiresImage) {
        throw new StructuredError("VALIDATION_ERROR", `tier "${tier}" runs ${resolved.model}, which is image-to-video only — imagePath is required`, "Either pass an input frame via imagePath (CLI: --image; generate one with generate_image), or use --tier draft/low/normal, which do text-to-video from the prompt alone.");
    }
    const duration = args.duration ?? DEFAULT_DURATION_SECONDS;
    const maxDuration = resolved.maxDurationSeconds;
    if (!Number.isFinite(duration) || duration < MIN_DURATION_SECONDS || duration > maxDuration) {
        const longer = ["draft", "low", "normal"].includes(tier)
            ? ""
            : ` Tiers draft/low/normal go up to 20s (and cost less per second).`;
        throw new StructuredError("VALIDATION_ERROR", `duration must be between ${MIN_DURATION_SECONDS} and ${maxDuration} seconds on tier "${tier}" (got ${duration})`, `Pass a duration in [${MIN_DURATION_SECONDS}, ${maxDuration}].${longer}`);
    }
    if (args.aspectRatio !== undefined &&
        !VIDEO_ASPECT_RATIOS.includes(args.aspectRatio)) {
        throw new StructuredError("VALIDATION_ERROR", `Unsupported aspectRatio for video: ${String(args.aspectRatio)}`, `Use one of ${VIDEO_ASPECT_RATIOS.join(", ")}, or omit for auto.`);
    }
    const aspectRatio = args.aspectRatio;
    const requestedProvider = args.provider ?? getDefaultProvider("video");
    const explicitModel = args.model;
    // Load the primary input frame + any extra references. On the p-video tiers
    // there may be no frame at all — that is text-to-video, not an error.
    const refPaths = [...(args.imagePath ? [args.imagePath] : []), ...(args.referenceImagePaths ?? [])];
    const referenceImages = [];
    for (const path of refPaths) {
        if (!existsSync(path)) {
            throw new StructuredError("NOT_FOUND", `Input image not found: ${path}`, "Pass an existing image file path.");
        }
        referenceImages.push({ data: await readFile(path), mimeType: mimeForImage(path), path });
    }
    const [primaryImage, ...extraImages] = referenceImages;
    // An explicit --model that names the SAME model this tier already resolves to
    // keeps the tier's params. Blanking them would drop resolution/draft from the
    // price key, which resolves to "unknown pricing" and books the call at $0 —
    // and `regenerate` always passes meta.model, so every re-roll would be free
    // in the ledger while billing for real. A genuinely different model gets a
    // bare slot, where unknown pricing is the honest answer.
    const slot = explicitModel && explicitModel !== resolved.model
        ? { ...resolved, model: explicitModel, params: {} }
        : resolved;
    const textToVideo = primaryImage === undefined;
    const cacheKey = buildCacheKey({
        provider: requestedProvider,
        model: slot.model,
        modality: "video",
        text: args.prompt,
        params: {
            ...slot.params,
            duration,
            ...(aspectRatio ? { aspectRatio } : {}),
            image: primaryImage?.path ?? "none",
            ...(extraImages.length > 0 ? { refs: extraImages.map((r) => r.path ?? "buffer") } : {}),
        },
    });
    const cached = await lookupCache(cacheKey);
    const costQuery = {
        provider: requestedProvider,
        model: slot.model,
        modality: "video",
        params: slot.params,
    };
    let budgetWarning = null;
    if (!cached) {
        const projectedCost = tryEstimateCost(costQuery, duration) ?? { total: 0 };
        const check = await checkBudget(projectedCost.total);
        if (check.block) {
            throw new StructuredError("BUDGET_EXCEEDED", formatBudgetBlockError(check.block), `A ${duration}s clip at tier "${tier}" costs ~$${projectedCost.total.toFixed(2)}. Raise the cap with set_budget --daily ${(check.block.cap * 2).toFixed(2)}, shorten --duration, drop to --tier draft (~$${(duration * videoRate("draft")).toFixed(2)}), or wait for the period to reset.`);
        }
        budgetWarning = check.warning;
    }
    let mimeType;
    let modelUsed;
    let filePath;
    if (cached) {
        mimeType = cached.meta.mimeType;
        modelUsed = slot.model;
        filePath = buildOutputPath({
            prompt: args.prompt,
            mimeType,
            outputDir: args.outputDir ?? config.videoOutputDir,
            explicitPath: args.outputPath,
        });
        await copyFromCache(cached, filePath);
    }
    else {
        const provider = createVideoProvider(requestedProvider, config);
        let result;
        try {
            result = await provider.generateVideo({
                prompt: args.prompt,
                model: slot.model,
                image: primaryImage,
                referenceImages: extraImages,
                params: slot.params,
                durationSeconds: duration,
                aspectRatio,
            });
        }
        catch (err) {
            throw mapProviderError(err, requestedProvider);
        }
        mimeType = result.mimeType;
        modelUsed = result.modelUsed;
        filePath = buildOutputPath({
            prompt: args.prompt,
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
    const cost = tryEstimateCost(costQuery, duration) ?? unknownCostEstimate(costQuery, duration);
    const isCached = cached !== null;
    const chargedCost = isCached ? 0 : cost.total;
    const entry = {
        ts: new Date().toISOString(),
        tool: "generate_video",
        provider: requestedProvider,
        model: modelUsed,
        tier,
        modality: "video",
        units: duration,
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
            tool: "generate_video",
            modality: "video",
            provider: requestedProvider,
            model: modelUsed,
            tier,
            params: slot.params,
            input: {
                prompt: args.prompt,
                // Omitted on a text-to-video run so `regenerate` reproduces it as
                // text-to-video rather than resurrecting a frame that was never used.
                ...(primaryImage ? { imagePath: primaryImage.path ?? args.imagePath } : {}),
                ...(extraImages.length > 0
                    ? { referenceImagePaths: extraImages.map((r) => r.path ?? "") }
                    : {}),
                durationSeconds: duration,
                ...(aspectRatio ? { aspectRatio } : {}),
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
        durationSeconds: duration,
        textToVideo,
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
