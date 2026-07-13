import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { correctionRequestSchema, criticReportSchema, evidenceItemSchema, packageFiles, packageManifestSchema, type CriticReport, type PackageManifest, type RenderManifest } from "./contracts";
import type { PackageContext, PackageProvider } from "./ports";
import { sourceProfileSchema } from "./source-profile";

const requiredFiles = [...packageFiles];
const encode = (value: string) => {
  const buffer = Buffer.from(value, "utf8");
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  return bytes;
};
const provenanceSchema = z.object({
  campaignId: z.string().min(1),
  campaignType: z.enum(["product_launch", "feature_announcement"]),
  durationSeconds: z.union([z.literal(30), z.literal(60)]),
  compositionId: z.literal("LaunchReelProductLaunch"),
  providerMode: z.enum(["fixture", "live", "cached"]),
  narration: z.object({ required: z.literal(true), path: z.string().min(1), provider: z.enum(["deepgram", "fixture"]), model: z.string().min(1) }).strict(),
  captions: z.object({ provider: z.enum(["deepgram", "fixture"]), model: z.string().min(1), timing: z.literal("word-level") }).strict(),
  music: z.object({ path: z.string().min(1), provider: z.enum(["lyria", "fixture"]), origin: z.enum(["generated", "licensed"]), title: z.string().min(1), creator: z.string().min(1), license: z.string().min(1), sourceUrl: z.string().url() }).strict(),
  sourceProfile: sourceProfileSchema,
  visualAssets: z.array(z.object({
    sceneId: z.string().min(1),
    provenance: z.enum(["source", "uploaded", "generated", "cached", "fixture"]),
    uri: z.string().min(1),
    assetId: z.string().min(1).optional(),
  }).strict()).min(1),
  correction: correctionRequestSchema.optional(),
  generatedAt: z.string().datetime(),
}).strict();

const decode = (value: Uint8Array) => new TextDecoder().decode(value);

const assertExactInventory = (files: string[]) => {
  if (files.length !== requiredFiles.length || new Set(files).size !== requiredFiles.length || requiredFiles.some((file) => !files.includes(file))) {
    throw new Error(`Campaign ZIP must contain exactly: ${requiredFiles.join(", ")}; received: ${files.join(", ")}`);
  }
};

export const validateCampaignArchive = async (archivePath: string) => {
  let archive: ReturnType<typeof unzipSync>;
  try {
    archive = unzipSync(new Uint8Array(await readFile(archivePath)));
  } catch (error) {
    throw new Error("Campaign ZIP is not a valid archive", { cause: error });
  }
  const files = Object.keys(archive);
  assertExactInventory(files);
  if (!archive["campaign.mp4"]?.length || !archive["thumbnail.jpg"]?.length) throw new Error("Campaign ZIP media files must not be empty");
  if (String.fromCharCode(...archive["campaign.mp4"]!.subarray(4, 8)) !== "ftyp") throw new Error("campaign.mp4 does not contain an MP4 ftyp header");
  const thumbnail = archive["thumbnail.jpg"]!;
  if (thumbnail[0] !== 0xff || thumbnail[1] !== 0xd8) throw new Error("thumbnail.jpg is not a JPEG");
  if (!decode(archive["caption.txt"]!).trim() || !decode(archive["cta-variants.txt"]!).trim()) throw new Error("Campaign ZIP text files must not be empty");
  try {
    z.array(evidenceItemSchema).min(1).parse(JSON.parse(decode(archive["citations.json"]!)));
    criticReportSchema.parse(JSON.parse(decode(archive["critic-report.json"]!)));
    provenanceSchema.parse(JSON.parse(decode(archive["provenance.json"]!)));
  } catch (error) {
    throw new Error("Campaign ZIP JSON artifacts failed runtime validation", { cause: error });
  }
  return requiredFiles;
};

export interface LocalPackageProviderOptions {
  rootDirectory: string;
}

export class LocalPackageProvider implements PackageProvider {
  constructor(private readonly options: LocalPackageProviderOptions) {}

  async package(campaignId: string, render: RenderManifest, report: CriticReport, context: PackageContext): Promise<PackageManifest> {
    if (!render.media.narration.required || !render.media.captions.words.length) throw new Error("Required narration and caption timing must exist before packaging");
    const campaignDirectory = join(this.options.rootDirectory, campaignId);
    await mkdir(campaignDirectory, { recursive: true });
    const archivePath = join(campaignDirectory, "campaign.zip");
    const video = new Uint8Array(await readFile(render.videoPath));
    const thumbnail = new Uint8Array(await readFile(render.thumbnailPath));
    const caption = context.storyboard.scenes.map(({ narration }) => narration).join(" ");
    const provenance = {
      campaignId,
      campaignType: render.campaignType,
      durationSeconds: render.durationSeconds,
      compositionId: render.compositionId,
      providerMode: render.providerMode,
      narration: render.media.narration,
      captions: { provider: render.media.captions.provider, model: render.media.captions.model, timing: "word-level" },
      music: render.media.music,
      sourceProfile: context.sourceProfile,
      visualAssets: context.storyboard.scenes.map((scene) => ({
        sceneId: scene.id,
        provenance: scene.visual.kind,
        uri: scene.visual.uri,
        ...(scene.visual.assetId ? { assetId: scene.visual.assetId } : {}),
      })),
      ...(context.correction ? { correction: correctionRequestSchema.parse(context.correction) } : {}),
      generatedAt: new Date().toISOString(),
    };
    const archive = zipSync({
      "campaign.mp4": video,
      "thumbnail.jpg": thumbnail,
      "caption.txt": encode(`${caption}\n`),
      "cta-variants.txt": encode(`${context.ctaVariants.join("\n")}\n`),
      "citations.json": encode(`${JSON.stringify(context.citations, null, 2)}\n`),
      "critic-report.json": encode(`${JSON.stringify(report, null, 2)}\n`),
      "provenance.json": encode(`${JSON.stringify(provenance, null, 2)}\n`),
    }, { level: 6 });
    await writeFile(archivePath, archive);
    const files = await validateCampaignArchive(archivePath);
    return packageManifestSchema.parse({ campaignId, mode: render.providerMode, files, archivePath });
  }
}
