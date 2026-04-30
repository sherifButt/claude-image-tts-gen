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
/**
 * gpt-image-1 only supports three concrete sizes. gpt-image-2 accepts
 * flexible sizes but we keep the same three-bucket mapping for parity.
 */
export function aspectToOpenAISize(aspect) {
    switch (aspect) {
        case "1:1":
            return "1024x1024";
        case "4:3":
        case "3:2":
        case "16:9":
        case "21:9":
            return "1536x1024";
        case "3:4":
        case "2:3":
        case "9:16":
            return "1024x1536";
    }
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
