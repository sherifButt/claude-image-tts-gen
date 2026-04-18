import type { Modality, ProviderId, Tier } from "../providers/types.js";
import type { CostEstimate } from "../pricing/types.js";

export interface SidecarLineage {
  parent: string | null;
  iteration: number;
}

export interface SidecarImageInput {
  prompt: string;
}

export interface SidecarSpeechInput {
  text: string;
  voice?: string;
}

export type SidecarInput = SidecarImageInput | SidecarSpeechInput;

export interface SidecarMetadata {
  version: 1;
  createdAt: string;
  tool: "generate_image" | "generate_speech";
  modality: Modality;
  provider: ProviderId;
  model: string;
  tier: Tier;
  params: Record<string, unknown>;
  input: SidecarInput;
  output: {
    files: string[];
    mimeType: string;
  };
  cost: CostEstimate;
  lineage: SidecarLineage;
  cached?: boolean;
}
