import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve as resolvePath } from "node:path";
import { StructuredError } from "../util/errors.js";
import { extensionForMime, saveBinary } from "../util/output.js";
let cachedFfmpegAvailable = null;
export async function ffmpegAvailable() {
    if (cachedFfmpegAvailable !== null)
        return cachedFfmpegAvailable;
    cachedFfmpegAvailable = await new Promise((resolve) => {
        const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
        proc.on("error", () => resolve(false));
        proc.on("exit", (code) => resolve(code === 0));
    });
    return cachedFfmpegAvailable;
}
function codecArgsForOutput(outputPath) {
    const ext = extname(outputPath).slice(1).toLowerCase();
    switch (ext) {
        case "mp3":
            return ["-c:a", "libmp3lame", "-b:a", "128k"];
        case "wav":
            return ["-c:a", "pcm_s16le"];
        case "ogg":
            return ["-c:a", "libvorbis"];
        case "opus":
            return ["-c:a", "libopus"];
        case "aac":
        case "m4a":
            return ["-c:a", "aac"];
        case "flac":
            return ["-c:a", "flac"];
        default:
            return ["-c:a", "copy"];
    }
}
function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        proc.stderr?.on("data", (d) => {
            stderr += String(d);
        });
        proc.on("error", (err) => reject(err));
        proc.on("exit", (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`ffmpeg failed (exit ${code}): ${stderr.slice(-500)}`));
        });
    });
}
/** Concatenate audio files into outputPath. Picks codec from output extension
 *  — uses `-c copy` only when every input already matches; otherwise re-encodes
 *  so a mixed-format concat (e.g. wav chunks → mp3 final) works in one pass. */
export async function concatAudioFiles(inputs, outputPath) {
    if (inputs.length === 0) {
        throw new StructuredError("VALIDATION_ERROR", "concatAudioFiles needs at least one input", "Pass an array of audio file paths.");
    }
    // ffmpeg's concat demuxer resolves relative paths in the listfile against the
    // LISTFILE's directory, not process.cwd(). Write absolute paths only.
    const absInputs = inputs.map((p) => resolvePath(p));
    const absOutput = resolvePath(outputPath);
    if (absInputs.length === 1) {
        // Nothing to concat. Still honor an extension/format change if asked.
        const inputExt = extname(absInputs[0]).slice(1).toLowerCase();
        const outputExt = extname(absOutput).slice(1).toLowerCase();
        await mkdir(dirname(absOutput), { recursive: true });
        if (inputExt === outputExt) {
            await copyFile(absInputs[0], absOutput);
            return;
        }
        await transcodeAudio(absInputs[0], absOutput);
        return;
    }
    if (!(await ffmpegAvailable())) {
        throw new StructuredError("CONFIG_ERROR", "ffmpeg is required for audio concat but is not installed", "Install ffmpeg (macOS: `brew install ffmpeg`; Debian: `apt install ffmpeg`).");
    }
    const work = await mkdtemp(join(tmpdir(), "cits-concat-"));
    const listPath = join(work, "list.txt");
    const listBody = absInputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
    await writeFile(listPath, listBody, "utf8");
    await mkdir(dirname(absOutput), { recursive: true });
    const inputExts = new Set(absInputs.map((p) => extname(p).slice(1).toLowerCase()));
    const outputExt = extname(absOutput).slice(1).toLowerCase();
    const sameFormat = inputExts.size === 1 && inputExts.has(outputExt);
    const codecArgs = sameFormat ? ["-c", "copy"] : codecArgsForOutput(absOutput);
    try {
        await runFfmpeg([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            listPath,
            ...codecArgs,
            absOutput,
        ]);
    }
    finally {
        await rm(work, { recursive: true, force: true });
    }
}
/** Transcode a single audio file to whatever format the output extension implies. */
export async function transcodeAudio(input, output) {
    if (!(await ffmpegAvailable())) {
        throw new StructuredError("CONFIG_ERROR", "ffmpeg is required for audio transcode but is not installed", "Install ffmpeg (macOS: `brew install ffmpeg`; Debian: `apt install ffmpeg`).");
    }
    const absInput = resolvePath(input);
    const absOutput = resolvePath(output);
    await mkdir(dirname(absOutput), { recursive: true });
    await runFfmpeg(["-y", "-i", absInput, ...codecArgsForOutput(absOutput), absOutput]);
}
/** Audio MIME for a filename's extension — inverse of extensionForMime. */
export function audioMimeForPath(filePath) {
    const ext = extname(filePath).slice(1).toLowerCase();
    switch (ext) {
        case "mp3":
            return "audio/mpeg";
        case "wav":
            return "audio/wav";
        case "ogg":
            return "audio/ogg";
        case "opus":
            return "audio/opus";
        case "aac":
        case "m4a":
            return "audio/aac";
        case "flac":
            return "audio/flac";
        default:
            return `audio/${ext || "bin"}`;
    }
}
function needsTranscode(sourceMime, destPath) {
    const destExt = extname(destPath).slice(1).toLowerCase();
    if (!destExt)
        return false;
    return destExt !== extensionForMime(sourceMime);
}
/** Save bytes at `destPath`. If the path's extension doesn't match the provider's
 *  mime (e.g. `.mp3` requested but provider returned `audio/wav`), transcode via
 *  ffmpeg so the file on disk actually matches its name. Returns the final mime. */
export async function saveAudioRespectingPath(bytes, destPath, sourceMime) {
    if (!needsTranscode(sourceMime, destPath)) {
        await saveBinary(destPath, bytes);
        return { mimeType: sourceMime };
    }
    const nativeExt = extensionForMime(sourceMime);
    const work = await mkdtemp(join(tmpdir(), "cits-transcode-"));
    try {
        const tempIn = join(work, `in.${nativeExt}`);
        await writeFile(tempIn, bytes);
        await transcodeAudio(tempIn, destPath);
        return { mimeType: audioMimeForPath(destPath) };
    }
    finally {
        await rm(work, { recursive: true, force: true });
    }
}
/** Copy an existing audio file to `destPath`. Transcodes if the destination
 *  extension implies a different format than the source mime. */
export async function copyAudioRespectingPath(sourcePath, destPath, sourceMime) {
    if (!needsTranscode(sourceMime, destPath)) {
        await mkdir(dirname(resolvePath(destPath)), { recursive: true });
        await copyFile(sourcePath, destPath);
        return { mimeType: sourceMime };
    }
    await transcodeAudio(sourcePath, destPath);
    return { mimeType: audioMimeForPath(destPath) };
}
