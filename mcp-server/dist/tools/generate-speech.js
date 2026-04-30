import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { buildCacheKey } from "../cache/key.js";
import { lookupCache, storeInCache } from "../cache/store.js";
import { chunkText } from "../chunker/tts.js";
import { writeCaptionFiles } from "../post/captions.js";
import { audioMimeForPath, concatAudioFiles, copyAudioRespectingPath, saveAudioRespectingPath, } from "../post/concat.js";
import { autoPlay } from "../post/play.js";
import { estimateCost, tryEstimateCost, unknownCostEstimate } from "../pricing/load.js";
import { createTtsProvider, getDefaultProvider, getDefaultTier, resolveSlot, } from "../providers/registry.js";
import { readLineageFromParent, writeSidecar } from "../sidecar/metadata.js";
import { checkBudget, formatBudgetBlockError } from "../state/budget.js";
import { appendCall } from "../state/store.js";
import { summarize } from "../state/spend.js";
import { readVoicePresets } from "../presets/store.js";
import { isStructuredError, mapProviderError, StructuredError } from "../util/errors.js";
import { withFailover } from "../util/failover.js";
import { buildOutputPath, slugify, timestamp } from "../util/output.js";
function inlineSlot(provider, tier, model) {
    try {
        const registered = resolveSlot({ provider, modality: "tts", tier });
        if (registered.model === model)
            return registered;
    }
    catch {
        // (provider, tts, tier) isn't registered — fall through.
    }
    return {
        provider,
        modality: "tts",
        tier,
        model,
        batchable: false,
        params: {},
        voices: [],
        defaultVoice: undefined,
        customVoicesAllowed: true,
        maxCharsPerCall: undefined,
    };
}
function roundUsd(n) {
    return Math.round(n * 1_000_000) / 1_000_000;
}
export async function generateSpeech(args, config, opts = {}) {
    if (!args.text || args.text.trim().length === 0) {
        throw new StructuredError("VALIDATION_ERROR", "text is required", "Pass non-empty text.");
    }
    let presetProvider;
    let presetTier;
    let presetModel;
    let presetVoice;
    if (args.voicePreset) {
        const presets = await readVoicePresets();
        const preset = presets[args.voicePreset];
        if (!preset) {
            throw new StructuredError("NOT_FOUND", `Voice preset "${args.voicePreset}" not found`, "Run list_presets to see what's saved, or save_voice_preset to create it.");
        }
        presetProvider = preset.provider;
        presetTier = preset.tier;
        presetModel = preset.model;
        presetVoice = preset.voice;
    }
    const requestedProvider = args.provider ?? presetProvider ?? getDefaultProvider("tts");
    const tier = args.tier ?? presetTier ?? getDefaultTier();
    const explicitModel = args.model ?? presetModel;
    let providerUsed = requestedProvider;
    let slot = explicitModel
        ? inlineSlot(requestedProvider, tier, explicitModel)
        : resolveSlot({ provider: requestedProvider, modality: "tts", tier });
    // Resolve voice with this precedence: explicit args.voice → voicePreset →
    // <PROVIDER>_DEFAULT_VOICE env for the resolved slot's provider (only if
    // valid for that slot's voice list) → slot.defaultVoice. Applied at every
    // slot-resolution point (initial, per-chunk, per-failover-attempt) so the
    // per-provider env default flows through provider swaps and chunked
    // retries. Each provider's env var is scoped so names don't collide across
    // naming conventions (Gemini's "Charon" ≠ OpenAI's "onyx" ≠ ElevenLabs IDs).
    const providerDefaultVoice = (forProvider) => {
        switch (forProvider) {
            case "google":
                return config.geminiDefaultVoice;
            case "openai":
                return config.openaiDefaultVoice;
            case "elevenlabs":
                return config.elevenlabsDefaultVoice;
            case "local":
                return config.localDefaultVoice;
            case "voicebox":
                return config.voiceboxDefaultVoice;
            case "openrouter":
                // OpenRouter doesn't implement TTS — no default voice axis needed.
                return undefined;
        }
    };
    const resolveVoice = (forSlot) => {
        const envCandidate = providerDefaultVoice(forSlot.provider);
        // Accept env default when either: (a) the name is in the slot's known
        // voice list (prevents cross-provider leaks — Gemini's "Charon" can't
        // accidentally go to OpenAI), or (b) the slot allows custom voices
        // (ElevenLabs voice IDs, local backend voices — no known list to
        // validate against, so trust the caller's env value).
        const envMatch = envCandidate &&
            (forSlot.voices.includes(envCandidate) || forSlot.customVoicesAllowed)
            ? envCandidate
            : undefined;
        return args.voice ?? presetVoice ?? envMatch ?? forSlot.defaultVoice;
    };
    let voice = resolveVoice(slot);
    if (voice &&
        slot.voices.length > 0 &&
        !slot.customVoicesAllowed &&
        !slot.voices.includes(voice)) {
        throw new StructuredError("VALIDATION_ERROR", `voice "${voice}" not supported by ${requestedProvider}/${tier} (${slot.model}). Available: ${slot.voices.join(", ")}.`, `Pick from the listed voices, or omit --voice to use ${slot.defaultVoice ?? "the default"}.`);
    }
    let referenceAudio;
    let referenceAudioHash;
    if (args.referenceAudioPath) {
        if (requestedProvider !== "local") {
            throw new StructuredError("VALIDATION_ERROR", `referenceAudio (voice cloning) is only supported on provider=local (Chatterbox-TTS / XTTS-style servers). Got provider=${requestedProvider}.`, requestedProvider === "elevenlabs"
                ? "For ElevenLabs cloning, create the voice at elevenlabs.io/voice-lab and pass its voice ID via --voice <id>."
                : "Switch to --provider local and run a cloning-capable backend (Chatterbox-TTS or Coqui-TTS/XTTS).");
        }
        const absRefPath = resolve(args.referenceAudioPath);
        let bytes;
        try {
            bytes = await readFile(absRefPath);
        }
        catch (err) {
            throw new StructuredError("VALIDATION_ERROR", `Failed to read referenceAudio at ${absRefPath}: ${err.message}`, "Pass an existing .wav/.mp3 path. Chatterbox-TTS prefers ~5s of clean speech.");
        }
        const ext = extname(absRefPath).slice(1).toLowerCase();
        referenceAudio = {
            data: bytes,
            mimeType: ext === "mp3" ? "audio/mpeg" : `audio/${ext || "wav"}`,
            path: absRefPath,
        };
        referenceAudioHash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    }
    // Include a fingerprint of the reference audio in params so cache correctly
    // differentiates calls with the same text+voice but different reference.
    // Also include the per-chunk limit when explicitly overridden, since
    // different chunk boundaries produce subtly different prosody at the seams
    // (the stitched output is not byte-identical across chunk sizes).
    const cacheParams = { ...slot.params };
    if (referenceAudioHash)
        cacheParams.referenceAudio = referenceAudioHash;
    if (args.maxCharsPerChunk !== undefined) {
        cacheParams.maxCharsPerChunk = args.maxCharsPerChunk;
    }
    const cacheKey = buildCacheKey({
        provider: requestedProvider,
        model: slot.model,
        modality: "tts",
        text: args.text,
        voice,
        params: cacheParams,
    });
    const cached = await lookupCache(cacheKey);
    let budgetWarning = null;
    if (!cached) {
        const projectedCost = tryEstimateCost({ provider: requestedProvider, model: slot.model, modality: "tts", params: slot.params }, args.text.length) ?? { total: 0 };
        const check = await checkBudget(projectedCost.total);
        if (check.block) {
            throw new StructuredError("BUDGET_EXCEEDED", formatBudgetBlockError(check.block), `Raise the cap with set_budget --daily ${(check.block.cap * 2).toFixed(2)}, switch to a cheaper tier, or wait for the period to reset.`);
        }
        budgetWarning = check.warning;
    }
    // Definite-assignment assertions: these are always written on every branch
    // (including the INPUT_TOO_LONG → runChunked recovery path), but TS's
    // definite-assignment analysis doesn't follow closure calls.
    let mimeType;
    let modelUsed;
    let filePath;
    let failover = null;
    let chunkFiles;
    let chunkCount = 1;
    let alignment;
    const captionsMode = args.captions ?? "none";
    // Decide whether to chunk: only when not cached, not explicit-model, and a
    // per-chunk limit is set + exceeded. Caller's args.maxCharsPerChunk wins
    // over the slot's default — useful when a TTS engine produces poor prosody
    // on long inputs (typical for neural local models past ~300 chars).
    if (args.maxCharsPerChunk !== undefined && args.maxCharsPerChunk <= 0) {
        throw new StructuredError("VALIDATION_ERROR", "maxCharsPerChunk must be > 0", "Pass a positive integer (e.g. 300 for high-quality neural TTS, or omit to use the provider default).");
    }
    const limit = args.maxCharsPerChunk ?? slot.maxCharsPerCall;
    const needsChunking = !cached && !explicitModel && limit !== undefined && args.text.length > limit;
    // Chunked path — invoked pre-emptively when text > maxCharsPerCall, OR as
    // recovery when the single-call path throws INPUT_TOO_LONG. Mutates the
    // outer let vars (providerUsed, slot, voice, mimeType, modelUsed, filePath,
    // chunkFiles, chunkCount). Alignment is intentionally not set: captions for
    // multi-chunk TTS aren't supported yet (see captionsSkipped below).
    const runChunked = async (chunkLimit) => {
        const chunks = chunkText(args.text, chunkLimit);
        chunkCount = chunks.length;
        // Generate each chunk via failover-aware path. When cloning is requested,
        // pin failover to the requested provider so fallback doesn't silently drop
        // the reference audio (only `local` supports it).
        const chunkResults = await Promise.all(chunks.map((c) => withFailover({
            modality: "tts",
            tier,
            preferredProvider: requestedProvider,
            pinToPreferred: !!referenceAudio,
            config,
            callProvider: async (resolvedSlot, attemptProviderId) => {
                const provider = createTtsProvider(attemptProviderId, config);
                return await provider.generateSpeech({
                    text: c.text,
                    model: resolvedSlot.model,
                    voice: resolveVoice(resolvedSlot),
                    params: resolvedSlot.params,
                    referenceAudio,
                });
            },
        })));
        // All chunks must use the same provider/model — pick from first.
        const first = chunkResults[0];
        providerUsed = first.providerUsed;
        slot = first.slot;
        voice = resolveVoice(slot);
        mimeType = first.result.mimeType;
        modelUsed = first.result.modelUsed;
        // Save each chunk file. Resolve chunk dir to absolute so ffmpeg's concat
        // demuxer (which resolves relative paths against the listfile's directory)
        // can find them later.
        const baseStem = `${timestamp()}-${slugify(args.text)}`;
        const ext = mimeType.split("/")[1] === "mpeg" ? "mp3" : mimeType.split("/")[1] ?? "bin";
        const chunksDir = resolve(args.outputDir ?? config.audioOutputDir, ".chunks");
        await mkdir(chunksDir, { recursive: true });
        chunkFiles = [];
        for (let i = 0; i < chunkResults.length; i++) {
            const chunkPath = join(chunksDir, `${baseStem}-chunk-${i + 1}.${ext}`);
            await writeFile(chunkPath, chunkResults[i].result.data);
            chunkFiles.push(chunkPath);
        }
        filePath = buildOutputPath({
            prompt: args.text,
            mimeType,
            outputDir: args.outputDir ?? config.audioOutputDir,
            explicitPath: args.outputPath,
        });
        // concatAudioFiles picks codec from the output extension, so a mixed-format
        // concat (wav chunks → mp3 final) works in a single ffmpeg pass. If the
        // user asked for a format different from the provider's native output, the
        // final mime needs to reflect what's actually on disk.
        await concatAudioFiles(chunkFiles, filePath);
        mimeType = audioMimeForPath(filePath);
        await storeInCache(cacheKey, filePath, {
            mimeType,
            modelKey: `${providerUsed}/${modelUsed}`,
        });
    };
    // Fallback chunk limit when a single-call path hits INPUT_TOO_LONG but the
    // slot didn't declare maxCharsPerCall (e.g. explicit --model, or a new slot).
    const fallbackChunkLimit = () => limit ?? Math.max(1000, Math.floor(args.text.length / 2));
    if (cached) {
        modelUsed = slot.model;
        filePath = buildOutputPath({
            prompt: args.text,
            mimeType: cached.meta.mimeType,
            outputDir: args.outputDir ?? config.audioOutputDir,
            explicitPath: args.outputPath,
        });
        const placed = await copyAudioRespectingPath(cached.filePath, filePath, cached.meta.mimeType);
        mimeType = placed.mimeType;
    }
    else if (needsChunking) {
        await runChunked(limit);
    }
    else if (explicitModel) {
        const provider = createTtsProvider(requestedProvider, config);
        try {
            const result = await provider.generateSpeech({
                text: args.text,
                model: slot.model,
                voice,
                params: slot.params,
                wantTimestamps: captionsMode !== "none",
                referenceAudio,
            });
            modelUsed = result.modelUsed;
            alignment = result.alignment;
            filePath = buildOutputPath({
                prompt: args.text,
                mimeType: result.mimeType,
                outputDir: args.outputDir ?? config.audioOutputDir,
                explicitPath: args.outputPath,
            });
            const placed = await saveAudioRespectingPath(result.data, filePath, result.mimeType);
            mimeType = placed.mimeType;
            await storeInCache(cacheKey, filePath, {
                mimeType,
                modelKey: `${requestedProvider}/${modelUsed}`,
            });
        }
        catch (err) {
            const mapped = isStructuredError(err) ? err : mapProviderError(err, requestedProvider);
            if (mapped.code === "INPUT_TOO_LONG") {
                await runChunked(fallbackChunkLimit());
            }
            else {
                throw mapped;
            }
        }
    }
    else {
        try {
            const fallbackResult = await withFailover({
                modality: "tts",
                tier,
                preferredProvider: requestedProvider,
                pinToPreferred: !!referenceAudio,
                config,
                callProvider: async (resolvedSlot, attemptProviderId) => {
                    const provider = createTtsProvider(attemptProviderId, config);
                    const attemptVoice = resolveVoice(resolvedSlot);
                    return await provider.generateSpeech({
                        text: args.text,
                        model: resolvedSlot.model,
                        voice: attemptVoice,
                        params: resolvedSlot.params,
                        wantTimestamps: captionsMode !== "none",
                        referenceAudio,
                    });
                },
            });
            providerUsed = fallbackResult.providerUsed;
            slot = fallbackResult.slot;
            voice = resolveVoice(slot);
            modelUsed = fallbackResult.result.modelUsed;
            alignment = fallbackResult.result.alignment;
            filePath = buildOutputPath({
                prompt: args.text,
                mimeType: fallbackResult.result.mimeType,
                outputDir: args.outputDir ?? config.audioOutputDir,
                explicitPath: args.outputPath,
            });
            const placed = await saveAudioRespectingPath(fallbackResult.result.data, filePath, fallbackResult.result.mimeType);
            mimeType = placed.mimeType;
            await storeInCache(cacheKey, filePath, {
                mimeType,
                modelKey: `${providerUsed}/${modelUsed}`,
            });
            if (fallbackResult.failover) {
                const originalCost = (() => {
                    try {
                        return estimateCost({
                            provider: fallbackResult.failover.originalProvider,
                            model: fallbackResult.failover.originalModel,
                            modality: "tts",
                            params: {},
                        }, args.text.length).total;
                    }
                    catch {
                        return 0;
                    }
                })();
                const newCost = estimateCost({ provider: providerUsed, model: modelUsed, modality: "tts", params: slot.params }, args.text.length);
                failover = {
                    originalProvider: fallbackResult.failover.originalProvider,
                    originalModel: fallbackResult.failover.originalModel,
                    originalError: fallbackResult.failover.originalError,
                    fallbackProvider: providerUsed,
                    fallbackModel: modelUsed,
                    costDelta: roundUsd(newCost.total - originalCost),
                    currency: newCost.currency,
                };
            }
        }
        catch (err) {
            if (isStructuredError(err) && err.code === "INPUT_TOO_LONG") {
                await runChunked(fallbackChunkLimit());
            }
            else {
                throw err;
            }
        }
    }
    const charCount = args.text.length;
    const costQuery = {
        provider: providerUsed,
        model: modelUsed,
        modality: "tts",
        params: slot.params,
    };
    const cost = tryEstimateCost(costQuery, charCount) ?? unknownCostEstimate(costQuery, charCount);
    const isCached = cached !== null;
    const chargedCost = isCached ? 0 : cost.total;
    const entry = {
        ts: new Date().toISOString(),
        tool: "generate_speech",
        provider: providerUsed,
        model: modelUsed,
        tier,
        modality: "tts",
        units: charCount,
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
            tool: "generate_speech",
            modality: "tts",
            provider: providerUsed,
            model: modelUsed,
            tier,
            params: slot.params,
            input: {
                text: args.text,
                voice,
                ...(referenceAudio?.path ? { referenceAudioPath: referenceAudio.path } : {}),
            },
            output: { files: [filePath], mimeType },
            cost: { ...cost, total: chargedCost },
            lineage,
            cached: isCached,
        });
    }
    if (config.autoplay) {
        autoPlay(filePath);
    }
    let captions;
    let captionsSkipped;
    if (captionsMode !== "none") {
        if (chunkCount > 1) {
            captionsSkipped =
                "Captions skipped: chunked TTS (multi-chunk timestamp offsets are not yet supported in v1).";
        }
        else if (!alignment || alignment.length === 0) {
            captionsSkipped = `Captions skipped: ${providerUsed} did not return word alignment for this call.`;
        }
        else {
            const formats = captionsMode === "both" ? ["srt", "vtt"] : [captionsMode];
            captions = await writeCaptionFiles(filePath, alignment, formats);
        }
    }
    return {
        success: true,
        files: [filePath],
        providerUsed,
        modelUsed,
        tier,
        voiceUsed: voice,
        voiceDefaulted: !args.voice && !presetVoice,
        mimeType,
        cost: { ...cost, total: chargedCost },
        sessionTotal: {
            today: summary.totals.today,
            allTime: summary.totals.allTime,
            currency: session.currency,
        },
        sidecar: sidecarPath,
        cached: isCached,
        budgetWarning,
        failover,
        chunkCount,
        ...(args.debug && chunkFiles ? { chunkFiles } : {}),
        captions,
        captionsSkipped,
    };
}
