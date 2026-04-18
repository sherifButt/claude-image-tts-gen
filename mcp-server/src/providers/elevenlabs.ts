import type {
  ProviderId,
  TtsGenRequest,
  TtsGenResult,
  TtsProvider,
} from "./types.js";

const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

const VOICE_MAP: Record<string, string> = {
  aria: "9BWtsMINqrJLrRacOk9x",
  roger: "CwhRBWXzGAHq8TQ4Fs17",
  sarah: "EXAVITQu4vr4xnSDxMaL",
  rachel: "21m00Tcm4TlvDq8ikWAM",
  adam: "pNInz6obpgDQGcFmaJgB",
  brian: "nPczCjzI2devNBz1zQrb",
};

export const ELEVENLABS_FRIENDLY_VOICES = Object.keys(VOICE_MAP);
export const ELEVENLABS_DEFAULT_VOICE = "aria";

function resolveVoiceId(voice: string): string {
  return VOICE_MAP[voice.toLowerCase()] ?? voice;
}

export class ElevenLabsProvider implements TtsProvider {
  readonly id: ProviderId = "elevenlabs";

  private readonly apiKey: string;

  constructor(opts: { apiKey: string }) {
    this.apiKey = opts.apiKey;
  }

  async generateSpeech(req: TtsGenRequest): Promise<TtsGenResult> {
    const voice = req.voice ?? ELEVENLABS_DEFAULT_VOICE;
    const voiceId = resolveVoiceId(voice);

    const response = await fetch(`${ENDPOINT}/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: req.text,
        model_id: req.model,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ElevenLabs ${response.status}: ${text}`);
    }

    return {
      mimeType: "audio/mpeg",
      data: Buffer.from(await response.arrayBuffer()),
      modelUsed: req.model,
      providerUsed: this.id,
    };
  }
}
