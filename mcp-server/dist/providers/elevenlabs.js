const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const VOICE_MAP = {
    aria: "9BWtsMINqrJLrRacOk9x",
    roger: "CwhRBWXzGAHq8TQ4Fs17",
    sarah: "EXAVITQu4vr4xnSDxMaL",
    rachel: "21m00Tcm4TlvDq8ikWAM",
    adam: "pNInz6obpgDQGcFmaJgB",
    brian: "nPczCjzI2devNBz1zQrb",
};
export const ELEVENLABS_FRIENDLY_VOICES = Object.keys(VOICE_MAP);
export const ELEVENLABS_DEFAULT_VOICE = "aria";
function resolveVoiceId(voice) {
    return VOICE_MAP[voice.toLowerCase()] ?? voice;
}
export class ElevenLabsProvider {
    id = "elevenlabs";
    apiKey;
    constructor(opts) {
        this.apiKey = opts.apiKey;
    }
    async generateSpeech(req) {
        const voice = req.voice ?? ELEVENLABS_DEFAULT_VOICE;
        const voiceId = resolveVoiceId(voice);
        if (req.wantTimestamps) {
            return await this.callWithTimestamps(voiceId, req);
        }
        return await this.callPlain(voiceId, req);
    }
    async callPlain(voiceId, req) {
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
    async callWithTimestamps(voiceId, req) {
        const response = await fetch(`${ENDPOINT}/${voiceId}/with-timestamps`, {
            method: "POST",
            headers: {
                "xi-api-key": this.apiKey,
                "Content-Type": "application/json",
                Accept: "application/json",
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
        const data = (await response.json());
        const audio = Buffer.from(data.audio_base64, "base64");
        const alignment = aggregateCharsToWords(data.alignment);
        return {
            mimeType: "audio/mpeg",
            data: audio,
            modelUsed: req.model,
            providerUsed: this.id,
            alignment,
        };
    }
}
function aggregateCharsToWords(charAlign) {
    if (!charAlign?.characters || !charAlign.character_start_times_seconds || !charAlign.character_end_times_seconds) {
        return undefined;
    }
    const chars = charAlign.characters;
    const starts = charAlign.character_start_times_seconds;
    const ends = charAlign.character_end_times_seconds;
    if (chars.length !== starts.length || chars.length !== ends.length) {
        return undefined;
    }
    const words = [];
    let buffer = "";
    let bufferStart = null;
    let bufferEnd = null;
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (/\s/.test(ch)) {
            if (buffer.length > 0 && bufferStart !== null && bufferEnd !== null) {
                words.push({ word: buffer, start: bufferStart, end: bufferEnd });
            }
            buffer = "";
            bufferStart = null;
            bufferEnd = null;
            continue;
        }
        if (buffer.length === 0)
            bufferStart = starts[i];
        buffer += ch;
        bufferEnd = ends[i];
    }
    if (buffer.length > 0 && bufferStart !== null && bufferEnd !== null) {
        words.push({ word: buffer, start: bufferStart, end: bufferEnd });
    }
    return words;
}
