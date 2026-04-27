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
      "@imgly/background-removal-node is required for bg-remove but is not installed",
      "Run `npm install @imgly/background-removal-node` in mcp-server/. The first invocation downloads ~80MB of ONNX model files; subsequent calls are offline.",
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
