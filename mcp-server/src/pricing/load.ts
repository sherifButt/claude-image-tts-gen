import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Modality } from "../providers/types.js";
import type {
  CostEstimate,
  PriceQuery,
  PriceTable,
  ResolvedPrice,
  Staleness,
} from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(
  readFileSync(join(HERE, "pricing.json"), "utf8"),
) as PriceTable;
const STALE_THRESHOLD_DAYS = 30;

export function getPriceTable(): PriceTable {
  return TABLE;
}

export function makePriceKey(
  provider: string,
  model: string,
  params?: Record<string, unknown>,
): string {
  const base = `${provider}/${model}`;
  // Image slots vary by `quality` (gpt-image-*); video slots vary by
  // `resolution` (grok-imagine-video: 480p/720p). gpt-image-2 varies by BOTH —
  // quality plus an output-resolution tier (2K/4K), keyed as "quality@2K". 1K
  // is the implicit default and never appears in the key (legacy parity).
  const quality = typeof params?.quality === "string" ? params.quality : "";
  const resolution = typeof params?.resolution === "string" ? params.resolution : "";
  let variant = quality;
  if (resolution && resolution !== "1K") {
    variant = variant ? `${variant}@${resolution}` : resolution;
  }
  // p-video prices draft mode at a quarter of standard at the same resolution,
  // so the flag has to discriminate the key too ("720p-draft"). Undefined on
  // every other call site, which leaves existing keys untouched.
  if (params?.draft === true) {
    variant = variant ? `${variant}-draft` : "draft";
  }
  return variant ? `${base}:${variant}` : base;
}

export function resolvePrice(
  query: PriceQuery,
  opts: { useBatch?: boolean } = {},
): ResolvedPrice {
  const key = makePriceKey(query.provider, query.model, query.params);
  const entry = TABLE.models[key];
  if (!entry) {
    throw new Error(
      `No pricing entry for "${key}". Add it to mcp-server/src/pricing/pricing.json and rebuild.`,
    );
  }
  if (entry.modality !== query.modality) {
    throw new Error(
      `Pricing entry "${key}" has modality "${entry.modality}", expected "${query.modality}".`,
    );
  }

  const wantBatch = opts.useBatch === true;
  const pricePerUnit =
    wantBatch && entry.pricing.batch !== undefined
      ? entry.pricing.batch
      : entry.pricing.standard;
  const isBatchPrice =
    wantBatch && entry.pricing.batch !== undefined && entry.pricing.batch !== entry.pricing.standard;

  return {
    key,
    unit: entry.pricing.type,
    pricePerUnit,
    isBatchPrice,
    modality: entry.modality,
    notes: entry.notes,
  };
}

/** Like estimateCost but returns null on missing pricing entries instead of throwing. */
export function tryEstimateCost(
  query: PriceQuery,
  units: number,
  opts: { useBatch?: boolean } = {},
): CostEstimate | null {
  try {
    return estimateCost(query, units, opts);
  } catch {
    return null;
  }
}

/** Synthesises a cost estimate when pricing is unknown (e.g. explicit --model override). */
export function unknownCostEstimate(query: PriceQuery, units: number): CostEstimate {
  return {
    total: 0,
    currency: TABLE.currency,
    unit:
      query.modality === "image"
        ? "image"
        : query.modality === "video"
          ? "second"
          : "million_chars",
    units,
    pricePerUnit: 0,
    isBatchPrice: false,
    modelKey: makePriceKey(query.provider, query.model, query.params) + " (unknown pricing)",
  };
}

export function estimateCost(
  query: PriceQuery,
  units: number,
  opts: { useBatch?: boolean } = {},
): CostEstimate {
  if (units <= 0) {
    throw new Error("units must be > 0");
  }
  const price = resolvePrice(query, opts);
  let total: number;
  switch (price.unit) {
    case "image":
    case "second":
      // `units` = image count, or video seconds. Linear per-unit price.
      total = price.pricePerUnit * units;
      break;
    case "million_chars":
    case "million_tokens":
      total = (price.pricePerUnit * units) / 1_000_000;
      break;
  }
  return {
    total: roundUsd(total),
    currency: TABLE.currency,
    unit: price.unit,
    units,
    pricePerUnit: price.pricePerUnit,
    isBatchPrice: price.isBatchPrice,
    modelKey: price.key,
  };
}

export function getStaleness(now: Date = new Date()): Staleness {
  const lastUpdated = TABLE.last_updated;
  const last = new Date(`${lastUpdated}T00:00:00Z`);
  const ms = now.getTime() - last.getTime();
  const daysAgo = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  return {
    lastUpdated,
    daysAgo,
    threshold: STALE_THRESHOLD_DAYS,
    isStale: daysAgo > STALE_THRESHOLD_DAYS,
  };
}

export function unitsForModality(
  modality: Modality,
  payload: { count?: number; chars?: number; seconds?: number },
): number {
  if (modality === "image") {
    return payload.count ?? 1;
  }
  if (modality === "video") {
    return payload.seconds ?? 0;
  }
  return payload.chars ?? 0;
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
