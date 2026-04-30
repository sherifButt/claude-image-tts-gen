import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
function groupWords(words, wordsPerLine) {
    const lines = [];
    for (let i = 0; i < words.length; i += wordsPerLine) {
        const slice = words.slice(i, i + wordsPerLine);
        if (slice.length === 0)
            continue;
        lines.push({
            start: slice[0].start,
            end: slice[slice.length - 1].end,
            text: slice.map((w) => w.word).join(" "),
        });
    }
    return lines;
}
function formatTime(seconds, format) {
    const total = Math.max(0, seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    const ms = Math.round((total - Math.floor(total)) * 1000);
    const sep = format === "srt" ? "," : ".";
    return (`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` +
        `${sep}${String(ms).padStart(3, "0")}`);
}
export function toSrt(words, opts = {}) {
    const lines = groupWords(words, opts.wordsPerLine ?? 8);
    return (lines
        .map((line, i) => `${i + 1}\n${formatTime(line.start, "srt")} --> ${formatTime(line.end, "srt")}\n${line.text}\n`)
        .join("\n") + "\n");
}
export function toVtt(words, opts = {}) {
    const lines = groupWords(words, opts.wordsPerLine ?? 8);
    const body = lines
        .map((line) => `${formatTime(line.start, "vtt")} --> ${formatTime(line.end, "vtt")}\n${line.text}\n`)
        .join("\n");
    return `WEBVTT\n\n${body}`;
}
export async function writeCaptionFiles(audioPath, words, formats, opts = {}) {
    await mkdir(dirname(audioPath), { recursive: true });
    const out = {};
    if (formats.includes("srt")) {
        const srtPath = audioPath.replace(/\.[^.]+$/, ".srt");
        await writeFile(srtPath, toSrt(words, opts), "utf8");
        out.srt = srtPath;
    }
    if (formats.includes("vtt")) {
        const vttPath = audioPath.replace(/\.[^.]+$/, ".vtt");
        await writeFile(vttPath, toVtt(words, opts), "utf8");
        out.vtt = vttPath;
    }
    return out;
}
