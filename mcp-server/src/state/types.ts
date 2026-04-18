import type { Modality, ProviderId, Tier } from "../providers/types.js";
import type { PriceUnit } from "../pricing/types.js";

export interface CallEntry {
  ts: string;
  tool: string;
  provider: ProviderId;
  model: string;
  tier: Tier;
  modality: Modality;
  units: number;
  unit: PriceUnit;
  pricePerUnit: number;
  isBatchPrice: boolean;
  cost: number;
  files: string[];
  cached?: boolean;
}

export interface Session {
  startedAt: string;
  currency: string;
  totalCost: number;
  callCount: number;
  calls: CallEntry[];
}

export interface PeriodTotal {
  cost: number;
  callCount: number;
}

export interface SpendSummary {
  currency: string;
  totals: {
    today: PeriodTotal;
    thisWeek: PeriodTotal;
    thisMonth: PeriodTotal;
    allTime: PeriodTotal;
  };
  byProvider: Record<string, PeriodTotal>;
  byTier: Record<string, PeriodTotal>;
  recentCalls: CallEntry[];
}
