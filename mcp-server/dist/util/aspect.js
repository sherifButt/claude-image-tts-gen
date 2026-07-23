export const ASPECT_RATIOS = [
    "1:1",
    "4:3",
    "3:4",
    "16:9",
    "9:16",
    "3:2",
    "2:3",
    "21:9",
];
export function isAspectRatio(v) {
    return typeof v === "string" && ASPECT_RATIOS.includes(v);
}
/** Output-resolution tiers for gpt-image-2 (opt-in; 1K preserves legacy output). */
export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];
export function isImageResolution(v) {
    return typeof v === "string" && IMAGE_RESOLUTIONS.includes(v);
}
function aspectShape(aspect) {
    switch (aspect) {
        case "1:1":
            return "square";
        case "4:3":
        case "3:2":
        case "16:9":
        case "21:9":
            return "landscape";
        case "3:4":
        case "2:3":
        case "9:16":
            return "portrait";
    }
}
/**
 * gpt-image-1 only supports three concrete sizes. gpt-image-2 accepts
 * flexible sizes but we keep the same three-bucket mapping for 1K parity.
 */
export function aspectToOpenAISize(aspect) {
    const shape = aspectShape(aspect);
    return shape === "square"
        ? "1024x1024"
        : shape === "landscape"
            ? "1536x1024"
            : "1024x1536";
}
/**
 * Concrete gpt-image-2 size for an (aspect, resolution) pair. Every value obeys
 * gpt-image-2's constraints: max edge ≤3840px, both edges multiples of 16,
 * long:short ratio ≤3:1, total pixels 0.65–8.3 MP. 1K reuses the legacy
 * gpt-image-1 buckets so default output/cost is unchanged. Square 4K is capped
 * at 2880² (8.29 MP) — 3840² would exceed the pixel ceiling.
 */
export function aspectToOpenAISizeAtResolution(aspect, resolution) {
    if (resolution === "1K")
        return aspectToOpenAISize(aspect);
    const shape = aspectShape(aspect);
    const sizes = {
        "2K": { square: "2048x2048", landscape: "2048x1152", portrait: "1152x2048" },
        "4K": { square: "2880x2880", landscape: "3840x2160", portrait: "2160x3840" },
    };
    return sizes[resolution][shape];
}
/** gpt-image-2 custom-size limits (OpenAI images API). */
export const OPENAI_MAX_EDGE = 3840;
export const OPENAI_MIN_PIXELS = 655360; // 0.65 MP
export const OPENAI_MAX_PIXELS = 8294400; // 8.3 MP
/**
 * Validate a custom gpt-image-2 `size` string (WIDTHxHEIGHT). Returns the
 * parsed dims or a human-readable reason it's rejected. Constraints: both
 * edges multiples of 16, max edge ≤3840, long:short ratio ≤3:1, total pixels
 * within 0.65–8.3 MP.
 */
export function validateOpenAICustomSize(size) {
    const m = /^(\d+)x(\d+)$/.exec(size.trim());
    if (!m)
        return { ok: false, reason: `expected WIDTHxHEIGHT (e.g. 2048x1152), got "${size}"` };
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (width <= 0 || height <= 0)
        return { ok: false, reason: "width and height must be positive" };
    if (width % 16 !== 0 || height % 16 !== 0)
        return { ok: false, reason: `both edges must be multiples of 16 (got ${width}x${height})` };
    if (Math.max(width, height) > OPENAI_MAX_EDGE)
        return { ok: false, reason: `max edge is ${OPENAI_MAX_EDGE}px (got ${Math.max(width, height)})` };
    const ratio = Math.max(width, height) / Math.min(width, height);
    if (ratio > 3)
        return { ok: false, reason: `aspect ratio must be ≤3:1 (got ${ratio.toFixed(2)}:1)` };
    const pixels = width * height;
    if (pixels < OPENAI_MIN_PIXELS || pixels > OPENAI_MAX_PIXELS)
        return {
            ok: false,
            reason: `total pixels must be 0.65–8.3 MP (got ${(pixels / 1_000_000).toFixed(2)} MP)`,
        };
    return { ok: true, width, height };
}
/**
 * Bucket a concrete pixel count into a resolution tier for pricing. Custom
 * sizes don't have their own price rows, so we charge the nearest tier by
 * megapixels (1K ≈ ≤1.05–1.6 MP, 2K ≈ ≤4.2 MP, 4K ≈ ≤8.3 MP).
 */
export function pixelsToResolutionTier(pixels) {
    if (pixels <= 2_000_000)
        return "1K";
    if (pixels <= 5_500_000)
        return "2K";
    return "4K";
}
const LABELS = {
    "1:1": "square",
    "4:3": "classic landscape",
    "3:4": "classic portrait",
    "16:9": "widescreen landscape",
    "9:16": "vertical / mobile portrait",
    "3:2": "photo landscape",
    "2:3": "photo portrait",
    "21:9": "ultra-wide cinematic",
};
export function describeAspect(aspect) {
    return `${aspect} (${LABELS[aspect]})`;
}
/**
 * Imagen 4 accepts only: 1:1, 3:4, 4:3, 9:16, 16:9. Map our wider enum
 * onto the nearest supported bucket.
 */
export function aspectToImagen(aspect) {
    switch (aspect) {
        case "1:1":
            return "1:1";
        case "3:4":
        case "2:3":
            return "3:4";
        case "4:3":
        case "3:2":
            return "4:3";
        case "9:16":
            return "9:16";
        case "16:9":
        case "21:9":
            return "16:9";
    }
}
/**
 * Belt-and-suspenders for providers without a formal aspect param (Gemini
 * Flash Image today): prepend a one-line directive so the model composes
 * for the requested ratio. Idempotent: if the prompt already mentions the
 * ratio verbatim, skip.
 */
export function injectAspectIntoPrompt(prompt, aspect) {
    if (prompt.includes(aspect))
        return prompt;
    return `Aspect ratio: ${describeAspect(aspect)}. ${prompt}`;
}
