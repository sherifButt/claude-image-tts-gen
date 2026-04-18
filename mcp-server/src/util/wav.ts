/**
 * Gemini TTS returns raw PCM in `inlineData.data` with a mimeType like
 * "audio/L16;codec=pcm;rate=24000". Browsers and most players won't open
 * raw PCM — wrap it in a RIFF/WAV container so the bytes become a
 * playable .wav file.
 */
export function pcmToWav(
  pcm: Buffer,
  opts: { sampleRate: number; channels?: number; bitsPerSample?: number },
): Buffer {
  const channels = opts.channels ?? 1;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const byteRate = (opts.sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(opts.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/** Parse the sample rate out of a "audio/L16;codec=pcm;rate=24000" string. */
export function parseSampleRate(mimeType: string | undefined, fallback = 24000): number {
  if (!mimeType) return fallback;
  const m = mimeType.match(/rate=(\d+)/);
  return m ? Number(m[1]) : fallback;
}
