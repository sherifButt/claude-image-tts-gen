import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { buildCacheKey } from "../cache/key.js";
import { copyFromCache, lookupCache, storeInCache } from "../cache/store.js";
import { tryEstimateCost, unknownCostEstimate } from "../pricing/load.js";
import { createVideoProvider, getDefaultProvider, getDefaultTier, resolveSlot, } from "../providers/registry.js";
import { readLineageFromParent, writeSidecar } from "../sidecar/metadata.js";
import { checkBudget, formatBudgetBlockError } from "../state/budget.js";
import { appendCall } from "../state/store.js";
import { summarize } from "../state/spend.js";
import { mapProviderError, StructuredError } from "../util/errors.js";
import { buildOutputPath, saveBinary } from "../util/output.js";
/** grok-imagine-video-1.5 supports these ratios (no 21:9); omit for "auto". */
const VIDEO_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const DEFAULT_DURATION_SECONDS = 5;
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 15;
function inlineSlot(provider, tier, model) {
    try {
        const registered = resolveSlot({ provider, modality: "video", tier });
        if (registered.model === model)
            return registered;
    }
    catch {
        // (provider, video, tier) isn't registered — fall through to a bare slot.
    }
    return {
        provider,
        modality: "video",
        tier,
        model,
        batchable: false,
        params: {},
        voices: [],
        defaultVoice: undefined,
        customVoicesAllowed: false,
        maxCharsPerCall: undefined,
    };
}
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
    if (!args.imagePath) {
        throw new StructuredError("VALIDATION_ERROR", "imagePath is required — grok-imagine-video-1.5 is image-to-video only", "Pass an input frame via imagePath (CLI: --image). Generate one with generate_image first if you don't have one.");
    }
    const duration = args.duration ?? DEFAULT_DURATION_SECONDS;
    if (!Number.isFinite(duration) || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
        throw new StructuredError("VALIDATION_ERROR", `duration must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds (got ${duration})`, `Pass a duration in [${MIN_DURATION_SECONDS}, ${MAX_DURATION_SECONDS}].`);
    }
    if (args.aspectRatio !== undefined &&
        !VIDEO_ASPECT_RATIOS.includes(args.aspectRatio)) {
        throw new StructuredError("VALIDATION_ERROR", `Unsupported aspectRatio for video: ${String(args.aspectRatio)}`, `Use one of ${VIDEO_ASPECT_RATIOS.join(", ")}, or omit for auto.`);
    }
    const aspectRatio = args.aspectRatio;
    const requestedProvider = args.provider ?? getDefaultProvider("video");
    const tier = args.tier ?? getDefaultTier();
    const explicitModel = args.model;
    // Load the primary input frame + any extra references.
    const refPaths = [args.imagePath, ...(args.referenceImagePaths ?? [])];
    const referenceImages = [];
    for (const path of refPaths) {
        if (!existsSync(path)) {
            throw new StructuredError("NOT_FOUND", `Input image not found: ${path}`, "Pass an existing image file path.");
        }
        referenceImages.push({ data: await readFile(path), mimeType: mimeForImage(path), path });
    }
    const [primaryImage, ...extraImages] = referenceImages;
    const slot = explicitModel
        ? inlineSlot(requestedProvider, tier, explicitModel)
        : resolveSlot({ provider: requestedProvider, modality: "video", tier });
    const cacheKey = buildCacheKey({
        provider: requestedProvider,
        model: slot.model,
        modality: "video",
        text: args.prompt,
        params: {
            ...slot.params,
            duration,
            ...(aspectRatio ? { aspectRatio } : {}),
            image: primaryImage.path ?? "buffer",
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
            throw new StructuredError("BUDGET_EXCEEDED", formatBudgetBlockError(check.block), `Raise the cap with set_budget --daily ${(check.block.cap * 2).toFixed(2)}, shorten --duration, drop to --tier small (480p), or wait for the period to reset.`);
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
                imagePath: primaryImage.path ?? args.imagePath,
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
