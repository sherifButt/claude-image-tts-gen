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
