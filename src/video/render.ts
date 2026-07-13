import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { spawn } from "node:child_process";
import { getVideoMetadata } from "@remotion/renderer";
import { renderManifestSchema, type CampaignConfiguration, type MediaProduction, type RenderManifest, type Storyboard } from "../contracts";
import type { RenderProvider } from "../ports";
import { parseCompositionManifest, type CompositionManifest } from "./manifest";

const compositionId = "LaunchReelProductLaunch" as const;
const framesPerSecond = 30;
const accents = ["#ffcc66", "#7557ff", "#27e0c1", "#ff6fae", "#27e0c1"];
const visuals = ["signal", "workflow", "collaboration", "insight", "cta"] as const;

const toPublicPath = (publicDirectory: string, assetPath: string) => {
  const path = relative(publicDirectory, assetPath).split(sep).join("/");
  if (!path || path.startsWith("../") || path.includes("/../")) throw new Error(`Media asset must be inside the public directory: ${assetPath}`);
  return path;
};

export const mapStoryboardToCompositionManifest = ({
  campaignId,
  storyboard,
  media,
  configuration,
  publicDirectory,
  mode,
}: {
  campaignId: string;
  storyboard: Storyboard;
  media: MediaProduction;
  configuration: CampaignConfiguration;
  publicDirectory: string;
  mode: "fixture" | "live" | "cached";
}): CompositionManifest => {
  if (storyboard.durationSeconds !== configuration.durationSeconds || media.durationSeconds !== storyboard.durationSeconds) {
    throw new Error("Storyboard, media, and Campaign configuration durations must match");
  }
  let startFrame = 0;
  const assets = storyboard.scenes.flatMap((scene, index) => {
    if (!/\.(svg|png|jpe?g|webp)$/i.test(scene.visual.uri)) return [];
    const path = scene.visual.uri.startsWith("/") ? scene.visual.uri.slice(1) : toPublicPath(publicDirectory, scene.visual.uri);
    if (!/^(fixtures|campaigns\/)/.test(path)) return [];
    return [{ id: `scene-asset-${index + 1}`, path, kind: "illustration" as const, provenance: scene.visual.kind, alt: scene.overlayText }];
  });
  if (!assets.length) {
    assets.push({ id: "fixture-logo", path: "fixtures/pulseboard-logo.svg", kind: "illustration", provenance: "fixture", alt: "Fixture campaign mark" });
  }
  const scenes = storyboard.scenes.map((scene, index) => {
    const durationInFrames = scene.durationSeconds * framesPerSecond;
    const mapped = {
      id: scene.id,
      startFrame,
      durationInFrames,
      eyebrow: index === storyboard.scenes.length - 1 ? "TAKE THE NEXT STEP" : `SCENE ${index + 1}`,
      headline: scene.overlayText,
      body: scene.narration,
      accent: accents[index % accents.length]!,
      visual: visuals[index % visuals.length]!,
      assetId: assets.some(({id}) => id === `scene-asset-${index + 1}`) ? `scene-asset-${index + 1}` : undefined,
      narration: scene.narration,
    };
    startFrame += durationInFrames;
    return mapped;
  });
  const publicNarrationPath = toPublicPath(publicDirectory, media.narration.path);
  const publicMusicPath = toPublicPath(publicDirectory, media.music.path);
  return parseCompositionManifest({
    schemaVersion: 1,
    campaignId,
    mode,
    campaignType: configuration.type === "feature_announcement" ? "feature-announcement" : "product-launch",
    output: { width: 1080, height: 1920, fps: framesPerSecond, durationSeconds: storyboard.durationSeconds },
    brand: {
      name: "Approved Campaign",
      product: configuration.type === "feature_announcement" ? configuration.featureName : "Product Launch",
      tagline: storyboard.scenes[0]!.overlayText,
      targetAudience: "Approved Target Audience",
      palette: ["#7557ff", "#27e0c1", "#ffcc66"],
    },
    assets,
    narration: {
      audioPath: publicNarrationPath,
      provenance: mode,
      provider: media.narration.provider,
      voice: media.narration.model,
      required: true,
    },
    music: {
      audioPath: publicMusicPath,
      provenance: media.music.origin,
      provider: media.music.provider,
      license: media.music.license,
    },
    captions: media.captions.words.map(({word, startSeconds, endSeconds}) => ({
      text: word,
      startFrame: Math.round(startSeconds * framesPerSecond),
      endFrame: Math.max(Math.round(startSeconds * framesPerSecond) + 1, Math.round(endSeconds * framesPerSecond)),
    })),
    scenes,
    cta: { label: storyboard.scenes.at(-1)!.overlayText.slice(0, 32), url: configuration.type === "feature_announcement" ? configuration.featurePageUrl : configuration.sourceWebsite },
  });
};

export type ProcessRunner = (command: string, args: string[]) => Promise<void>;

const runProcess: ProcessRunner = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
});

interface VideoMetadata {
  width: number | null;
  height: number | null;
  fps: number | null;
  durationInSeconds: number | null;
  codec: string | null;
  audioCodec: string | null;
}

export interface RemotionRenderProviderOptions {
  rootDirectory: string;
  publicDirectory: string;
  runProcess?: ProcessRunner;
  probe?: (path: string) => Promise<VideoMetadata>;
}

export class RemotionRenderProvider implements RenderProvider {
  constructor(private readonly options: RemotionRenderProviderOptions) {}

  async render(campaignId: string, storyboard: Storyboard, media: MediaProduction, configuration: CampaignConfiguration, mode: "fixture" | "live" | "cached" = "live"): Promise<RenderManifest> {
    const manifest = mapStoryboardToCompositionManifest({ campaignId, storyboard, media, configuration, publicDirectory: this.options.publicDirectory, mode });
    const campaignDirectory = dirname(dirname(media.narration.path));
    await mkdir(campaignDirectory, { recursive: true });
    const propsPath = join(campaignDirectory, "render-manifest.json");
    const videoPath = join(campaignDirectory, "campaign.mp4");
    const thumbnailPath = join(campaignDirectory, "thumbnail.jpg");
    await writeFile(propsPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const runner = this.options.runProcess ?? runProcess;
    const entryPoint = join(this.options.rootDirectory, "src", "index.ts");
    const remotion = join(this.options.rootDirectory, "node_modules", ".bin", process.platform === "win32" ? "remotion.cmd" : "remotion");
    const totalFrames = storyboard.durationSeconds * framesPerSecond;
    await runner(remotion, ["render", entryPoint, compositionId, videoPath, `--props=${propsPath}`, "--codec=h264", "--audio-codec=aac", "--pixel-format=yuv420p", `--frames=0-${totalFrames - 1}`]);
    await runner(remotion, ["still", entryPoint, compositionId, thumbnailPath, `--props=${propsPath}`, `--frame=${Math.floor(totalFrames / 2)}`, "--image-format=jpeg"]);
    const metadata = await (this.options.probe ?? ((path) => getVideoMetadata(path, { logLevel: "error" })))(videoPath);
    if (metadata.width !== 1080 || metadata.height !== 1920 || metadata.fps === null || Math.abs(metadata.fps - framesPerSecond) > 0.01 || metadata.durationInSeconds === null || Math.abs(metadata.durationInSeconds - storyboard.durationSeconds) > 0.1 || metadata.codec !== "h264" || metadata.audioCodec !== "aac") {
      throw new Error(`Rendered Campaign failed the 1080x1920 ${framesPerSecond}fps ${storyboard.durationSeconds}-second H.264/AAC objective gate`);
    }
    return renderManifestSchema.parse({
      campaignId,
      campaignType: configuration.type,
      width: 1080,
      height: 1920,
      fps: framesPerSecond,
      durationSeconds: storyboard.durationSeconds,
      videoPath,
      thumbnailPath,
      compositionId,
      providerMode: mode,
      media,
    });
  }
}
