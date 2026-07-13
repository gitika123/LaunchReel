import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import SamJs from 'sam-js';
import {parseFixtureRenderManifest} from '../src/video/manifest';

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.resolve(root, process.argv[2] ?? 'public/fixtures/product-launch-manifest.json');
if (!manifestPath.startsWith(`${root}${path.sep}`)) throw new Error('Fixture manifest must remain inside the repository');
const manifest = parseFixtureRenderManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
const sampleRate = 22050;
const totalSamples = manifest.output.durationSeconds * sampleRate;
const samples = new Uint8Array(totalSamples).fill(128);
const voice = new SamJs({pitch: 52, speed: 82, mouth: 150, throat: 120});

for (const scene of manifest.scenes) {
  const spoken = voice.buf8(scene.narration);
  if (!(spoken instanceof Uint8Array)) throw new Error(`Could not synthesize narration for scene ${scene.id}`);
  const startSample = Math.round((scene.startFrame / manifest.output.fps + 0.35) * sampleRate);
  const available = Math.min(spoken.length, totalSamples - startSample);
  samples.set(spoken.subarray(0, available), startSample);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + samples.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate, 28);
header.writeUInt16LE(1, 32);
header.writeUInt16LE(8, 34);
header.write('data', 36);
header.writeUInt32LE(samples.length, 40);
const outputPath = path.join(root, 'public', manifest.narration.audioPath);
await mkdir(path.dirname(outputPath), {recursive: true});
await writeFile(outputPath, Buffer.concat([header, samples]));
const musicSamples = new Uint8Array(totalSamples);
for (let index = 0; index < musicSamples.length; index += 1) {
  const seconds = index / sampleRate;
  const beat = Math.sin(seconds * Math.PI * 4) > 0.92 ? 10 : 0;
  musicSamples[index] = 128 + Math.round(Math.sin(seconds * Math.PI * 2 * 110) * 8) + beat;
}
const musicHeader = Buffer.from(header);
musicHeader.writeUInt32LE(36 + musicSamples.length, 4);
musicHeader.writeUInt32LE(musicSamples.length, 40);
const musicPath = path.join(root, 'public', manifest.music.audioPath);
await writeFile(musicPath, Buffer.concat([musicHeader, musicSamples]));
console.log(`Generated ${path.relative(root, outputPath)} and ${path.relative(root, musicPath)} (${manifest.output.durationSeconds}s fixture audio)`);
