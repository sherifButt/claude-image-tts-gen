import type { Modality, ProviderId, Tier } from "../providers/types.js";

export type BatchStatus =
  | "submitting"
  | "in_progress"
  | "completed"
  | "partial_failure"
  | "failed"
  | "cancelled"
  | "expired";

export interface BatchPrompt {
  customId: string;
  text: string;
  voice?: string;
  params?: Record<string, unknown>;
}

export interface BatchOutput {
  customId: string;
  filePath?: string;
  sidecar?: string;
  mimeType?: string;
  cost?: number;
  error?: string;
}

export interface BatchJob {
  jobId: string;
  providerJobId: string | null;
  provider: ProviderId;
  modality: Modality;
  tier: Tier;
  model: string;
  modelKey: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expectedCost: number;
  actualCost: number;
  currency: string;
  prompts: BatchPrompt[];
  outputs: BatchOutput[];
  errorMessage: string | null;
}

export interface BatchSubmitResult {
  providerJobId: string;
}

export interface BatchPollResult {
  status: BatchStatus;
  results?: Array<{
    customId: string;
    mimeType: string;
    data: Buffer;
  }>;
  errorMessage?: string;
}
