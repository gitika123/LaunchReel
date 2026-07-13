import {readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getVideoMetadata} from '@remotion/renderer';
import {z} from 'zod';

const metadataSchema = z.object({
  fps: z.number().min(29.99).max(30.01),
  width: z.literal(1080),
  height: z.literal(1920),
  durationInSeconds: z.number().positive(),
  codec: z.literal('h264'),
  audioCodec: z.literal('aac'),
  pixelFormat: z.enum(['yuv420p', 'yuvj420p']),
});
const manifestSchema = z.object({output: z.object({durationSeconds: z.union([z.literal(30), z.literal(60)])})});

const root = path.resolve(import.meta.dirname, '..');
const videoPath = path.resolve(root, process.argv[2] ?? 'output/product-launch-fixture.mp4');
const manifestPath = path.resolve(root, process.argv[3] ?? 'public/fixtures/product-launch-manifest.json');
const expectedDurationSeconds = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8'))).output.durationSeconds;
const file = await stat(videoPath);
if (!file.isFile() || file.size < 100_000) {
  throw new Error(`Expected a non-empty MP4 at ${videoPath}`);
}
const header = await readFile(videoPath, {encoding: null});
if (header.subarray(4, 12).toString('ascii').includes('ftyp') === false) {
  throw new Error('Rendered file does not contain an MP4 ftyp header');
}
const metadata = metadataSchema.parse(await getVideoMetadata(videoPath, {logLevel: 'error'}));
if (Math.abs(metadata.durationInSeconds - expectedDurationSeconds) > 0.1) {
  throw new Error(`Expected a ${expectedDurationSeconds}-second render, received ${metadata.durationInSeconds} seconds`);
}
const report = {
  file: path.relative(root, videoPath).replaceAll('\\', '/'),
  bytes: file.size,
  ...metadata,
  verifiedAt: new Date().toISOString(),
};
const reportPath = path.join(path.dirname(videoPath), `${path.basename(videoPath, path.extname(videoPath))}.metadata.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
