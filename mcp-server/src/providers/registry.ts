import type { Config } from "../config.js";
import {
  requireElevenLabsKey,
  requireGeminiKey,
  requireOpenAIKey,
  requireOpenRouterKey,
} from "../config.js";
import {
  ELEVENLABS_DEFAULT_VOICE,
  ELEVENLABS_FRIENDLY_VOICES,
  ElevenLabsProvider,
} from "./elevenlabs.js";
import { GoogleProvider } from "./google.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";
import {
  OPENAI_TTS_VOICES_GPT4O,
  OPENAI_TTS_VOICES_STD,
} from "./types.js";
import type {
  ImageProvider,
  Modality,
  ProviderId,
  Tier,
  TtsProvider,
} from "./types.js";

export interface Slot {
  model: string | null;
  batchable: boolean;
  implemented: boolean;
  params?: Record<string, unknown>;
  voices?: readonly string[];
  defaultVoice?: string;
  customVoicesAllowed?: boolean;
}

interface TierTable {
  small: Slot;
  mid: Slot;
  pro: Slot;
}

interface ProviderEntry {
  id: ProviderId;
  image: TierTable;
  tts: TierTable;
}

const NA: Slot = { model: null, batchable: false, implemented: false };

const MATRIX: ProviderEntry[] = [
  {
    id: "google",
    image: {
      small: { model: "gemini-2.5-flash-image", batchable: true, implemented: true },
      mid: NA,
      pro: { model: "imagen-4.0-generate-001", batchable: false, implemented: false },
    },
    tts: {
      small: { model: "gemini-2.5-flash-preview-tts", batchable: true, implemented: false },
      mid: NA,
      pro: { model: "gemini-2.5-pro-preview-tts", batchable: true, implemented: false },
    },
  },
  {
    id: "openai",
    image: {
      small: {
        model: "gpt-image-1",
        batchable: true,
        implemented: true,
        params: { quality: "low" },
      },
      mid: {
        model: "gpt-image-1",
        batchable: true,
        implemented: true,
        params: { quality: "medium" },
      },
      pro: {
        model: "gpt-image-1",
        batchable: true,
        implemented: true,
        params: { quality: "high" },
      },
    },
    tts: {
      small: {
        model: "tts-1",
        batchable: false,
        implemented: true,
        voices: OPENAI_TTS_VOICES_STD,
        defaultVoice: "alloy",
      },
      mid: {
        model: "gpt-4o-mini-tts",
        batchable: false,
        implemented: true,
        voices: OPENAI_TTS_VOICES_GPT4O,
        defaultVoice: "alloy",
      },
      pro: {
        model: "tts-1-hd",
        batchable: false,
        implemented: true,
        voices: OPENAI_TTS_VOICES_STD,
        defaultVoice: "alloy",
      },
    },
  },
  {
    id: "openrouter",
    image: {
      small: { model: "google/gemini-2.5-flash-image", batchable: false, implemented: true },
      mid: NA,
      pro: { model: "google/gemini-3-pro-image-preview", batchable: false, implemented: true },
    },
    tts: { small: NA, mid: NA, pro: NA },
  },
  {
    id: "elevenlabs",
    image: { small: NA, mid: NA, pro: NA },
    tts: {
      small: {
        model: "eleven_turbo_v2_5",
        batchable: false,
        implemented: true,
        voices: ELEVENLABS_FRIENDLY_VOICES,
        defaultVoice: ELEVENLABS_DEFAULT_VOICE,
        customVoicesAllowed: true,
      },
      mid: {
        model: "eleven_multilingual_v2",
        batchable: false,
        implemented: true,
        voices: ELEVENLABS_FRIENDLY_VOICES,
        defaultVoice: ELEVENLABS_DEFAULT_VOICE,
        customVoicesAllowed: true,
      },
      pro: NA,
    },
  },
];

const DEFAULT_PROVIDER: Record<Modality, ProviderId> = {
  image: "google",
  tts: "google",
};

const DEFAULT_TIER: Tier = "small";

export function getDefaultProvider(modality: Modality): ProviderId {
  return DEFAULT_PROVIDER[modality];
}

export function getDefaultTier(): Tier {
  return DEFAULT_TIER;
}

export interface ResolvedSlot {
  provider: ProviderId;
  modality: Modality;
  tier: Tier;
  model: string;
  batchable: boolean;
  params: Record<string, unknown>;
  voices: readonly string[];
  defaultVoice: string | undefined;
  customVoicesAllowed: boolean;
}

export function resolveSlot(opts: {
  provider: ProviderId;
  modality: Modality;
  tier: Tier;
}): ResolvedSlot {
  const entry = MATRIX.find((e) => e.id === opts.provider);
  if (!entry) {
    throw new Error(`Unknown provider: ${opts.provider}`);
  }
  const slot = entry[opts.modality][opts.tier];
  if (!slot.model) {
    throw new Error(
      `${opts.provider} does not offer ${opts.modality} at ${opts.tier} tier. ` +
        `Try a different tier or provider — see list_providers tool.`,
    );
  }
  if (!slot.implemented) {
    throw new Error(
      `${opts.provider} ${opts.modality} ${opts.tier} (${slot.model}) is declared but ` +
        `not yet implemented in this version.`,
    );
  }
  return {
    provider: opts.provider,
    modality: opts.modality,
    tier: opts.tier,
    model: slot.model,
    batchable: slot.batchable,
    params: slot.params ?? {},
    voices: slot.voices ?? [],
    defaultVoice: slot.defaultVoice,
    customVoicesAllowed: slot.customVoicesAllowed ?? false,
  };
}

export interface AvailableSlot {
  provider: ProviderId;
  tier: Tier;
  model: string;
  batchable: boolean;
  voices: readonly string[];
  defaultVoice: string | undefined;
  customVoicesAllowed: boolean;
}

export function listAvailable(modality: Modality): AvailableSlot[] {
  const out: AvailableSlot[] = [];
  for (const entry of MATRIX) {
    for (const tier of ["small", "mid", "pro"] as const) {
      const slot = entry[modality][tier];
      if (slot.model && slot.implemented) {
        out.push({
          provider: entry.id,
          tier,
          model: slot.model,
          batchable: slot.batchable,
          voices: slot.voices ?? [],
          defaultVoice: slot.defaultVoice,
          customVoicesAllowed: slot.customVoicesAllowed ?? false,
        });
      }
    }
  }
  return out;
}

export function listDeclared(modality: Modality): Array<AvailableSlot & { implemented: boolean }> {
  const out: Array<AvailableSlot & { implemented: boolean }> = [];
  for (const entry of MATRIX) {
    for (const tier of ["small", "mid", "pro"] as const) {
      const slot = entry[modality][tier];
      if (slot.model) {
        out.push({
          provider: entry.id,
          tier,
          model: slot.model,
          batchable: slot.batchable,
          voices: slot.voices ?? [],
          defaultVoice: slot.defaultVoice,
          customVoicesAllowed: slot.customVoicesAllowed ?? false,
          implemented: slot.implemented,
        });
      }
    }
  }
  return out;
}

export function createImageProvider(id: ProviderId, config: Config): ImageProvider {
  switch (id) {
    case "google":
      return new GoogleProvider({ apiKey: requireGeminiKey(config) });
    case "openai":
      return new OpenAIProvider({ apiKey: requireOpenAIKey(config) });
    case "openrouter":
      return new OpenRouterProvider({ apiKey: requireOpenRouterKey(config) });
    case "elevenlabs":
      throw new Error(`${id} image provider is declared in the registry but not yet implemented`);
  }
}

export function createTtsProvider(id: ProviderId, config: Config): TtsProvider {
  switch (id) {
    case "openai":
      return new OpenAIProvider({ apiKey: requireOpenAIKey(config) });
    case "elevenlabs":
      return new ElevenLabsProvider({ apiKey: requireElevenLabsKey(config) });
    case "google":
      throw new Error(`${id} TTS provider is declared in the registry but not yet implemented`);
    case "openrouter":
      throw new Error("openrouter does not support TTS");
  }
}
