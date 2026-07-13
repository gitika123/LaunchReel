import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mediaProductionSchema, type MediaProduction, type Storyboard } from "./contracts";
import type { MediaProductionProvider } from "./ports";
import type { NarrationProvider } from "./providers/deepgram";

export interface MusicAsset {
  path: string;
  provider: "lyria" | "fixture";
  origin: "generated" | "licensed";
  title: string;
  creator: string;
  license: string;
  sourceUrl: string;
}

export interface MusicProvider {
  generate(campaignId: string, storyboard: Storyboard): Promise<MusicAsset>;
}

export interface LicensedMusicFixture {
  path: string;
  title: string;
  creator: string;
  license: string;
  sourceUrl: string;
}

export interface LocalMediaProductionOptions {
  rootDirectory: string;
  narrator: NarrationProvider;
  generatedMusic?: MusicProvider;
  licensedMusic: LicensedMusicFixture;
}

const campaignDirectoryName = (campaignId: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(campaignId)) throw new Error("Campaign ID is not safe for local asset storage");
  return campaignId;
};

export class LocalMediaProductionProvider implements MediaProductionProvider {
  constructor(private readonly options: LocalMediaProductionOptions) {}

  async prepare(campaignId: string, storyboard: Storyboard): Promise<MediaProduction> {
    const safeCampaignId = campaignDirectoryName(campaignId);
    const assetsDirectory = join(this.options.rootDirectory, safeCampaignId, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    const mediaManifestPath = join(assetsDirectory, "media-production.json");
    const mediaInputPath = join(assetsDirectory, "media-input.txt");
    const approvedNarration = storyboard.scenes.map(({ narration }) => narration.trim()).join(" ");
    const [retained, retainedInput] = await Promise.all([
      readFile(mediaManifestPath, "utf8").then((content) => mediaProductionSchema.parse(JSON.parse(content))).catch(() => undefined),
      readFile(mediaInputPath, "utf8").catch(() => undefined),
    ]);
    if (retained?.durationSeconds === storyboard.durationSeconds && retainedInput === approvedNarration) {
      const filesExist = await Promise.all([retained.narration.path, retained.music.path].map((path) => readFile(path).then(() => true, () => false)));
      if (filesExist.every(Boolean)) return retained;
    }
    const narration = await this.options.narrator.narrate(approvedNarration);
    if (!narration.audio.byteLength || !narration.words.length) throw new Error("Required narration and word timing were not produced");
    const narrationPath = join(assetsDirectory, "narration.wav");
    const captionsPath = join(assetsDirectory, "captions.json");
    await writeFile(narrationPath, narration.audio);
    await writeFile(captionsPath, `${JSON.stringify(narration.words, null, 2)}\n`);

    let sourceMusic: MusicAsset | undefined;
    if (this.options.generatedMusic) {
      try {
        sourceMusic = await this.options.generatedMusic.generate(safeCampaignId, storyboard);
      } catch {
        sourceMusic = undefined;
      }
    }
    const musicPath = join(assetsDirectory, "music.wav");
    if (sourceMusic) {
      await copyFile(sourceMusic.path, musicPath);
    } else {
      await copyFile(this.options.licensedMusic.path, musicPath);
      sourceMusic = {
        path: musicPath,
        provider: "fixture",
        origin: "licensed",
        title: this.options.licensedMusic.title,
        creator: this.options.licensedMusic.creator,
        license: this.options.licensedMusic.license,
        sourceUrl: this.options.licensedMusic.sourceUrl,
      };
    }

    const production = mediaProductionSchema.parse({
      durationSeconds: storyboard.durationSeconds,
      narration: { required: true, path: narrationPath, provider: "deepgram", model: narration.model },
      captions: { provider: "deepgram", model: "nova-3", words: narration.words },
      music: { ...sourceMusic, path: musicPath },
    });
    await Promise.all([
      writeFile(mediaManifestPath, `${JSON.stringify(production, null, 2)}\n`),
      writeFile(mediaInputPath, approvedNarration),
    ]);
    return production;
  }
}
