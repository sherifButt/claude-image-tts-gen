import { createBatchProvider } from "../batch/provider-registry.js";
import { listJobs, loadJob, updateJob } from "../batch/store.js";
import type { BatchJob, BatchOutput } from "../batch/types.js";
import { buildCacheKey } from "../cache/key.js";
import { storeInCache } from "../cache/store.js";
import type { Config } from "../config.js";
import { estimateCost } from "../pricing/load.js";
import { writeSidecar } from "../sidecar/metadata.js";
import { appendCall } from "../state/store.js";
import type { CallEntry } from "../state/types.js";
import { mapProviderError, StructuredError } from "../util/errors.js";
import { buildOutputPath, saveBinary } from "../util/output.js";

export interface BatchStatusArgs {
  jobId?: string;
  list?: boolean;
}

export interface BatchStatusOutput {
  success: true;
  jobs?: BatchJob[];
  job?: BatchJob;
  /** True when this poll observed a transition out of in_progress (i.e. completion this call). */
  transitioned: boolean;
  previousStatus?: string;
  text: string;
}

export async function batchStatus(
  args: BatchStatusArgs,
  config: Config,
): Promise<BatchStatusOutput> {
  if (args.list) {
    const jobs = await listJobs();
    return {
      success: true,
      jobs,
      transitioned: false,
      text: renderJobsList(jobs),
    };
  }

  if (!args.jobId) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "jobId is required (or pass list:true to list all jobs)",
      "Re-run with --job-id <id> from a previous batch_submit, or --list.",
    );
  }

  let job = await loadJob(args.jobId);
  const previousStatus = job.status;

  if (job.status === "in_progress" && job.providerJobId) {
    const provider = createBatchProvider(job.provider, job.modality, config);
    let pollResult;
    try {
      pollResult = await provider.poll(job.providerJobId);
    } catch (err) {
      throw mapProviderError(err, job.provider);
    }

    if (pollResult.status === "completed" || pollResult.status === "partial_failure") {
      job = await processCompletedJob(job, pollResult.results ?? [], config);
    } else if (pollResult.status === "failed" || pollResult.status === "cancelled" || pollResult.status === "expired") {
      job = await updateJob(job.jobId, (j) => ({
        ...j,
        status: pollResult.status,
        errorMessage: pollResult.errorMessage ?? null,
        completedAt: new Date().toISOString(),
      }));
    } else {
      // still in progress
      job = await updateJob(job.jobId, (j) => ({ ...j, status: pollResult.status }));
    }
  }

  const transitioned =
    previousStatus === "in_progress" &&
    (job.status === "completed" ||
      job.status === "partial_failure" ||
      job.status === "failed" ||
      job.status === "cancelled" ||
      job.status === "expired");

  return {
    success: true,
    job,
    transitioned,
    previousStatus,
    text: renderJob(job),
  };
}

async function processCompletedJob(
  job: BatchJob,
  results: Array<{ customId: string; mimeType: string; data: Buffer }>,
  config: Config,
): Promise<BatchJob> {
  const now = new Date().toISOString();
  const outputs: BatchOutput[] = [];
  let actualCost = 0;

  // Each result corresponds to a prompt by index (Google) or by custom_id (OpenAI).
  // Google returns inline results in order — match by index.
  for (let i = 0; i < job.prompts.length; i++) {
    const prompt = job.prompts[i];
    const result = results.find((r) => r.customId === prompt.customId)
      ?? (results[i]?.customId === `${i}` ? results[i] : results[i]);

    if (!result) {
      outputs.push({ customId: prompt.customId, error: "no result returned for this prompt" });
      continue;
    }

    const filePath = buildOutputPath({
      prompt: prompt.text,
      mimeType: result.mimeType,
      outputDir: job.modality === "image" ? config.imageOutputDir : config.audioOutputDir,
    });
    await saveBinary(filePath, result.data);

    const cacheKey = buildCacheKey({
      provider: job.provider,
      model: job.model,
      modality: job.modality,
      text: prompt.text,
      voice: prompt.voice,
      params: prompt.params,
    });
    await storeInCache(cacheKey, filePath, {
      mimeType: result.mimeType,
      modelKey: job.modelKey,
    });

    const units = job.modality === "image" ? 1 : prompt.text.length;
    const cost = estimateCost(
      { provider: job.provider, model: job.model, modality: job.modality, params: prompt.params },
      units,
      { useBatch: true },
    );

    const sidecar = await writeSidecar(filePath, {
      version: 1,
      createdAt: now,
      tool: job.modality === "image" ? "generate_image" : "generate_speech",
      modality: job.modality,
      provider: job.provider,
      model: job.model,
      tier: job.tier,
      params: prompt.params ?? {},
      input: job.modality === "image"
        ? { prompt: prompt.text }
        : { text: prompt.text, voice: prompt.voice },
      output: { files: [filePath], mimeType: result.mimeType },
      cost: { ...cost, total: cost.total },
      lineage: { parent: null, iteration: 0 },
    });

    const entry: CallEntry = {
      ts: now,
      tool: job.modality === "image" ? "generate_image" : "generate_speech",
      provider: job.provider,
      model: job.model,
      tier: job.tier,
      modality: job.modality,
      units,
      unit: cost.unit,
      pricePerUnit: cost.pricePerUnit,
      isBatchPrice: true,
      cost: cost.total,
      files: [filePath],
    };
    await appendCall(entry);

    actualCost += cost.total;
    outputs.push({
      customId: prompt.customId,
      filePath,
      sidecar,
      mimeType: result.mimeType,
      cost: cost.total,
    });
  }

  return await updateJob(job.jobId, (j) => ({
    ...j,
    status: outputs.some((o) => o.error) ? "partial_failure" : "completed",
    completedAt: now,
    outputs,
    actualCost: roundUsd(actualCost),
  }));
}

function renderJob(job: BatchJob): string {
  const lines = [
    `Batch ${job.jobId} (${job.provider}/${job.tier}, ${job.modality}):`,
    `  status:        ${job.status}`,
    `  provider job:  ${job.providerJobId ?? "(not yet submitted)"}`,
    `  prompts:       ${job.prompts.length}`,
    `  expected cost: ${job.currency} ${job.expectedCost.toFixed(4)}`,
    `  actual cost:   ${job.currency} ${job.actualCost.toFixed(4)}`,
    `  created:       ${job.createdAt}`,
    `  updated:       ${job.updatedAt}`,
  ];
  if (job.completedAt) lines.push(`  completed:     ${job.completedAt}`);
  if (job.errorMessage) lines.push(`  error:         ${job.errorMessage}`);
  if (job.outputs.length > 0) {
    lines.push(``, `Outputs:`);
    for (const out of job.outputs) {
      if (out.error) {
        lines.push(`  ${out.customId}: FAIL — ${out.error}`);
      } else {
        lines.push(`  ${out.customId}: ${out.filePath} (${job.currency} ${(out.cost ?? 0).toFixed(4)})`);
      }
    }
  }
  return lines.join("\n");
}

function renderJobsList(jobs: BatchJob[]): string {
  if (jobs.length === 0) return "No batch jobs.";
  const lines = [`${jobs.length} batch job${jobs.length === 1 ? "" : "s"}:`, ``];
  for (const j of jobs) {
    lines.push(
      `  ${j.jobId}  ${j.status.padEnd(15)}  ${j.provider}/${j.tier}  ${j.prompts.length} prompts  ` +
        `${j.currency} ${j.expectedCost.toFixed(4)} expected  (${j.createdAt})`,
    );
  }
  return lines.join("\n");
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
