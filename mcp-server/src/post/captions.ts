import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { WordAlignment } from "../providers/types.js";

export interface CaptionOptions {
  /** Words per caption line. Default 8. */
  wordsPerLine?: number;
}

export type CaptionFormat = "srt" | "vtt";

interface CaptionLine {
  start: number;
  end: number;
  text: string;
}

function groupWords(words: WordAlignment[], wordsPerLine: number): CaptionLine[] {
  const lines: CaptionLine[] = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    const slice = words.slice(i, i + wordsPerLine);
    if (slice.length === 0) continue;
    lines.push({
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      text: slice.map((w) => w.word).join(" "),
    });
  }
  return lines;
}

function formatTime(seconds: number, format: CaptionFormat): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const sep = format === "srt" ? "," : ".";
  return (
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` +
    `${sep}${String(ms).padStart(3, "0")}`
  );
}

export function toSrt(words: WordAlignment[], opts: CaptionOptions = {}): string {
  const lines = groupWords(words, opts.wordsPerLine ?? 8);
  return (
    lines
      .map(
        (line, i) =>
          `${i + 1}\n${formatTime(line.start, "srt")} --> ${formatTime(line.end, "srt")}\n${line.text}\n`,
      )
      .join("\n") + "\n"
  );
}

export function toVtt(words: WordAlignment[], opts: CaptionOptions = {}): string {
  const lines = groupWords(words, opts.wordsPerLine ?? 8);
  const body = lines
    .map(
      (line) =>
        `${formatTime(line.start, "vtt")} --> ${formatTime(line.end, "vtt")}\n${line.text}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export interface CaptionFiles {
  srt?: string;
  vtt?: string;
}

export async function writeCaptionFiles(
  audioPath: string,
  words: WordAlignment[],
  formats: CaptionFormat[],
  opts: CaptionOptions = {},
): Promise<CaptionFiles> {
  await mkdir(dirname(audioPath), { recursive: true });
  const out: CaptionFiles = {};
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
