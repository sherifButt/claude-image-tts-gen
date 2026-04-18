import { createHash } from "node:crypto";
import type { Modality, ProviderId } from "../providers/types.js";

export interface CacheKeyInput {
  provider: ProviderId;
  model: string;
  modality: Modality;
  text: string;
  voice?: string;
  params?: Record<string, unknown>;
}

export function buildCacheKey(input: CacheKeyInput): string {
  const canonical = JSON.stringify({
    provider: input.provider,
    model: input.model,
    modality: input.modality,
    text: input.text,
    voice: input.voice ?? null,
    params: sortObject(input.params ?? {}),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function sortObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}
