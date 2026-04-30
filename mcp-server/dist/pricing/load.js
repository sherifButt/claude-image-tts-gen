import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(readFileSync(join(HERE, "pricing.json"), "utf8"));
const STALE_THRESHOLD_DAYS = 30;
export function getPriceTable() {
    return TABLE;
}
export function makePriceKey(provider, model, params) {
    const base = `${provider}/${model}`;
    const variant = params?.quality;
    if (typeof variant === "string" && variant.length > 0) {
        return `${base}:${variant}`;
    }
    return base;
}
export function resolvePrice(query, opts = {}) {
    const key = makePriceKey(query.provider, query.model, query.params);
    const entry = TABLE.models[key];
    if (!entry) {
        throw new Error(`No pricing entry for "${key}". Add it to mcp-server/src/pricing/pricing.json and rebuild.`);
    }
    if (entry.modality !== query.modality) {
        throw new Error(`Pricing entry "${key}" has modality "${entry.modality}", expected "${query.modality}".`);
    }
    const wantBatch = opts.useBatch === true;
    const pricePerUnit = wantBatch && entry.pricing.batch !== undefined
        ? entry.pricing.batch
        : entry.pricing.standard;
    const isBatchPrice = wantBatch && entry.pricing.batch !== undefined && entry.pricing.batch !== entry.pricing.standard;
    return {
        key,
        unit: entry.pricing.type,
        pricePerUnit,
        isBatchPrice,
        modality: entry.modality,
        notes: entry.notes,
    };
}
/** Like estimateCost but returns null on missing pricing entries instead of throwing. */
export function tryEstimateCost(query, units, opts = {}) {
    try {
        return estimateCost(query, units, opts);
    }
    catch {
        return null;
    }
}
/** Synthesises a cost estimate when pricing is unknown (e.g. explicit --model override). */
export function unknownCostEstimate(query, units) {
    return {
        total: 0,
        currency: TABLE.currency,
        unit: query.modality === "image" ? "image" : "million_chars",
        units,
        pricePerUnit: 0,
        isBatchPrice: false,
        modelKey: makePriceKey(query.provider, query.model, query.params) + " (unknown pricing)",
    };
}
export function estimateCost(query, units, opts = {}) {
    if (units <= 0) {
        throw new Error("units must be > 0");
    }
    const price = resolvePrice(query, opts);
    let total;
    switch (price.unit) {
        case "image":
            total = price.pricePerUnit * units;
            break;
        case "million_chars":
        case "million_tokens":
            total = (price.pricePerUnit * units) / 1_000_000;
            break;
    }
    return {
        total: roundUsd(total),
        currency: TABLE.currency,
        unit: price.unit,
        units,
        pricePerUnit: price.pricePerUnit,
        isBatchPrice: price.isBatchPrice,
        modelKey: price.key,
    };
}
export function getStaleness(now = new Date()) {
    const lastUpdated = TABLE.last_updated;
    const last = new Date(`${lastUpdated}T00:00:00Z`);
    const ms = now.getTime() - last.getTime();
    const daysAgo = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
    return {
        lastUpdated,
        daysAgo,
        threshold: STALE_THRESHOLD_DAYS,
        isStale: daysAgo > STALE_THRESHOLD_DAYS,
    };
}
export function unitsForModality(modality, payload) {
    if (modality === "image") {
        return payload.count ?? 1;
    }
    return payload.chars ?? 0;
}
function roundUsd(n) {
    return Math.round(n * 1_000_000) / 1_000_000;
}
