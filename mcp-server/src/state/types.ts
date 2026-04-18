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
  /** SHA1-truncated hash of cwd at call time. */
  project?: string;
  /** Absolute cwd at call time (for human-readable per-project rollups). */
  projectPath?: string;
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

export type BudgetPeriod = "daily" | "weekly" | "monthly";

export interface Budget {
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  currency: string;
  softThreshold: number;
}

export interface BudgetWarning {
  period: BudgetPeriod;
  cap: number;
  currentSpend: number;
  projectedSpend: number;
  pctUsed: number;
  threshold: number;
  currency: string;
}

export interface BudgetBlock extends BudgetWarning {
  reason: "would_exceed_cap";
}
