import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { RenderInternals } from "@remotion/renderer";
import { unzipSync } from "fflate";
import { z } from "zod";
import { packageFiles } from "../contracts";
import { validateCampaignArchive } from "../package";
import { campaignSnapshotSchema, type CampaignSnapshot } from "../workflow";

export const checkStatusSchema = z.enum(["passed", "failed", "warning", "skipped"]);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const qaCheckSchema = z.object({
  id: z.string().min(1),
  status: checkStatusSchema,
  summary: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type QaCheck = z.infer<typeof qaCheckSchema>;

const mediaProbeSchema = z.object({
  streams: z.array(z.object({
    codec_type: z.string().optional(),
    codec_name: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    r_frame_rate: z.string().optional(),
    duration: z.string().optional(),
  }).passthrough()),
  format: z.object({ duration: z.string().optional() }).passthrough().optional(),
}).passthrough();

export interface MediaProbe {
  width: number | null;
  height: number | null;
  fps: number | null;
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioPresent: boolean;
}

export interface FrameSample {
  id: string;
  label: string;
  timeSeconds: number;
  kind: "opening" | "scene_midpoint" | "final_cta";
  sceneId?: string;
}

export interface FrameMetric extends FrameSample {
  imagePath: string;
  meanLuma: number;
  lumaVariance: number;
  darkPixelRatio: number;
  nearlyBlank: boolean;
  differenceFromPreviousScene: number | null;
}

export const campaignQaReportSchema = z.object({
  schemaVersion: z.literal(1),
  campaignId: z.string().min(1),
  mode: z.enum(["fixture", "live", "cached", "unknown"]),
  generatedAt: z.string().datetime(),
  outcome: z.enum(["passed", "failed", "completed_with_warnings"]),
  paths: z.object({
    archive: z.string().min(1),
    video: z.string().min(1),
    contactSheet: z.string().min(1).optional(),
    jsonReport: z.string().min(1),
    markdownSummary: z.string().min(1),
    frames: z.array(z.string()),
  }).strict(),
  inventory: z.array(z.string()),
  media: z.object({
    width: z.number().nullable(),
    height: z.number().nullable(),
    fps: z.number().nullable(),
    durationSeconds: z.number().nullable(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    audioPresent: z.boolean(),
  }).strict(),
  checks: z.array(qaCheckSchema),
  frames: z.array(z.object({
    id: z.string(),
    label: z.string(),
    timeSeconds: z.number(),
    kind: z.enum(["opening", "scene_midpoint", "final_cta"]),
    sceneId: z.string().optional(),
    imagePath: z.string(),
    meanLuma: z.number(),
    lumaVariance: z.number(),
    darkPixelRatio: z.number(),
    nearlyBlank: z.boolean(),
    differenceFromPreviousScene: z.number().nullable(),
  }).strict()),
  limitations: z.array(z.string()),
}).strict();

export type CampaignQaReport = z.infer<typeof campaignQaReportSchema>;

const decode = (value: Uint8Array) => new TextDecoder().decode(value);
const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
const portable = (value: string) => value.replaceAll("\\", "/");

const run = (command: string, args: string[], capture = false) => new Promise<Buffer>((resolvePromise, reject) => {
  const executable = command === "ffmpeg" || command === "ffprobe"
    ? RenderInternals.getExecutablePath({ type: command, indent: false, logLevel: "error", binariesDirectory: null })
    : command;
  const child = spawn(executable, args, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.once("error", reject);
  child.once("exit", (code) => code === 0
    ? resolvePromise(Buffer.concat(stdout))
    : reject(new Error(`${command} exited with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`)));
});

const parseRate = (rate: string | undefined) => {
  if (!rate) return null;
  const [numerator, denominatorValue] = rate.split("/").map(Number);
  const denominator = denominatorValue ?? 1;
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator! / denominator : null;
};

export const normalizeMediaProbe = (input: unknown): MediaProbe => {
  const probe = mediaProbeSchema.parse(input);
  const video = probe.streams.find(({ codec_type }) => codec_type === "video");
  const audio = probe.streams.find(({ codec_type }) => codec_type === "audio");
  const duration = Number(probe.format?.duration ?? video?.duration);
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseRate(video?.r_frame_rate),
    durationSeconds: Number.isFinite(duration) ? duration : null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    audioPresent: Boolean(audio),
  };
};

export const validateMediaProbe = (probe: MediaProbe, expectedDurationSeconds?: number): QaCheck[] => {
  const durationPassed = probe.durationSeconds !== null && (expectedDurationSeconds === undefined || Math.abs(probe.durationSeconds - expectedDurationSeconds) <= 0.15);
  return [
    { id: "video_dimensions", status: probe.width === 1080 && probe.height === 1920 ? "passed" : "failed", summary: `Video dimensions are ${probe.width ?? "unknown"}x${probe.height ?? "unknown"}; expected 1080x1920.` },
    { id: "video_fps", status: probe.fps !== null && Math.abs(probe.fps - 30) <= 0.01 ? "passed" : "failed", summary: `Video frame rate is ${probe.fps ?? "unknown"} FPS; expected 30 FPS.` },
    { id: "video_duration", status: durationPassed ? "passed" : "failed", summary: `Video duration is ${probe.durationSeconds ?? "unknown"} seconds${expectedDurationSeconds === undefined ? "." : `; expected ${expectedDurationSeconds} seconds.`}` },
    { id: "video_codec", status: probe.videoCodec === "h264" ? "passed" : "failed", summary: `Video codec is ${probe.videoCodec ?? "unknown"}; expected h264.` },
    { id: "audio_presence", status: probe.audioPresent ? "passed" : "failed", summary: probe.audioPresent ? `Audio stream is present with ${probe.audioCodec ?? "unknown"} codec.` : "Audio stream is missing." },
    { id: "audio_codec", status: probe.audioCodec === "aac" ? "passed" : "failed", summary: `Audio codec is ${probe.audioCodec ?? "unknown"}; expected aac.` },
  ];
};

export const planFrameSamples = (durationSeconds: number, snapshot?: CampaignSnapshot): FrameSample[] => {
  const samples: FrameSample[] = [{ id: "opening", label: "Opening", kind: "opening", timeSeconds: Math.min(0.5, durationSeconds / 4) }];
  if (snapshot?.storyboard) {
    let cursor = 0;
    for (const scene of snapshot.storyboard.scenes) {
      samples.push({ id: `scene-${scene.id}`, label: `${scene.id} midpoint`, kind: "scene_midpoint", sceneId: scene.id, timeSeconds: cursor + scene.durationSeconds / 2 });
      cursor += scene.durationSeconds;
    }
  } else {
    samples.push({ id: "video-midpoint", label: "Video midpoint", kind: "scene_midpoint", timeSeconds: durationSeconds / 2 });
  }
  samples.push({ id: "final-cta", label: "Final CTA", kind: "final_cta", timeSeconds: Math.max(0, durationSeconds - 0.5) });
  return samples.filter((sample, index, values) => values.findIndex(({ timeSeconds }) => Math.abs(timeSeconds - sample.timeSeconds) < 0.01) === index);
};

export const calculateFrameMetric = (sample: FrameSample, pixels: Uint8Array, imagePath: string, previousScenePixels?: Uint8Array): FrameMetric => {
  if (!pixels.length) throw new Error(`No pixels were extracted for ${sample.label}`);
  const total = pixels.reduce((sum, value) => sum + value, 0);
  const meanLuma = total / pixels.length;
  const lumaVariance = pixels.reduce((sum, value) => sum + (value - meanLuma) ** 2, 0) / pixels.length;
  const darkPixelRatio = pixels.filter((value) => value <= 8).length / pixels.length;
  const differenceFromPreviousScene = previousScenePixels && previousScenePixels.length === pixels.length
    ? pixels.reduce((sum, value, index) => sum + Math.abs(value - previousScenePixels[index]!), 0) / pixels.length
    : null;
  return {
    ...sample,
    imagePath,
    meanLuma,
    lumaVariance,
    darkPixelRatio,
    nearlyBlank: lumaVariance < 12 && (meanLuma < 10 || meanLuma > 245),
    differenceFromPreviousScene,
  };
};

const createContactSheet = async (framePaths: string[], outputPath: string) => {
  if (!framePaths.length) return;
  const cellWidth = 216;
  const cellHeight = 384;
  const gap = 8;
  const labelHeight = 24;
  const columns = Math.min(4, framePaths.length);
  const rows = Math.ceil(framePaths.length / columns);
  const images = await Promise.all(framePaths.map((path) => readFile(path)));
  const cells = images.map((image, index) => {
    const x = (index % columns) * (cellWidth + gap);
    const y = Math.floor(index / columns) * (cellHeight + labelHeight + gap);
    return `<g transform="translate(${x} ${y})"><rect width="${cellWidth}" height="${cellHeight + labelHeight}" fill="#111318"/><image width="${cellWidth}" height="${cellHeight}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${image.toString("base64")}"/><text x="8" y="${cellHeight + 17}" fill="#fffefa" font-family="monospace" font-size="12">Frame ${index + 1}</text></g>`;
  }).join("");
  const width = columns * cellWidth + (columns - 1) * gap;
  const height = rows * (cellHeight + labelHeight) + (rows - 1) * gap;
  await writeFile(outputPath, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${cells}</svg>\n`);
};

const extractFrames = async (videoPath: string, samples: FrameSample[], outputDirectory: string) => {
  const metrics: FrameMetric[] = [];
  const framePaths: string[] = [];
  let previousScenePixels: Uint8Array | undefined;
  for (const [index, sample] of samples.entries()) {
    const framePath = join(outputDirectory, `frame-${String(index + 1).padStart(2, "0")}-${sample.id.replace(/[^a-z0-9-]/gi, "-")}.png`);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", sample.timeSeconds.toFixed(3), "-i", videoPath, "-frames:v", "1", framePath]);
    const raw = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", sample.timeSeconds.toFixed(3), "-i", videoPath, "-frames:v", "1", "-vf", "scale=64:64,format=gray", "-f", "image2pipe", "-vcodec", "rawvideo", "-pix_fmt", "gray", "pipe:1"], true);
    const metric = calculateFrameMetric(sample, raw, portable(framePath), sample.kind === "scene_midpoint" ? previousScenePixels : undefined);
    metrics.push(metric);
    framePaths.push(framePath);
    if (sample.kind === "scene_midpoint") previousScenePixels = raw;
  }
  const contactSheet = join(outputDirectory, "contact-sheet.svg");
  await createContactSheet(framePaths, contactSheet);
  return { metrics, framePaths, contactSheet };
};

const inspectArchive = async (archivePath: string, outputDirectory: string) => {
  const inventory = await validateCampaignArchive(archivePath);
  const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
  const videoPath = join(outputDirectory, "campaign.mp4");
  await writeFile(videoPath, archive["campaign.mp4"]!);
  return {
    inventory,
    videoPath,
    caption: decode(archive["caption.txt"]!),
    ctaVariants: decode(archive["cta-variants.txt"]!).split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    provenance: JSON.parse(decode(archive["provenance.json"]!)) as Record<string, unknown>,
  };
};

const contentChecks = (archive: Awaited<ReturnType<typeof inspectArchive>>, snapshot?: CampaignSnapshot): QaCheck[] => {
  const visualAssets = Array.isArray(archive.provenance.visualAssets) ? archive.provenance.visualAssets as Array<Record<string, unknown>> : [];
  const authentic = visualAssets.filter(({ provenance }) => provenance === "source" || provenance === "uploaded");
  const narration = archive.provenance.narration as Record<string, unknown> | undefined;
  const checks: QaCheck[] = [
    { id: "archive_inventory", status: archive.inventory.length === packageFiles.length ? "passed" : "failed", summary: `Campaign ZIP contains exactly ${archive.inventory.length} required files.` },
    { id: "narration_manifest", status: narration?.required === true && typeof narration.path === "string" ? "passed" : "failed", summary: narration?.required === true ? "Provenance records required narration." : "Provenance does not record required narration." },
    { id: "caption_copy", status: archive.caption.trim() ? "passed" : "failed", summary: archive.caption.trim() ? "Packaged caption copy is non-empty." : "Packaged caption copy is empty." },
    { id: "cta_variants", status: archive.ctaVariants.length > 0 ? "passed" : "failed", summary: `${archive.ctaVariants.length} packaged CTA variant(s) found.` },
    { id: "authentic_asset_references", status: authentic.length ? "passed" : "warning", summary: authentic.length ? `${authentic.length} authentic source/uploaded visual asset reference(s) found.` : "No authentic source/uploaded visual asset references were found in provenance." },
  ];
  if (snapshot?.storyboard) {
    const copy = normalized(archive.caption);
    const missingNarration = snapshot.storyboard.scenes.filter(({ narration: value }) => !copy.includes(normalized(value))).map(({ id }) => id);
    checks.push({ id: "narration_copy_match", status: missingNarration.length ? "failed" : "passed", summary: missingNarration.length ? `Packaged caption omits approved narration for: ${missingNarration.join(", ")}.` : "Packaged caption contains every approved scene narration." });
    const words = snapshot.renderManifest?.media.captions.words ?? [];
    const captionsValid = words.length > 0 && words.every((word, index) => word.endSeconds > word.startSeconds && word.endSeconds <= snapshot.storyboard!.durationSeconds && (index === 0 || word.startSeconds >= words[index - 1]!.endSeconds));
    checks.push({ id: "caption_timing", status: captionsValid ? "passed" : "failed", summary: captionsValid ? `${words.length} caption word timing(s) are ordered within the Campaign duration.` : "Caption word timings are missing, unordered, or outside the Campaign duration." });
  } else {
    checks.push({ id: "narration_copy_match", status: "skipped", summary: "Approved Storyboard was not supplied, so packaged narration copy matching was not run." });
    checks.push({ id: "caption_timing", status: "skipped", summary: "Campaign snapshot was not supplied, so caption timing validation was not run." });
  }
  checks.push({ id: "caption_visual_bounds", status: "skipped", summary: "Burned-in caption bounds require OCR/layout telemetry not present in the Campaign package; no visual-bounds claim is made." });
  return checks;
};

const visualChecks = (frames: FrameMetric[], snapshot?: CampaignSnapshot): QaCheck[] => {
  const blank = frames.filter(({ nearlyBlank }) => nearlyBlank);
  const repeated = frames.filter(({ kind, differenceFromPreviousScene }) => kind === "scene_midpoint" && differenceFromPreviousScene !== null && differenceFromPreviousScene < 1.5);
  const final = frames.find(({ kind }) => kind === "final_cta");
  const ctaCopy = snapshot?.storyboard?.scenes.at(-1)?.overlayText.trim();
  const ctaSummary = final && !final.nearlyBlank
    ? `Final CTA sample is visible${ctaCopy ? ` and approved CTA copy is “${ctaCopy}”.` : "; CTA text recognition was not run."}`
    : "Final CTA sample is missing or nearly blank.";
  return [
    { id: "blank_frames", status: blank.length ? "failed" : "passed", summary: blank.length ? `Nearly blank sampled frame(s): ${blank.map(({ label }) => label).join(", ")}.` : "No sampled frames were blank or nearly blank by luminance heuristic." },
    { id: "repeated_scene_frames", status: repeated.length ? "warning" : "passed", summary: repeated.length ? `Visually near-identical adjacent scene midpoint(s): ${repeated.map(({ label }) => label).join(", ")}.` : "Adjacent sampled scene midpoints differ by the pixel heuristic." },
    { id: "final_cta_frame", status: final && !final.nearlyBlank && (!snapshot || Boolean(ctaCopy)) ? "passed" : "failed", summary: ctaSummary },
  ];
};

export const createQaMarkdownSummary = (report: CampaignQaReport) => {
  const failures = report.checks.filter(({ status }) => status === "failed");
  const warnings = report.checks.filter(({ status }) => status === "warning");
  const rows = report.checks.map((check) => `| ${check.id} | ${check.status} | ${check.summary.replaceAll("|", "\\|")} |`).join("\n");
  return `# Campaign QA: ${report.campaignId}\n\n- Outcome: **${report.outcome}**\n- Mode: **${report.mode}**\n- Video: ${report.media.width ?? "?"}x${report.media.height ?? "?"}, ${report.media.fps ?? "?"} FPS, ${report.media.durationSeconds ?? "?"} seconds, ${report.media.videoCodec ?? "unknown"}/${report.media.audioCodec ?? "no audio"}\n- Checks: ${report.checks.length - failures.length - warnings.length} passed/skipped, ${warnings.length} warning(s), ${failures.length} failure(s)\n- Contact sheet: ${report.paths.contactSheet ?? "not generated"}\n\n| Check | Status | Summary |\n| --- | --- | --- |\n${rows}\n\n## Limitations\n\n${report.limitations.map((value) => `- ${value}`).join("\n")}\n`;
};

export interface RunCampaignQaOptions {
  archivePath: string;
  outputDirectory: string;
  snapshot?: CampaignSnapshot;
  ffprobeCommand?: string;
}

export const runCampaignQa = async ({ archivePath, outputDirectory, snapshot, ffprobeCommand = "ffprobe" }: RunCampaignQaOptions): Promise<CampaignQaReport> => {
  const absoluteArchivePath = resolve(archivePath);
  const absoluteOutputDirectory = resolve(outputDirectory);
  await mkdir(absoluteOutputDirectory, { recursive: true });
  const archiveInfo = await inspectArchive(absoluteArchivePath, absoluteOutputDirectory);
  const parsedSnapshot = snapshot ? campaignSnapshotSchema.parse(snapshot) : undefined;
  const provenanceCampaignId = typeof archiveInfo.provenance.campaignId === "string" ? archiveInfo.provenance.campaignId : basename(absoluteArchivePath, ".zip");
  const provenanceMode = archiveInfo.provenance.providerMode;
  const mode = provenanceMode === "fixture" || provenanceMode === "live" || provenanceMode === "cached" ? provenanceMode : "unknown";
  const expectedDuration = parsedSnapshot?.configuration?.durationSeconds ?? (typeof archiveInfo.provenance.durationSeconds === "number" ? archiveInfo.provenance.durationSeconds : undefined);
  const probeJson = JSON.parse((await run(ffprobeCommand, ["-v", "error", "-show_streams", "-show_format", "-of", "json", archiveInfo.videoPath], true)).toString("utf8"));
  const media = normalizeMediaProbe(probeJson);
  const duration = expectedDuration ?? media.durationSeconds;
  if (!duration) throw new Error("Campaign duration is unavailable; frame QA cannot run");
  const extracted = await extractFrames(archiveInfo.videoPath, planFrameSamples(duration, parsedSnapshot), absoluteOutputDirectory);
  const checks = [
    ...contentChecks(archiveInfo, parsedSnapshot),
    ...validateMediaProbe(media, expectedDuration),
    ...visualChecks(extracted.metrics, parsedSnapshot),
  ];
  const hasFailure = checks.some(({ status }) => status === "failed");
  const hasWarning = checks.some(({ status }) => status === "warning");
  const jsonReport = join(absoluteOutputDirectory, "qa-report.json");
  const markdownSummary = join(absoluteOutputDirectory, "qa-summary.md");
  const report = campaignQaReportSchema.parse({
    schemaVersion: 1,
    campaignId: provenanceCampaignId,
    mode,
    generatedAt: new Date().toISOString(),
    outcome: hasFailure ? "failed" : hasWarning ? "completed_with_warnings" : "passed",
    paths: {
      archive: portable(absoluteArchivePath),
      video: portable(archiveInfo.videoPath),
      contactSheet: portable(extracted.contactSheet),
      jsonReport: portable(jsonReport),
      markdownSummary: portable(markdownSummary),
      frames: extracted.framePaths.map(portable),
    },
    inventory: archiveInfo.inventory,
    media,
    checks,
    frames: extracted.metrics,
    limitations: [
      "Blank and repeated-frame findings are deterministic luminance/pixel heuristics, not semantic visual review.",
      "CTA presence is checked from the approved final scene plus a non-blank final sample; OCR text matching is not performed.",
      "Burned-in caption visual bounds are not asserted because package artifacts contain no layout telemetry and OCR is not installed.",
      ...(parsedSnapshot ? [] : ["No Campaign snapshot was supplied, so scene-by-scene narration, caption timing, and scene midpoint checks were limited."]),
    ],
  });
  await writeFile(jsonReport, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownSummary, createQaMarkdownSummary(report));
  return report;
};

export const loadCampaignSnapshot = async (path: string) => campaignSnapshotSchema.parse(JSON.parse(await readFile(resolve(path), "utf8")));

export const assertReadableFile = async (path: string) => {
  const value = await stat(resolve(path));
  if (!value.isFile()) throw new Error(`${path} is not a file`);
};
