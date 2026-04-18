import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { StructuredError } from "../util/errors.js";

export interface ContactSheetOptions {
  /** Side length of each cell (square). Default 512. */
  cellSize?: number;
  /** Pixels of padding between cells. Default 12. */
  gap?: number;
  /** Background color (sharp.Color). Default white. */
  background?: { r: number; g: number; b: number; alpha: number };
}

export async function composeContactSheet(
  inputPaths: string[],
  outputPath: string,
  opts: ContactSheetOptions = {},
): Promise<void> {
  if (inputPaths.length === 0) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "composeContactSheet needs at least one input image",
      "Pass an array of image file paths.",
    );
  }

  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new StructuredError(
      "CONFIG_ERROR",
      "sharp is required for contact sheets but is not installed",
      "Run `npm install sharp` in mcp-server/. On some systems libvips is required.",
    );
  }

  const cellSize = opts.cellSize ?? 512;
  const gap = opts.gap ?? 12;
  const background = opts.background ?? { r: 255, g: 255, b: 255, alpha: 1 };

  const cols = Math.ceil(Math.sqrt(inputPaths.length));
  const rows = Math.ceil(inputPaths.length / cols);
  const width = cols * cellSize + (cols + 1) * gap;
  const height = rows * cellSize + (rows + 1) * gap;

  const cells = await Promise.all(
    inputPaths.map(async (p) =>
      sharp(p).resize(cellSize, cellSize, { fit: "cover" }).toBuffer(),
    ),
  );

  const composites = cells.map((buf, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      input: buf,
      left: gap + col * (cellSize + gap),
      top: gap + row * (cellSize + gap),
    };
  });

  const sheet = await sharp({
    create: { width, height, channels: 4, background },
  })
    .composite(composites)
    .png()
    .toBuffer();

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, sheet);
}
