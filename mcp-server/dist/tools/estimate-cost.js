import { estimateCost } from "../pricing/load.js";
import { listAvailable } from "../providers/registry.js";
export function estimateCostDryRun(args) {
    const units = resolveUnits(args);
    if (units <= 0) {
        throw new Error(args.modality === "image"
            ? "count must be > 0 for image (default 1)"
            : "text or chars must be provided for tts");
    }
    const slots = listAvailable(args.modality).filter((s) => {
        if (args.provider && s.provider !== args.provider)
            return false;
        if (args.tier && s.tier !== args.tier)
            return false;
        return true;
    });
    if (slots.length === 0) {
        throw new Error(`No implemented ${args.modality} providers match the filter. Try without --provider/--tier or run list_providers.`);
    }
    const rows = [];
    let currency = "USD";
    for (const slot of slots) {
        const params = {};
        // For OpenAI image quality, the slot model is the same but quality varies by tier — re-derive from registry params.
        // listAvailable doesn't return params; use estimateCost with proper params via tier mapping done in registry.
        // Workaround: query pricing using the model key directly — for tier:'mid' on openai, modelKey = openai/gpt-image-1:medium.
        // We pass empty params here; the tier discrimination is encoded in slot.model + the param-by-tier mapping below.
        if (slot.provider === "openai" && args.modality === "image") {
            params.quality = slot.tier === "small" ? "low" : slot.tier === "mid" ? "medium" : "high";
        }
        const standard = estimateCost({ provider: slot.provider, model: slot.model, modality: args.modality, params }, units);
        currency = standard.currency;
        let batchTotal = null;
        if (slot.batchable) {
            try {
                const batch = estimateCost({ provider: slot.provider, model: slot.model, modality: args.modality, params }, units, { useBatch: true });
                if (batch.isBatchPrice)
                    batchTotal = batch.total;
            }
            catch {
                batchTotal = null;
            }
        }
        rows.push({
            provider: slot.provider,
            tier: slot.tier,
            model: slot.model,
            modelKey: standard.modelKey,
            unit: standard.unit,
            units,
            pricePerUnit: standard.pricePerUnit,
            totalStandard: standard.total,
            totalBatch: batchTotal,
            batchAvailable: slot.batchable && batchTotal !== null,
        });
    }
    rows.sort((a, b) => a.totalStandard - b.totalStandard);
    const cheapest = rows[0] ?? null;
    const batchRows = rows.filter((r) => r.totalBatch !== null);
    batchRows.sort((a, b) => (a.totalBatch ?? Infinity) - (b.totalBatch ?? Infinity));
    const cheapestBatch = batchRows[0] ?? null;
    return {
        success: true,
        modality: args.modality,
        units,
        currency,
        estimates: rows,
        cheapest,
        cheapestBatch,
        text: renderText(args.modality, units, rows, currency, cheapest, cheapestBatch),
    };
}
function resolveUnits(args) {
    if (args.modality === "image")
        return args.count ?? 1;
    if (args.chars !== undefined)
        return args.chars;
    if (args.text !== undefined)
        return args.text.length;
    return 0;
}
function renderText(modality, units, rows, currency, cheapest, cheapestBatch) {
    const unitLabel = modality === "image" ? `${units} image${units === 1 ? "" : "s"}` : `${units} chars`;
    const lines = [`Cost estimate for ${unitLabel} (${currency}):`, ""];
    for (const r of rows) {
        const batchPart = r.totalBatch !== null ? `  batch ${r.totalBatch.toFixed(4)}` : r.batchAvailable === false ? "  (no batch)" : "";
        lines.push(`  ${r.provider}/${r.tier}  ${r.model}  ` +
            `standard ${r.totalStandard.toFixed(4)}${batchPart}`);
    }
    lines.push("");
    if (cheapest) {
        lines.push(`Cheapest standard: ${cheapest.provider}/${cheapest.tier} @ ${currency} ${cheapest.totalStandard.toFixed(4)}`);
    }
    if (cheapestBatch && cheapestBatch.totalBatch !== null) {
        lines.push(`Cheapest batch:    ${cheapestBatch.provider}/${cheapestBatch.tier} @ ${currency} ${cheapestBatch.totalBatch.toFixed(4)}`);
    }
    return lines.join("\n");
}
