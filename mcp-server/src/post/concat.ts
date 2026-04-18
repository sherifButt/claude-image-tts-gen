import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { StructuredError } from "../util/errors.js";

let cachedFfmpegAvailable: boolean | null = null;

export async function ffmpegAvailable(): Promise<boolean> {
  if (cachedFfmpegAvailable !== null) return cachedFfmpegAvailable;
  cachedFfmpegAvailable = await new Promise<boolean>((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
  return cachedFfmpegAvailable;
}

/** Concatenate same-format audio files (typically mp3) into a single file. */
export async function concatAudioFiles(inputs: string[], outputPath: string): Promise<void> {
  if (inputs.length === 0) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "concatAudioFiles needs at least one input",
      "Pass an array of audio file paths.",
    );
  }
  if (inputs.length === 1) {
    // Nothing to concat — just copy.
    const { copyFile } = await import("node:fs/promises");
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(inputs[0], outputPath);
    return;
  }

  if (!(await ffmpegAvailable())) {
    throw new StructuredError(
      "CONFIG_ERROR",
      "ffmpeg is required for audio concat but is not installed",
      "Install ffmpeg (macOS: `brew install ffmpeg`; Debian: `apt install ffmpeg`).",
    );
  }

  const work = await mkdtemp(join(tmpdir(), "cits-concat-"));
  const listPath = join(work, "list.txt");
  // ffmpeg concat demuxer expects: file '/abs/path/with/escaped-quotes.mp3'
  const listBody = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  await writeFile(listPath, listBody, "utf8");
  await mkdir(dirname(outputPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    proc.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    proc.on("error", (err) => reject(err));
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat failed (exit ${code}): ${stderr.slice(-500)}`));
    });
  });

  await rm(work, { recursive: true, force: true });
}
