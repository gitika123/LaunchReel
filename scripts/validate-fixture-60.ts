import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {parseFixtureRenderManifest} from '../src/video/manifest';

const fixture60RequirementsSchema = z.object({
  campaignType: z.literal('feature-announcement'),
  output: z.object({
    width: z.literal(1080),
    height: z.literal(1920),
    fps: z.literal(30),
    durationSeconds: z.literal(60),
  }),
  feature: z.object({
    name: z.string().min(1),
    factualDescription: z.string().min(1),
    featurePageUrl: z.string().url().startsWith('https://'),
  }),
  narration: z.object({
    audioPath: z.string().min(1),
    provenance: z.literal('fixture'),
    provider: z.literal('fixture'),
    voice: z.string().min(1),
    required: z.literal(true),
  }),
  music: z.object({
    audioPath: z.string().min(1),
    provenance: z.literal('licensed'),
    provider: z.literal('fixture'),
    license: z.string().min(1),
    fallback: z.literal(true),
    provenancePath: z.string().regex(/^fixtures\/[a-z0-9._-]+\.provenance\.json$/i),
  }),
});

const musicProvenanceSchema = z.object({
  title: z.string().min(1),
  creator: z.string().min(1),
  origin: z.literal('licensed'),
  license: z.string().min(1),
  sourceUrl: z.string().url().startsWith('https://'),
  production: z.string().min(1),
});

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.resolve(root, process.argv[2] ?? 'public/fixtures/feature-announcement-60-manifest.json');
const rawManifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
const requirements = fixture60RequirementsSchema.parse(rawManifest);
const manifest = parseFixtureRenderManifest(rawManifest);
const totalFrames = manifest.output.fps * manifest.output.durationSeconds;

if (totalFrames !== 1800) {
  throw new Error(`Fixture must be exactly 1800 frames; received ${totalFrames}`);
}
if (manifest.scenes.length < 7 || manifest.scenes.length > 14) {
  throw new Error(`Fixture must contain 7–14 scenes; received ${manifest.scenes.length}`);
}
if (manifest.scenes.some((scene) => scene.durationInFrames < 60)) {
  throw new Error('Every fixture scene must last at least 60 frames (2 seconds)');
}
const sceneDurationSum = manifest.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0);
if (sceneDurationSum !== totalFrames) {
  throw new Error(`Scene durations must sum to exactly ${totalFrames} frames; received ${sceneDurationSum}`);
}
if (manifest.captions.some((caption) => caption.startFrame < 0 || caption.startFrame >= caption.endFrame || caption.endFrame > totalFrames)) {
  throw new Error(`Every caption must be ordered and bounded within frames 0–${totalFrames}`);
}

const publicRoot = path.join(root, 'public');
const provenancePath = path.resolve(publicRoot, requirements.music.provenancePath);
if (!provenancePath.startsWith(`${publicRoot}${path.sep}`)) {
  throw new Error('Music provenance path must remain inside public storage');
}
const provenance = musicProvenanceSchema.parse(JSON.parse(await readFile(provenancePath, 'utf8')));
if (provenance.license !== requirements.music.license) {
  throw new Error(`Music license mismatch: manifest=${requirements.music.license}, provenance=${provenance.license}`);
}

console.log(JSON.stringify({
  manifest: path.relative(root, manifestPath).replaceAll('\\', '/'),
  campaignType: manifest.campaignType,
  durationSeconds: manifest.output.durationSeconds,
  frames: totalFrames,
  fps: manifest.output.fps,
  dimensions: `${manifest.output.width}x${manifest.output.height}`,
  scenes: manifest.scenes.length,
  captions: manifest.captions.length,
  narrationProvider: requirements.narration.provider,
  musicFallbackLicense: provenance.license,
}, null, 2));
