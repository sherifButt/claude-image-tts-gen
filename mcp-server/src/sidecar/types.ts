import type { Modality, ProviderId, Tier } from "../providers/types.js";
import type { CostEstimate } from "../pricing/types.js";

export interface SidecarLineage {
  parent: string | null;
  iteration: number;
}

export interface SidecarImageInput {
  prompt: string;
  /** Legacy single-reference field. Pre-v0.8.8 sidecars wrote this; readers
   *  must still honour it. New writes use `referenceImagePaths` instead. */
  referenceImagePath?: string;
  /** Reference images for image-to-image / multi-reference composition. */
  referenceImagePaths?: string[];
  /** Aspect ratio passed to the provider at generation time. */
  aspectRatio?: import("../util/aspect.js").AspectRatio;
  /** Output resolution tier (gpt-image-2: 1K/2K/4K). */
  resolution?: import("../util/aspect.js").ImageResolution;
}

export interface SidecarSpeechInput {
  text: string;
  voice?: string;
  /** Path to a reference audio used for zero-shot voice cloning. */
  referenceAudioPath?: string;
}

export interface SidecarVideoInput {
  prompt: string;
  /** Path to the input frame animated into video (image-to-video). */
  imagePath: string;
  /** Additional reference image paths passed alongside `imagePath`. */
  referenceImagePaths?: string[];
  /** Requested clip length in seconds. */
  durationSeconds: number;
  aspectRatio?: import("../util/aspect.js").AspectRatio;
}

export type SidecarInput = SidecarImageInput | SidecarSpeechInput | SidecarVideoInput;

export interface SidecarMetadata {
  version: 1;
  createdAt: string;
  tool: "generate_image" | "generate_speech" | "generate_video";
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
