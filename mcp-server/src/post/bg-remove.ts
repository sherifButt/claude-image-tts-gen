import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { StructuredError } from "../util/errors.js";

type BackgroundRemovalModule = {
  removeBackground: (
    input: string | Buffer | Blob,
    config?: { output?: { format?: string; quality?: number } },
  ) => Promise<Blob>;
};

async function loadBackgroundRemoval(): Promise<BackgroundRemovalModule> {
  try {
    const mod = (await import("@imgly/background-removal-node")) as unknown as
      | BackgroundRemovalModule
      | { default: BackgroundRemovalModule };
    return ("removeBackground" in mod
      ? mod
      : mod.default) as BackgroundRemovalModule;
  } catch {
    throw new StructuredError(
      "CONFIG_ERROR",
      "@imgly/background-removal-node is not installed in the plugin folder",
      "The plugin's bootstrap should install this automatically on first start. " +
        "If you're seeing this, the install was skipped or failed. " +
        "Manual fix: cd into the plugin's mcp-server/ folder, run `npm ci --omit=dev`, then RESTART Claude Code (the running MCP process can't load newly-installed modules without a restart). " +
        "First bg-remove call after install also downloads ~80 MB of ONNX model files; subsequent calls are offline. " +
        "Note: bg-remove uses a photo-trained model and works best on photographic subjects (portraits, products). It can mis-segment dense illustration scenes (crowds, where's-waldo-style art) — the photo model treats secondary objects as background.",
    );
  }
}

export function suggestBgRemoveOutputPath(inputPath: string): string {
  const dot = inputPath.lastIndexOf(".");
  const base = dot === -1 ? inputPath : inputPath.slice(0, dot);
  return `${base}.bg-removed.png`;
}

export async function removeBackground(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const { removeBackground: run } = await loadBackgroundRemoval();
  await mkdir(dirname(outputPath), { recursive: true });
  const blob = await run(inputPath, { output: { format: "image/png" } });
  const buf = Buffer.from(await blob.arrayBuffer());
  await writeFile(outputPath, buf);
}
