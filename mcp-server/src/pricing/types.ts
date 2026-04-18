import type { Modality } from "../providers/types.js";

export type PriceUnit = "image" | "million_chars" | "million_tokens";

export interface UnitPricing {
  type: PriceUnit;
  standard: number;
  batch?: number;
}

export interface ModelPriceEntry {
  modality: Modality;
  pricing: UnitPricing;
  notes?: string;
}

export interface PriceTable {
  last_updated: string;
  currency: string;
  sources: string[];
  models: Record<string, ModelPriceEntry>;
}

export interface PriceQuery {
  provider: string;
  model: string;
  modality: Modality;
  params?: Record<string, unknown>;
}

export interface ResolvedPrice {
  key: string;
  unit: PriceUnit;
  pricePerUnit: number;
  isBatchPrice: boolean;
  modality: Modality;
  notes?: string;
}

export interface CostEstimate {
  total: number;
  currency: string;
  unit: PriceUnit;
  units: number;
  pricePerUnit: number;
  isBatchPrice: boolean;
  modelKey: string;
}

export interface Staleness {
  lastUpdated: string;
  daysAgo: number;
  isStale: boolean;
  threshold: number;
}
