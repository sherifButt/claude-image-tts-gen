import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { sidecarPathFor } from "../sidecar/metadata.js";
import { StructuredError } from "../util/errors.js";

export interface PickVariantArgs {
  keeper: string;
  variants: string[];
  contactSheet?: string;
}

export interface PickVariantOutput {
  success: true;
  keeper: string;
  trashed: string[];
  trashDir: string;
  text: string;
}

const TRASH_DIR_NAME = ".trash";

async function moveToTrash(filePath: string, trashDir: string): Promise<string> {
  if (!existsSync(filePath)) return filePath;
  await mkdir(trashDir, { recursive: true });
  const dest = join(trashDir, basename(filePath));
  await rename(filePath, dest);
  return dest;
}

export async function pickVariant(args: PickVariantArgs): Promise<PickVariantOutput> {
  if (!args.keeper) {
    throw new StructuredError("VALIDATION_ERROR", "keeper path is required", "Pass --keeper <path>.");
  }
  if (!args.variants || args.variants.length === 0) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "variants array is required",
      "Pass the list of all variant file paths returned by the variants tool.",
    );
  }
  if (!args.variants.includes(args.keeper)) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      `keeper "${args.keeper}" is not in the variants list`,
      "Pass the keeper as one of the variant paths.",
    );
  }

  const baseDir = dirname(args.keeper);
  const trashDir = join(baseDir, TRASH_DIR_NAME);
  const trashed: string[] = [];

  for (const variant of args.variants) {
    if (variant === args.keeper) continue;
    const movedFile = await moveToTrash(variant, trashDir);
    trashed.push(movedFile);
    // Move sidecar too
    const sidecar = sidecarPathFor(variant);
    if (existsSync(sidecar)) {
      const movedSidecar = await moveToTrash(sidecar, trashDir);
      trashed.push(movedSidecar);
    }
  }

  if (args.contactSheet && existsSync(args.contactSheet)) {
    const movedSheet = await moveToTrash(args.contactSheet, trashDir);
    trashed.push(movedSheet);
  }

  return {
    success: true,
    keeper: args.keeper,
    trashed,
    trashDir,
    text:
      `Kept: ${args.keeper}\n` +
      `Moved ${trashed.length} files to ${trashDir}\n` +
      `(Use \`rm -rf ${trashDir}\` when you're sure.)`,
  };
}
