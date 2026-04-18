import type { ProviderId, Tier } from "../providers/types.js";

export interface StylePreset {
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
  promptPrefix?: string;
  promptSuffix?: string;
  notes?: string;
}

export interface VoicePreset {
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
  voice?: string;
  notes?: string;
}

export type StylePresets = Record<string, StylePreset>;
export type VoicePresets = Record<string, VoicePreset>;
