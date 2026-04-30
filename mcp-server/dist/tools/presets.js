import { readStylePresets, readVoicePresets, saveStylePreset as storeStylePreset, saveVoicePreset as storeVoicePreset, deletePreset as removePreset, } from "../presets/store.js";
import { StructuredError } from "../util/errors.js";
export async function saveStylePreset(args) {
    validateName(args.name);
    const all = await storeStylePreset(args.name, args.preset);
    return {
        success: true,
        name: args.name,
        saved: all[args.name],
        text: `Saved style preset "${args.name}". ${Object.keys(all).length} total style preset(s).`,
    };
}
export async function saveVoicePreset(args) {
    validateName(args.name);
    const all = await storeVoicePreset(args.name, args.preset);
    return {
        success: true,
        name: args.name,
        saved: all[args.name],
        text: `Saved voice preset "${args.name}". ${Object.keys(all).length} total voice preset(s).`,
    };
}
export async function listPresets(args = {}) {
    const kind = args.kind ?? "all";
    const styles = kind === "voice" ? {} : await readStylePresets();
    const voices = kind === "style" ? {} : await readVoicePresets();
    return {
        success: true,
        styles,
        voices,
        text: renderText(styles, voices),
    };
}
export async function deletePreset(args) {
    if (args.kind !== "style" && args.kind !== "voice") {
        throw new StructuredError("VALIDATION_ERROR", "kind must be 'style' or 'voice'", "Pass kind:'style' or kind:'voice'.");
    }
    validateName(args.name);
    await removePreset(args.kind, args.name);
    return { success: true, text: `Deleted ${args.kind} preset "${args.name}" (if it existed).` };
}
function validateName(name) {
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new StructuredError("VALIDATION_ERROR", `Invalid preset name "${name}"`, "Use letters, digits, underscores, and hyphens only.");
    }
}
function renderText(styles, voices) {
    const lines = [];
    const styleEntries = Object.entries(styles);
    if (styleEntries.length > 0) {
        lines.push(`Style presets (${styleEntries.length}):`);
        for (const [name, p] of styleEntries) {
            const parts = [
                p.provider ? `provider=${p.provider}` : null,
                p.tier ? `tier=${p.tier}` : null,
                p.model ? `model=${p.model}` : null,
                p.promptPrefix ? `prefix="${p.promptPrefix}"` : null,
                p.promptSuffix ? `suffix="${p.promptSuffix}"` : null,
            ].filter(Boolean);
            lines.push(`  ${name}: ${parts.join(", ") || "(empty)"}`);
        }
    }
    else {
        lines.push("Style presets: (none)");
    }
    const voiceEntries = Object.entries(voices);
    if (voiceEntries.length > 0) {
        lines.push(``, `Voice presets (${voiceEntries.length}):`);
        for (const [name, p] of voiceEntries) {
            const parts = [
                p.provider ? `provider=${p.provider}` : null,
                p.tier ? `tier=${p.tier}` : null,
                p.model ? `model=${p.model}` : null,
                p.voice ? `voice=${p.voice}` : null,
            ].filter(Boolean);
            lines.push(`  ${name}: ${parts.join(", ") || "(empty)"}`);
        }
    }
    else {
        lines.push("", "Voice presets: (none)");
    }
    return lines.join("\n");
}
