import type { Config } from "../config.js";
import { listLmStudioModels, type LMStudioModel } from "../providers/lmstudio.js";
import { mapProviderError } from "../util/errors.js";

export interface CheckLmStudioOutput {
  success: true;
  baseUrl: string;
  reachable: boolean;
  models: LMStudioModel[];
  byCapability: {
    text: number;
    image: number;
    tts: number;
    embedding: number;
    unknown: number;
  };
  text: string;
}

export async function checkLmStudio(config: Config): Promise<CheckLmStudioOutput> {
  const baseUrl = config.lmstudioBaseUrl;
  let models: LMStudioModel[] = [];
  let reachable = true;
  let errorMessage: string | null = null;

  try {
    models = await listLmStudioModels(baseUrl);
  } catch (err) {
    reachable = false;
    errorMessage = mapProviderError(err, "lmstudio").message;
  }

  const byCapability = {
    text: models.filter((m) => m.likelyCapability === "text").length,
    image: models.filter((m) => m.likelyCapability === "image").length,
    tts: models.filter((m) => m.likelyCapability === "tts").length,
    embedding: models.filter((m) => m.likelyCapability === "embedding").length,
    unknown: models.filter((m) => m.likelyCapability === "unknown").length,
  };

  const lines: string[] = [`LM Studio (${baseUrl}):`];
  if (!reachable) {
    lines.push(`  unreachable — ${errorMessage}`);
    lines.push(`  Make sure LM Studio is running and the local server is started.`);
  } else if (models.length === 0) {
    lines.push(`  reachable, but no models loaded.`);
    lines.push(`  Load a model in LM Studio (Models tab → choose → load).`);
  } else {
    lines.push(`  ${models.length} model(s) loaded:`);
    for (const m of models) {
      lines.push(`    [${m.likelyCapability.padEnd(9)}] ${m.id}`);
    }
    lines.push(``);
    lines.push(
      `Capability summary: text=${byCapability.text} image=${byCapability.image} ` +
        `tts=${byCapability.tts} embedding=${byCapability.embedding} unknown=${byCapability.unknown}`,
    );
    if (byCapability.image === 0 && byCapability.tts === 0) {
      lines.push(``, `Note: no image or TTS-looking models detected. Most LM Studio installs only host text LLMs.`);
    } else {
      lines.push(
        ``,
        `Use them via --provider lmstudio --model <id> on generate_image or generate_speech.`,
      );
    }
  }

  return {
    success: true,
    baseUrl,
    reachable,
    models,
    byCapability,
    text: lines.join("\n"),
  };
}
