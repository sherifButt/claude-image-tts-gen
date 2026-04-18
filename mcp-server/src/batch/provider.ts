import type { Modality, ProviderId } from "../providers/types.js";
import type { BatchPollResult, BatchPrompt, BatchSubmitResult } from "./types.js";

export interface BatchProvider {
  readonly id: ProviderId;
  readonly modality: Modality;
  submit(prompts: BatchPrompt[], model: string): Promise<BatchSubmitResult>;
  poll(providerJobId: string): Promise<BatchPollResult>;
}
