import { estimateCost } from "../pricing/load.js";
import { listAvailable } from "../providers/registry.js";
export function estimateCostDryRun(args) {
    const units = resolveUnits(args);
    if (units <= 0) {
        throw new Error(args.modality === "image"
            ? "count must be > 0 for image (default 1)"
            : args.modality === "video"
                ? "seconds must be > 0 for video (default 5)"
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
        // The registry owns the tier→params mapping and hands it back on the slot.
        // This used to be re-derived here from the tier name, which silently priced
        // the wrong rung the moment a ladder gained a model or a resolution.
        const params = slot.params;
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
    if (args.modality === "video")
        return args.seconds ?? 5;
    if (args.chars !== undefined)
        return args.chars;
    if (args.text !== undefined)
        return args.text.length;
    return 0;
}
function renderText(modality, units, rows, currency, cheapest, cheapestBatch) {
    const unitLabel = modality === "image"
        ? `${units} image${units === 1 ? "" : "s"}`
        : modality === "video"
            ? `${units}s of video`
            : `${units} chars`;
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
