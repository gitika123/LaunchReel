import {z} from 'zod';

const outputSchema = z.object({
  width: z.literal(1080),
  height: z.literal(1920),
  fps: z.literal(30),
  durationSeconds: z.union([z.literal(30), z.literal(60)]),
});

const publicAssetPathSchema = z.string().regex(/^(fixtures|campaigns\/[a-z0-9-]+\/assets)\/[a-z0-9._-]+\.(svg|png|jpe?g|webp)$/i);
const publicAudioPathSchema = z.string().regex(/^(fixtures|campaigns\/[a-z0-9-]+\/assets)\/[a-z0-9._-]+\.(wav|mp3)$/i);

const assetSchema = z.object({
  id: z.string().min(1),
  path: publicAssetPathSchema,
  kind: z.enum(['logo', 'product-ui', 'illustration']),
  provenance: z.enum(['fixture', 'source', 'generated', 'uploaded', 'cached']),
  alt: z.string().min(1),
});

const sceneSchema = z.object({
  id: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  eyebrow: z.string().min(1).max(40),
  headline: z.string().min(1).max(120),
  body: z.string().min(1).max(260),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  visual: z.enum(['signal', 'workflow', 'collaboration', 'insight', 'cta']),
  assetId: z.string().min(1).optional(),
  narration: z.string().min(1).max(500),
});

const captionSchema = z.object({
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  text: z.string().min(1).max(52),
});

export const fixtureRenderManifestSchema = z.object({
  schemaVersion: z.literal(1),
  campaignId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i),
  mode: z.enum(['fixture', 'live', 'cached']),
  campaignType: z.enum(['product-launch', 'feature-announcement']),
  output: outputSchema,
  brand: z.object({
    name: z.string().min(1),
    product: z.string().min(1),
    tagline: z.string().min(1),
    targetAudience: z.string().min(1),
    palette: z.tuple([
      z.string().regex(/^#[0-9a-f]{6}$/i),
      z.string().regex(/^#[0-9a-f]{6}$/i),
      z.string().regex(/^#[0-9a-f]{6}$/i),
    ]),
  }),
  assets: z.array(assetSchema).min(1),
  narration: z.object({
    audioPath: publicAudioPathSchema,
    provenance: z.enum(['fixture', 'live', 'cached']),
    provider: z.enum(['deepgram', 'fixture']),
    voice: z.string().min(1),
    required: z.literal(true),
  }),
  music: z.object({
    audioPath: publicAudioPathSchema,
    provenance: z.enum(['generated', 'licensed']),
    provider: z.enum(['lyria', 'fixture']),
    license: z.string().min(1),
  }),
  captions: z.array(captionSchema).min(1),
  scenes: z.array(sceneSchema),
  cta: z.object({
    label: z.string().min(1).max(32),
    url: z.string().url(),
  }),
}).superRefine((manifest, context) => {
  const totalFrames = manifest.output.fps * manifest.output.durationSeconds;
  const [minimumScenes, maximumScenes] = manifest.output.durationSeconds === 30 ? [4, 8] : [7, 14];
  if (manifest.scenes.length < minimumScenes || manifest.scenes.length > maximumScenes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scenes'],
      message: `${manifest.output.durationSeconds}-second Campaigns require ${minimumScenes}–${maximumScenes} scenes`,
    });
  }
  let cursor = 0;
  for (const [index, scene] of manifest.scenes.entries()) {
    if (scene.durationInFrames < manifest.output.fps * 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenes', index, 'durationInFrames'],
        message: 'Scene must last at least two seconds',
      });
    }
    if (scene.startFrame !== cursor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenes', index, 'startFrame'],
        message: `Scene must start at contiguous frame ${cursor}`,
      });
    }
    if (scene.assetId && !manifest.assets.some(({id}) => id === scene.assetId)) {
      context.addIssue({code: z.ZodIssueCode.custom, path: ['scenes', index, 'assetId'], message: 'Scene asset must exist in the manifest'});
    }
    cursor = scene.startFrame + scene.durationInFrames;
  }
  if (cursor !== totalFrames) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scenes'],
      message: `Scene timeline must total exactly ${totalFrames} frames`,
    });
  }
  for (const [index, caption] of manifest.captions.entries()) {
    if (caption.startFrame >= caption.endFrame || caption.endFrame > totalFrames) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['captions', index],
        message: 'Caption timing must be ordered and inside the composition',
      });
    }
  }
});

export type FixtureRenderManifest = z.infer<typeof fixtureRenderManifestSchema>;
export type CompositionManifest = FixtureRenderManifest;

export const parseFixtureRenderManifest = (input: unknown): FixtureRenderManifest =>
  fixtureRenderManifestSchema.parse(input);
export const parseCompositionManifest = parseFixtureRenderManifest;
