import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { campaignConfigurationSchema, type CampaignConfiguration } from "./contracts";
import { runCampaignQa, type CampaignQaReport } from "./qa/campaign-qa";
import { campaignSnapshotSchema, type CampaignSnapshot, type CampaignStatus } from "./workflow";

const editFileSchema = z.object({
  scenes: z.record(z.string(), z.object({ narration: z.string().min(1).optional(), overlayText: z.string().min(1).optional() }).strict()),
}).strict();

export interface RehearsalCliOptions {
  mode: "fixture" | "live";
  allowPaidCalls: boolean;
  serverUrl: string;
  configPath?: string;
  conceptId?: string;
  conceptIndex: number;
  direction?: string;
  storyboardEditsPath?: string;
  archivePath?: string;
  outputDirectory: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface RehearsalStage {
  name: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  campaignStatus: string;
}

export interface RehearsalReport {
  schemaVersion: 1;
  campaignId: string;
  mode: "fixture" | "live";
  generatedAt: string;
  outcome: "completed" | "failed" | "completed_with_limitations";
  configuration: CampaignConfiguration;
  selectedConcept: { id: string; title: string };
  stages: RehearsalStage[];
  providerActivity: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  handoffs: CampaignSnapshot["handoffs"];
  degradationEvents: Array<Record<string, unknown>>;
  finalPaths: Record<string, string>;
  qa?: CampaignQaReport;
  limitations: string[];
}

const parseNumber = (value: string | undefined, flag: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${flag} must be a positive integer`);
  return number;
};

export const parseRehearsalArgs = (argv: string[]): RehearsalCliOptions => {
  const values = new Map<string, string>();
  let allowPaidCalls = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === "--") continue;
    if (flag === "--allow-paid-calls") {
      allowPaidCalls = true;
      continue;
    }
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  const allowed = new Set(["--mode", "--server-url", "--config", "--concept-id", "--concept-index", "--direction", "--storyboard-edits", "--archive", "--output-dir", "--timeout-ms", "--poll-interval-ms"]);
  const unknown = [...values.keys()].find((value) => !allowed.has(value));
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);
  const mode = values.get("--mode") ?? "fixture";
  if (mode !== "fixture" && mode !== "live") throw new Error("--mode must be fixture or live");
  if (mode === "live" && !allowPaidCalls) throw new Error("Live rehearsal is blocked. Re-run with --allow-paid-calls to authorize paid provider use.");
  if (mode === "live" && !values.get("--config")) throw new Error("Live rehearsal requires an explicit --config Campaign JSON file.");
  const serverUrl = new URL(values.get("--server-url") ?? "http://localhost:3000");
  if (serverUrl.protocol !== "http:" && serverUrl.protocol !== "https:") throw new Error("--server-url must use HTTP or HTTPS");
  return {
    mode,
    allowPaidCalls,
    serverUrl: serverUrl.toString().replace(/\/$/, ""),
    configPath: values.get("--config"),
    conceptId: values.get("--concept-id"),
    conceptIndex: values.has("--concept-index") ? parseNumber(values.get("--concept-index"), "--concept-index") - 1 : 0,
    direction: values.get("--direction"),
    storyboardEditsPath: values.get("--storyboard-edits"),
    archivePath: values.get("--archive"),
    outputDirectory: resolve(values.get("--output-dir") ?? join("output", "campaign-qa")),
    timeoutMs: values.has("--timeout-ms") ? parseNumber(values.get("--timeout-ms"), "--timeout-ms") : 15 * 60 * 1000,
    pollIntervalMs: values.has("--poll-interval-ms") ? parseNumber(values.get("--poll-interval-ms"), "--poll-interval-ms") : 1000,
  };
};

const fixtureConfiguration: CampaignConfiguration = {
  type: "product_launch",
  targetAudience: "SaaS founders and marketers preparing a product launch",
  durationSeconds: 30,
  sourceWebsite: "https://fixture.launchreel.test",
};

const loadConfiguration = async (options: RehearsalCliOptions) => campaignConfigurationSchema.parse(options.configPath
  ? JSON.parse(await readFile(resolve(options.configPath), "utf8"))
  : fixtureConfiguration);

const safeMessage = (value: unknown) => String(value).replace(/(api[_-]?key|authorization|token|secret)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]").slice(0, 1000);

const api = async <T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { error?: unknown };
      if (body.error) message = safeMessage(body.error);
    } catch {}
    throw new Error(`${path}: ${message}`);
  }
  return await response.json() as T;
};

const waitForStatus = async (options: RehearsalCliOptions, expected: CampaignStatus[]) => {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = campaignSnapshotSchema.parse(await api(options.serverUrl, "/api/campaigns/current"));
    if (snapshot.status === "production_failed") return snapshot;
    if (expected.includes(snapshot.status)) return snapshot;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, options.pollIntervalMs));
  }
  throw new Error(`Timed out waiting for Campaign status: ${expected.join(" or ")}`);
};

const stage = async (stages: RehearsalStage[], name: string, operation: () => Promise<CampaignSnapshot>) => {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const snapshot = await operation();
    const completed = Date.now();
    stages.push({ name, status: "completed", startedAt, completedAt: new Date(completed).toISOString(), durationMs: completed - started, campaignStatus: snapshot.status });
    return snapshot;
  } catch (error) {
    const completed = Date.now();
    stages.push({ name, status: "failed", startedAt, completedAt: new Date(completed).toISOString(), durationMs: completed - started, campaignStatus: "unknown" });
    throw error;
  }
};

const collectEvents = async (serverUrl: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  const events: Array<Record<string, unknown>> = [];
  try {
    const response = await fetch(`${serverUrl}/api/campaigns/current/events?after=0`, { signal: controller.signal });
    if (!response.ok || !response.body) return events;
    const reader = response.body.getReader();
    let buffer = "";
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += new TextDecoder().decode(result.value, { stream: true });
      const records = buffer.split("\n\n");
      buffer = records.pop() ?? "";
      for (const record of records) {
        const data = record.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (data && data !== "{}") events.push(JSON.parse(data) as Record<string, unknown>);
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  } finally {
    clearTimeout(timeout);
  }
  return events;
};

const applyStoryboardEdits = async (snapshot: CampaignSnapshot, path?: string) => {
  if (!path) return snapshot.storyboard!;
  const edits = editFileSchema.parse(JSON.parse(await readFile(resolve(path), "utf8")));
  return {
    ...snapshot.storyboard!,
    scenes: snapshot.storyboard!.scenes.map((scene) => ({ ...scene, ...edits.scenes[scene.id] })),
  };
};

const downloadArchive = async (options: RehearsalCliOptions, outputDirectory: string) => {
  if (options.archivePath) return resolve(options.archivePath);
  const response = await fetch(`${options.serverUrl}/api/campaigns/current/package`);
  if (!response.ok) return undefined;
  const archivePath = join(outputDirectory, "campaign.zip");
  await writeFile(archivePath, new Uint8Array(await response.arrayBuffer()));
  return archivePath;
};

export const createRehearsalMarkdownSummary = (report: RehearsalReport) => {
  const stages = report.stages.map((value) => `| ${value.name} | ${value.status} | ${value.durationMs} | ${value.campaignStatus} |`).join("\n");
  return `# Campaign Rehearsal: ${report.campaignId}\n\n- Outcome: **${report.outcome}**\n- Mode: **${report.mode}**\n- Selected concept: **${report.selectedConcept.title}** (${report.selectedConcept.id})\n- Agent runs: ${report.agents.length}\n- Handoffs: ${report.handoffs.length}\n- Degradation events: ${report.degradationEvents.length}\n- QA: ${report.qa?.outcome ?? "not run"}\n\n| Stage | Status | Duration (ms) | Campaign status |\n| --- | --- | ---: | --- |\n${stages}\n\n## Final paths\n\n${Object.entries(report.finalPaths).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n## Limitations\n\n${report.limitations.map((value) => `- ${value}`).join("\n")}\n`;
};

export const runRehearsal = async (options: RehearsalCliOptions, log: (message: string) => void = console.log): Promise<RehearsalReport> => {
  if (options.mode === "live" && !options.allowPaidCalls) throw new Error("Paid-call authorization is required for live mode.");
  const configuration = await loadConfiguration(options);
  const stages: RehearsalStage[] = [];
  await mkdir(options.outputDirectory, { recursive: true });
  const started = await stage(stages, "start_campaign", async () => campaignSnapshotSchema.parse(await api(options.serverUrl, options.mode === "fixture" ? "/api/campaigns/fixture" : "/api/campaigns/current", { method: "POST", body: JSON.stringify(configuration) })));
  if (started.mode !== options.mode) throw new Error(`App returned ${started.mode} mode for a ${options.mode} rehearsal; aborting before approval/provider work.`);
  let snapshot = await waitForStatus(options, ["awaiting_source_profile", "awaiting_concept_approval"]);
  if (snapshot.status === "awaiting_source_profile") {
    const profile = snapshot.sourceProfile!;
    snapshot = await stage(stages, "source_profile_approval", async () => campaignSnapshotSchema.parse(await api(options.serverUrl, "/api/campaigns/current/source-profile-approval", { method: "POST", body: JSON.stringify({ saasCompany: profile.saasCompany, productName: profile.productName, positioning: profile.positioning, description: profile.description, colors: profile.colors, callsToAction: profile.callsToAction }) })));
  }
  snapshot = await waitForStatus(options, ["awaiting_concept_approval"]);
  const concepts = snapshot.conceptSet!.concepts;
  concepts.forEach((concept, index) => log(`${index + 1}. ${concept.id}: ${concept.title}`));
  const selected = options.conceptId ? concepts.find(({ id }) => id === options.conceptId) : concepts[options.conceptIndex];
  if (!selected) throw new Error("Selected concept does not exist");
  snapshot = await stage(stages, "concept_approval", async () => campaignSnapshotSchema.parse(await api(options.serverUrl, "/api/campaigns/current/concept-approval", { method: "POST", body: JSON.stringify({ conceptId: selected.id, ...(options.direction ? { direction: options.direction } : {}) }) })));
  snapshot = await waitForStatus(options, ["awaiting_storyboard_approval"]);
  const storyboard = await applyStoryboardEdits(snapshot, options.storyboardEditsPath);
  snapshot = await stage(stages, "storyboard_approval_and_production", async () => {
    const approved = campaignSnapshotSchema.parse(await api(options.serverUrl, "/api/campaigns/current/storyboard-approval", { method: "POST", body: JSON.stringify({ approved: true, storyboard }) }));
    return approved.status === "completed" || approved.status === "production_failed" ? approved : waitForStatus(options, ["completed", "production_failed"]);
  });
  if (snapshot.status === "production_failed") throw new Error(`Campaign production failed: ${safeMessage(snapshot.productionFailure?.message ?? "unknown failure")}`);
  const runDirectory = join(options.outputDirectory, snapshot.id);
  await mkdir(runDirectory, { recursive: true });
  const snapshotPath = join(runDirectory, "campaign-snapshot.json");
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  const archivePath = await downloadArchive(options, runDirectory);
  const limitations: string[] = [];
  let qa: CampaignQaReport | undefined;
  if (archivePath) {
    qa = await runCampaignQa({ archivePath, outputDirectory: join(runDirectory, "qa"), snapshot });
  } else {
    limitations.push("The app did not expose a downloadable Campaign ZIP, so archive and visual QA were not run. Supply --archive to QA an existing package.");
  }
  const events = await collectEvents(options.serverUrl);
  const agents = snapshot.agentRuns.map((agent) => ({ role: agent.role, mode: agent.providerMode, modelId: agent.modelId ?? null, modelProfile: agent.modelProfile ?? null, promptVersion: agent.promptVersion ?? null, startedAt: agent.startedAt ?? null, completedAt: agent.completedAt ?? null, validation: agent.validation }));
  const providerActivity = snapshot.agentRuns.flatMap((agent) => (agent.toolCalls ?? []).map((tool) => ({ agent: agent.role, ...tool })));
  const degradationEvents = [
    ...events.filter((event) => event.type === "provider_degraded" || (event.collaboration as Record<string, unknown> | undefined)?.state === "degraded"),
    ...providerActivity.filter((activity) => activity.status === "degraded" || activity.degradation),
  ];
  const jsonPath = join(runDirectory, "rehearsal-report.json");
  const markdownPath = join(runDirectory, "rehearsal-summary.md");
  const finalPaths: Record<string, string> = {
    snapshot: snapshotPath.replaceAll("\\", "/"),
    rehearsalReport: jsonPath.replaceAll("\\", "/"),
    rehearsalSummary: markdownPath.replaceAll("\\", "/"),
    ...(archivePath ? { archive: archivePath.replaceAll("\\", "/") } : {}),
    ...(snapshot.renderManifest ? { video: snapshot.renderManifest.videoPath, thumbnail: snapshot.renderManifest.thumbnailPath } : {}),
    ...(qa ? { qaReport: qa.paths.jsonReport, qaSummary: qa.paths.markdownSummary, contactSheet: qa.paths.contactSheet! } : {}),
  };
  const report: RehearsalReport = {
    schemaVersion: 1,
    campaignId: snapshot.id,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    outcome: qa?.outcome === "failed" || (options.mode === "live" && !archivePath) ? "failed" : limitations.length || qa?.outcome === "completed_with_warnings" ? "completed_with_limitations" : "completed",
    configuration,
    selectedConcept: { id: selected.id, title: selected.title },
    stages,
    providerActivity,
    agents,
    handoffs: snapshot.handoffs,
    degradationEvents,
    finalPaths,
    ...(qa ? { qa } : {}),
    limitations,
  };
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, createRehearsalMarkdownSummary(report));
  return report;
};
