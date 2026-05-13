import { createHash } from "node:crypto";
export function buildCacheKey(input) {
    const canonical = JSON.stringify({
        provider: input.provider,
        model: input.model,
        modality: input.modality,
        text: input.text,
        voice: input.voice ?? null,
        params: sortObject(input.params ?? {}),
    });
    return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
function sortObject(obj) {
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
        sorted[key] = obj[key];
    }
    return sorted;
}
