import { createBatchProvider } from "../batch/provider-registry.js";
import { newJobId, saveJob } from "../batch/store.js";
import type { BatchJob, BatchPrompt } from "../batch/types.js";
import type { Config } from "../config.js";
import { estimateCost } from "../pricing/load.js";
import {
  getDefaultProvider,
  getDefaultTier,
  resolveSlot,
} from "../providers/registry.js";
import type { Modality, ProviderId, Tier } from "../providers/types.js";
import { checkBudget, formatBudgetBlockError } from "../state/budget.js";
import { mapProviderError, StructuredError } from "../util/errors.js";

export interface BatchSubmitArgs {
  modality: Modality;
  prompts: Array<{ text: string; voice?: string }>;
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
}

export interface BatchSubmitOutput {
  success: true;
  jobId: string;
  providerJobId: string;
  status: "submitting" | "in_progress";
  expectedCost: number;
  currency: string;
  promptCount: number;
  text: string;
}

export async function batchSubmit(
  args: BatchSubmitArgs,
  config: Config,
): Promise<BatchSubmitOutput> {
  if (!args.prompts || args.prompts.length === 0) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "prompts array is required and must contain at least one entry",
      "Pass an array like [{text: '...'}, ...].",
    );
  }

  const providerId = args.provider ?? getDefaultProvider(args.modality);
  const tier = args.tier ?? getDefaultTier();
  const slot = args.model
    ? {
        provider: providerId,
        tier,
        model: args.model,
        batchable: true,
        params: {} as Record<string, unknown>,
      }
    : resolveSlot({ provider: providerId, modality: args.modality, tier });

  if (!slot.batchable) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      `${providerId}/${tier} (${slot.model}) does not support batch processing`,
      `Use sync mode (generate_image / generate_speech), or pick a batch-capable provider via list_providers.`,
    );
  }

  // Estimate cost at the BATCH price (50% off for Google/OpenAI batch-capable models)
  const units = args.modality === "image"
    ? args.prompts.length
    : args.prompts.reduce((sum, p) => sum + p.text.length, 0);
  const cost = estimateCost(
    {
      provider: providerId,
      model: slot.model,
      modality: args.modality,
      params: slot.params,
    },
    units,
    { useBatch: true },
  );

  // Pre-flight budget check on the entire batch
  const check = await checkBudget(cost.total);
  if (check.block) {
    throw new StructuredError(
      "BUDGET_EXCEEDED",
      formatBudgetBlockError(check.block),
      `Lower the batch size, switch to a cheaper tier, or raise the cap with set_budget.`,
    );
  }

  const provider = createBatchProvider(providerId, args.modality, config);

  const batchPrompts: BatchPrompt[] = args.prompts.map((p, idx) => ({
    customId: `prompt-${idx}`,
    text: p.text,
    voice: p.voice,
    params: slot.params,
  }));

  const jobId = newJobId();
  const now = new Date().toISOString();

  const job: BatchJob = {
    jobId,
    providerJobId: null,
    provider: providerId,
    modality: args.modality,
    tier,
    model: slot.model,
    modelKey: cost.modelKey,
    status: "submitting",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    expectedCost: cost.total,
    actualCost: 0,
    currency: cost.currency,
    prompts: batchPrompts,
    outputs: [],
    errorMessage: null,
  };
  await saveJob(job);

  let providerJobId: string;
  try {
    const submitted = await provider.submit(batchPrompts, slot.model);
    providerJobId = submitted.providerJobId;
  } catch (err) {
    const mapped = mapProviderError(err, providerId);
    job.status = "failed";
    job.errorMessage = mapped.message;
    await saveJob(job);
    throw mapped;
  }

  job.providerJobId = providerJobId;
  job.status = "in_progress";
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  return {
    success: true,
    jobId,
    providerJobId,
    status: "in_progress",
    expectedCost: cost.total,
    currency: cost.currency,
    promptCount: batchPrompts.length,
    text:
      `Batch submitted.\n` +
      `Job ID: ${jobId} (provider: ${providerJobId})\n` +
      `Provider: ${providerId}/${tier} (${slot.model})\n` +
      `Prompts: ${batchPrompts.length}\n` +
      `Expected cost: ${cost.currency} ${cost.total.toFixed(4)} (batch rate, 50% off)\n` +
      `Status: in_progress (poll with batch_status --job-id ${jobId})`,
  };
}
