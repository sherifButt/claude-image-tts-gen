import type { Modality, ProviderId, Tier } from "../providers/types.js";
import type { CostEstimate } from "../pricing/types.js";

export interface SidecarLineage {
  parent: string | null;
  iteration: number;
}

export interface SidecarImageInput {
  prompt: string;
  /** Path to a reference image used as conditioning input (image-to-image). */
  referenceImagePath?: string;
  /** Aspect ratio passed to the provider at generation time. */
  aspectRatio?: import("../util/aspect.js").AspectRatio;
}

export interface SidecarSpeechInput {
  text: string;
  voice?: string;
  /** Path to a reference audio used for zero-shot voice cloning. */
  referenceAudioPath?: string;
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
