import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  bandCampaignTaskSchema,
  collaborationPayloadSchema,
  handoffSchema,
  providerModeSchema,
  type BandCampaignTask,
  type CollaborationPayload,
  type Handoff,
} from "./contracts";
import { planBandCampaignTasks, toBandAssignmentStatus, type BandTaskProvider } from "./band-tasks";
import {
  campaignSnapshotSchema,
  campaignStatusSchema,
  type CampaignSnapshot,
  type CampaignWorkflow,
} from "./workflow";

export const collaborationSyncStateSchema = z.enum(["syncing", "completed", "degraded", "retrying"]);

export const collaborationSyncSchema = z.object({
  provider: z.literal("band"),
  key: z.string().min(1),
  state: collaborationSyncStateSchema,
  attempt: z.number().int().positive(),
  handoff: handoffSchema,
  payload: collaborationPayloadSchema,
  receipt: z.object({
    resource: z.enum(["message", "event"]),
    originalResponseId: z.string().min(1).optional(),
    acknowledgmentState: z.enum(["completed", "degraded"]).optional(),
    acknowledgmentResponseId: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();

export const campaignEventSchema = z.object({
  sequence: z.number().int().positive(),
  campaignId: z.string().min(1),
  type: z.enum([
    "campaign_started",
    "source_profile_approved",
    "asset_uploaded",
    "concept_approved",
    "storyboard_approved",
    "correction_requested",
    "correction_rerendering",
    "correction_completed",
    "campaign_completed",
    "handoff_recorded",
    "provider_completed",
    "provider_degraded",
    "collaboration_sync",
    "band_goal_sync",
    "band_task_sync",
    "campaign_failed",
  ]),
  status: campaignStatusSchema,
  providerMode: providerModeSchema,
  summary: z.string().min(1),
  occurredAt: z.string().datetime(),
  artifact: z.string().min(1).optional(),
  collaboration: collaborationSyncSchema.optional(),
  bandTask: bandCampaignTaskSchema.optional(),
}).strict().superRefine(({ type, collaboration, bandTask }, context) => {
  if ((type === "collaboration_sync") !== Boolean(collaboration)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Collaboration sync details must accompany collaboration sync events", path: ["collaboration"] });
  }
  if ((type === "band_task_sync") !== Boolean(bandTask)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Band task details must accompany Band task sync events", path: ["bandTask"] });
  }
});

export type CampaignEvent = z.infer<typeof campaignEventSchema>;
export type NewCampaignEvent = Omit<CampaignEvent, "sequence" | "occurredAt">;
export type CampaignEventListener = (event: CampaignEvent) => void | Promise<void>;

export const campaignHistoryEntrySchema = z.object({
  campaignId: z.string().min(1),
  completedAt: z.string().datetime(),
  mode: providerModeSchema,
  campaignType: z.enum(["product_launch", "feature_announcement"]),
  durationSeconds: z.union([z.literal(30), z.literal(60)]),
  title: z.string().min(1),
}).strict();
export type CampaignHistoryEntry = z.infer<typeof campaignHistoryEntrySchema>;

export interface CampaignRepository {
  loadCurrent(): Promise<CampaignSnapshot | undefined>;
  saveCurrent(snapshot: CampaignSnapshot): Promise<void>;
  clearCurrent(): Promise<void>;
  appendEvent(event: NewCampaignEvent): Promise<CampaignEvent>;
  eventsAfter(sequence: number): Promise<CampaignEvent[]>;
  subscribe(listener: CampaignEventListener): () => void;
  retainCompleted(snapshot: CampaignSnapshot): Promise<void>;
  listCompleted(): Promise<CampaignHistoryEntry[]>;
  loadCompleted(campaignId: string): Promise<CampaignSnapshot | undefined>;
  loadCompletedEvents(campaignId: string): Promise<CampaignEvent[]>;
  deleteCampaign(campaignId: string): Promise<void>;
}

export interface JsonCampaignRepositoryOptions {
  rootDirectory: string;
  campaignAssetDirectories?: string[];
  retentionLimit?: number;
  now?: () => Date;
}

const safeCampaignId = (campaignId: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(campaignId)) throw new Error("Campaign ID contains unsafe path characters");
  return campaignId;
};

export const resolveCampaignScopedPath = (rootDirectory: string, campaignId: string, ...segments: string[]) => {
  const campaignRoot = resolve(rootDirectory, safeCampaignId(campaignId));
  const path = resolve(campaignRoot, ...segments);
  const relation = relative(campaignRoot, path);
  if (relation === ".." || relation.startsWith(`..${sep}`)) throw new Error("Campaign path must remain inside campaign-scoped storage");
  return path;
};

const parseEvents = (content: string): CampaignEvent[] => content
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => campaignEventSchema.parse(JSON.parse(line)));

const readSnapshot = async (path: string) => {
  try {
    return campaignSnapshotSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const readEvents = async (path: string) => {
  try {
    return parseEvents(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

const childDirectories = async (root: string) => {
  try {
    return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

const historyEntry = async (completedRoot: string, campaignId: string): Promise<CampaignHistoryEntry | undefined> => {
  const snapshot = await readSnapshot(resolveCampaignScopedPath(completedRoot, campaignId, "campaign.json"));
  if (!snapshot || snapshot.status !== "completed" || !snapshot.configuration) return undefined;
  const events = await readEvents(resolveCampaignScopedPath(completedRoot, campaignId, "events.ndjson"));
  const completedAt = [...events].reverse().find(({ type }) => type === "campaign_completed")?.occurredAt;
  if (!completedAt) return undefined;
  return campaignHistoryEntrySchema.parse({
    campaignId,
    completedAt,
    mode: snapshot.mode,
    campaignType: snapshot.configuration.type,
    durationSeconds: snapshot.configuration.durationSeconds,
    title: snapshot.configuration.type === "feature_announcement"
      ? snapshot.configuration.featureName
      : snapshot.brief?.productName ?? new URL(snapshot.configuration.sourceWebsite).hostname,
  });
};

export const createJsonCampaignRepository = ({
  rootDirectory,
  campaignAssetDirectories = [],
  retentionLimit = 5,
  now = () => new Date(),
}: JsonCampaignRepositoryOptions): CampaignRepository => {
  const activeRoot = resolve(rootDirectory, "active");
  const completedRoot = resolve(rootDirectory, "completed");
  const legacyRoot = resolve(rootDirectory, "current");
  const legacySnapshotPath = resolve(legacyRoot, "campaign.json");
  const legacyEventsPath = resolve(legacyRoot, "events.ndjson");
  const listeners = new Set<CampaignEventListener>();
  let writes = Promise.resolve();

  const activeCampaigns = () => childDirectories(activeRoot);
  const loadCurrent = async () => {
    const snapshots = (await Promise.all((await activeCampaigns()).map(async (campaignId) => ({
      campaignId,
      snapshot: await readSnapshot(resolveCampaignScopedPath(activeRoot, campaignId, "campaign.json")),
    })))).filter(({ snapshot }) => Boolean(snapshot));
    if (snapshots.length > 1) throw new Error("Campaign repository contains more than one active Campaign");
    return snapshots[0]?.snapshot ?? readSnapshot(legacySnapshotPath);
  };
  const activeEventsPath = async () => {
    const campaigns = await activeCampaigns();
    if (campaigns.length > 1) throw new Error("Campaign repository contains more than one active Campaign");
    if (campaigns.length === 1) return resolveCampaignScopedPath(activeRoot, campaigns[0]!, "events.ndjson");
    return await readSnapshot(legacySnapshotPath) ? legacyEventsPath : undefined;
  };
  const listCompleted = async () => {
    const entries = await Promise.all((await childDirectories(completedRoot)).map((campaignId) => historyEntry(completedRoot, campaignId)));
    return entries.filter((entry): entry is CampaignHistoryEntry => Boolean(entry)).sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  };
  const removeCampaignDirectory = async (root: string, campaignId: string) => {
    await rm(resolveCampaignScopedPath(root, campaignId), { recursive: true, force: true });
  };
  const removeCompletedAssets = async (campaignId: string) => {
    await removeCampaignDirectory(completedRoot, campaignId);
    await Promise.all(campaignAssetDirectories.map((directory) => removeCampaignDirectory(directory, campaignId)));
  };

  return {
    loadCurrent,

    async saveCurrent(snapshot) {
      const validated = campaignSnapshotSchema.parse(snapshot);
      writes = writes.then(async () => {
        const current = await loadCurrent();
        if (current && current.id !== validated.id) throw new Error(`Campaign ${current.id} is still active`);
        const snapshotPath = resolveCampaignScopedPath(activeRoot, validated.id, "campaign.json");
        const legacy = await readSnapshot(legacySnapshotPath);
        if (legacy?.id === validated.id && !(await activeCampaigns()).length) {
          await mkdir(activeRoot, { recursive: true });
          await rename(legacyRoot, dirname(snapshotPath));
        } else {
          await mkdir(dirname(snapshotPath), { recursive: true });
        }
        const temporaryPath = resolveCampaignScopedPath(activeRoot, validated.id, `campaign.${process.pid}.${Date.now()}.tmp`);
        await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
        await rename(temporaryPath, snapshotPath);
      });
      await writes;
    },

    async clearCurrent() {
      writes = writes.then(async () => {
        const current = await loadCurrent();
        if (current) await removeCampaignDirectory(activeRoot, current.id);
        if ((await readSnapshot(legacySnapshotPath))?.id === current?.id) await rm(legacyRoot, { recursive: true, force: true });
      });
      await writes;
    },

    async appendEvent(input) {
      let persisted!: CampaignEvent;
      writes = writes.then(async () => {
        const path = await activeEventsPath() ?? resolveCampaignScopedPath(activeRoot, input.campaignId, "events.ndjson");
        const events = await readEvents(path);
        persisted = campaignEventSchema.parse({
          ...input,
          sequence: (events.at(-1)?.sequence ?? 0) + 1,
          occurredAt: now().toISOString(),
        });
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(persisted)}\n`, "utf8");
      });
      await writes;
      for (const listener of listeners) void Promise.resolve(listener(persisted));
      return persisted;
    },

    async eventsAfter(sequence) {
      const path = await activeEventsPath();
      return path ? (await readEvents(path)).filter((event) => event.sequence > sequence) : [];
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async retainCompleted(snapshot) {
      const validated = campaignSnapshotSchema.parse(snapshot);
      if (validated.status !== "completed") throw new Error("Only completed Campaigns can enter history");
      writes = writes.then(async () => {
        const current = await loadCurrent();
        if (!current || current.id !== validated.id) throw new Error("Completed Campaign must match the active Campaign");
        const activePath = resolveCampaignScopedPath(activeRoot, validated.id, "events.ndjson");
        const campaignPath = resolveCampaignScopedPath(completedRoot, validated.id, "campaign.json");
        const eventsPath = resolveCampaignScopedPath(completedRoot, validated.id, "events.ndjson");
        await mkdir(dirname(campaignPath), { recursive: true });
        await writeFile(campaignPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
        await writeFile(eventsPath, (await readFile(activePath, "utf8")), "utf8");
        const retained = await listCompleted();
        for (const expired of retained.slice(retentionLimit)) await removeCompletedAssets(expired.campaignId);
      });
      await writes;
    },

    listCompleted,

    async loadCompleted(campaignId) {
      return readSnapshot(resolveCampaignScopedPath(completedRoot, campaignId, "campaign.json"));
    },

    async loadCompletedEvents(campaignId) {
      return readEvents(resolveCampaignScopedPath(completedRoot, campaignId, "events.ndjson"));
    },

    async deleteCampaign(campaignId) {
      const validatedId = safeCampaignId(campaignId);
      writes = writes.then(async () => {
        const current = await loadCurrent();
        if (current?.id === validatedId) await removeCampaignDirectory(activeRoot, validatedId);
        if ((await readSnapshot(legacySnapshotPath))?.id === validatedId) await rm(legacyRoot, { recursive: true, force: true });
        await removeCompletedAssets(validatedId);
      });
      await writes;
    },
  };
};

export interface CollaborationMirrorReceipt {
  resource: "message" | "event";
  originalResponseId?: string;
  acknowledgmentState?: "completed" | "degraded";
  acknowledgmentResponseId?: string;
}

export interface CollaborationMirror {
  mirror(payload: CollaborationPayload): Promise<CollaborationMirrorReceipt>;
  acknowledge?(payload: CollaborationPayload): Promise<string | undefined>;
}

export interface PersistedCampaignRuntimeOptions {
  collaboration?: CollaborationMirror;
  bandTasks?: BandTaskProvider;
  collaborationRoomUrl?: string;
  campaignId?: (mode: CampaignSnapshot["mode"]) => string;
}

export interface PersistedCampaignRuntime extends CampaignWorkflow {
  reset(): Promise<CampaignSnapshot>;
  eventsAfter(sequence: number): Promise<CampaignEvent[]>;
  subscribe(listener: CampaignEventListener): () => void;
  retryCollaboration(): Promise<CampaignEvent[]>;
  retryBandTasks(): Promise<CampaignEvent[]>;
  bandTasks(): BandCampaignTask[];
  collaborationRoomUrl(): string | undefined;
  history(): Promise<CampaignHistoryEntry[]>;
  completedCampaign(campaignId: string): Promise<CampaignSnapshot | undefined>;
  deleteCampaign(campaignId: string): Promise<CampaignSnapshot>;
}

const operationSummary = {
  campaign_started: "Source Website profile is ready for review",
  source_profile_approved: "Source Profile approval produced Campaign concepts",
  asset_uploaded: "Validated Campaign image uploaded",
  concept_approved: "Concept Approval produced a storyboard",
  storyboard_approved: "Storyboard Approval authorized production",
  correction_requested: "One targeted final correction requested",
  correction_rerendering: "Human authorized the targeted correction rerender",
  correction_completed: "Corrected Campaign passed quality gates and packaging",
} as const;

const artifactSummary = (artifact: Handoff["artifact"], snapshot: CampaignSnapshot) => {
  switch (artifact) {
    case "source_profile":
      return `${snapshot.sourceProfile!.productName} Source Profile is ready.`;
    case "brand_market_brief":
      return `${snapshot.brief!.productName} positioning brief is ready for ${snapshot.brief!.targetAudience}.`;
    case "concept_set":
      return `Creative directions proposed: ${snapshot.conceptSet!.concepts.map(({ title }) => title).join(", ")}.`;
    case "concept_approval": {
      const concept = snapshot.conceptSet!.concepts.find(({ id }) => id === snapshot.conceptApproval!.conceptId);
      return `${concept?.title ?? snapshot.conceptApproval!.conceptId} selected for Storyboard development.`;
    }
    case "storyboard":
      return "Storyboard is ready for approval.";
    case "storyboard_approval":
      return "Storyboard approved for final production.";
    case "render_manifest":
      return `${snapshot.renderManifest!.width}×${snapshot.renderManifest!.height} render completed at ${snapshot.renderManifest!.fps} FPS with required narration and timed captions.`;
    case "critic_report": {
      const scores = Object.values(snapshot.criticReport!.advisory);
      return `Quality review completed with advisory average ${(scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(1)}/5.`;
    }
    case "package_manifest":
      return `Required Campaign package completed${snapshot.packageManifest!.archivePath ? " and ready for download" : ""}.`;
    case "correction_request": {
      const request = snapshot.correction!.request!;
      return `Targeted correction requested for ${request.target.scope === "scene" ? request.target.sceneId : "the Campaign"}: ${request.requestedChange}`;
    }
    case "correction_authorization":
      return "Human authorized the single targeted correction rerender.";
  }
};

const artifactCounts = (artifact: Handoff["artifact"], snapshot: CampaignSnapshot) => {
  switch (artifact) {
    case "source_profile": return { pages: snapshot.sourceProfile!.pagesCrawled, assets: snapshot.sourceProfile!.assets.length, warnings: snapshot.sourceProfile!.warnings.length };
    case "brand_market_brief": return { evidenceItems: snapshot.brief!.evidenceBasis.items.length };
    case "concept_set": return { concepts: snapshot.conceptSet!.concepts.length };
    case "storyboard":
    case "storyboard_approval": return { scenes: snapshot.storyboard!.scenes.length };
    case "render_manifest": return { scenes: snapshot.storyboard!.scenes.length, captionWords: snapshot.renderManifest!.media.captions.words.length };
    case "critic_report": return { blockingFailures: snapshot.criticReport!.blockingFailures.length, advisoryNotes: snapshot.criticReport!.advisoryNotes.length };
    case "package_manifest": return { files: snapshot.packageManifest!.files.length };
    default: return undefined;
  }
};

const approvalSummary = (handoff: Handoff, snapshot: CampaignSnapshot) => {
  const artifact = handoff.artifact;
  if (artifact === "source_profile") return handoff.from === "human" ? "Source Profile approved." : "Source Profile review required.";
  if (artifact === "concept_approval" || artifact === "storyboard") {
    const direction = snapshot.conceptApproval?.direction ? ` Direction: ${snapshot.conceptApproval.direction}` : "";
    return `Concept ${snapshot.conceptApproval!.conceptId} approved.${direction}`;
  }
  if (["storyboard_approval", "render_manifest", "critic_report", "package_manifest"].includes(artifact)) return "Storyboard approved.";
  if (artifact === "correction_request") return `Final correction requested: ${snapshot.correction!.request!.reason}`;
  if (artifact === "correction_authorization") return "Final correction rerender explicitly authorized by the human approver.";
  return undefined;
};

const sanitized = (value: string | undefined) => {
  if (!value) return undefined;
  const compact = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
};

const collaborationPayload = (handoff: Handoff, snapshot: CampaignSnapshot): CollaborationPayload => collaborationPayloadSchema.parse({
  campaignId: sanitized(snapshot.id),
  campaignType: snapshot.configuration!.type,
  durationSeconds: snapshot.configuration!.durationSeconds,
  providerMode: snapshot.mode,
  sender: handoff.from,
  recipient: handoff.to,
  artifactType: handoff.artifact,
  summary: sanitized(artifactSummary(handoff.artifact, snapshot)),
  counts: artifactCounts(handoff.artifact, snapshot),
  approval: sanitized(approvalSummary(handoff, snapshot)),
});

export const createPersistedCampaignRuntime = async (
  repository: CampaignRepository,
  createWorkflow: (initialState?: CampaignSnapshot, campaignId?: string) => CampaignWorkflow,
  options: PersistedCampaignRuntimeOptions = {},
): Promise<PersistedCampaignRuntime> => {
  let workflow = createWorkflow(await repository.loadCurrent());
  let retryInFlight: Promise<CampaignEvent[]> | undefined;
  let taskRetryInFlight: Promise<CampaignEvent[]> | undefined;
  let stageRetryInFlight: Promise<CampaignSnapshot> | undefined;

  const appendSyncEvent = async (
    snapshot: CampaignSnapshot,
    key: string,
    handoff: Handoff,
    payload: CollaborationPayload,
    state: "syncing" | "completed" | "degraded" | "retrying",
    attempt: number,
    receipt?: CollaborationMirrorReceipt,
  ) => repository.appendEvent({
    campaignId: snapshot.id,
    type: "collaboration_sync",
    status: snapshot.status,
    providerMode: snapshot.mode,
    summary: state === "completed"
      ? `Band mirrored ${handoff.artifact}${receipt?.acknowledgmentState === "degraded" ? "; orchestration acknowledgment degraded" : ""}`
      : state === "degraded" ? `Band sync degraded for ${handoff.artifact}` : `Band ${state} ${handoff.artifact}`,
    artifact: handoff.artifact,
    collaboration: { provider: "band", key, state, attempt, handoff, payload, ...(receipt ? { receipt } : {}) },
  });

  const mirror = async (snapshot: CampaignSnapshot, key: string, handoff: Handoff, payload: CollaborationPayload, attempt: number, retry: boolean) => {
    await appendSyncEvent(snapshot, key, handoff, payload, retry ? "retrying" : "syncing", attempt);
    try {
      if (!options.collaboration) throw new Error("Band is not configured");
      const receipt = await options.collaboration.mirror(payload);
      return appendSyncEvent(snapshot, key, handoff, payload, "completed", attempt, receipt);
    } catch {
      return appendSyncEvent(snapshot, key, handoff, payload, "degraded", attempt);
    }
  };

  const appendBandTaskEvent = (snapshot: CampaignSnapshot, task: BandCampaignTask) => repository.appendEvent({
    campaignId: snapshot.id,
    type: "band_task_sync",
    status: snapshot.status,
    providerMode: snapshot.mode,
    summary: `Band task ${task.sync.state}: ${task.label}`,
    artifact: task.key,
    bandTask: task,
  });

  const observerRole = (task: BandCampaignTask) => task.owner.kind === "agent" ? task.owner.role : "creative_director" as const;

  const syncBandGoal = async (snapshot: CampaignSnapshot) => {
    if (!options.bandTasks?.syncGoal || !snapshot.configuration) return;
    const campaignType = snapshot.configuration.type === "feature_announcement" ? "Feature Announcement" : "Product Launch";
    const title = `LaunchReel ${campaignType} · ${snapshot.id}`;
    const summary = `Coordinate a ${snapshot.configuration.durationSeconds}-second ${campaignType} Campaign for ${snapshot.configuration.targetAudience}; complete approved production, objective review, and package delivery.`;
    try {
      await options.bandTasks.syncGoal({ title, summary });
      await repository.appendEvent({ campaignId: snapshot.id, type: "band_goal_sync", status: snapshot.status, providerMode: snapshot.mode, summary: "Band room goal synchronized" });
    } catch {
      await repository.appendEvent({ campaignId: snapshot.id, type: "band_goal_sync", status: snapshot.status, providerMode: snapshot.mode, summary: "Band room goal synchronization degraded" });
    }
  };

  const reconcileBandTasks = async (snapshot: CampaignSnapshot, eligible: Array<BandCampaignTask["sync"]["state"]> = ["pending"]) => {
    const planned = planBandCampaignTasks(snapshot);
    const results: CampaignEvent[] = [];
    for (const [index, plannedTask] of planned.entries()) {
      if (!eligible.includes(plannedTask.sync.state)) continue;
      let task = bandCampaignTaskSchema.parse({ ...plannedTask, sync: { ...plannedTask.sync, state: "syncing", attempt: plannedTask.sync.attempt + 1 } });
      planned[index] = task;
      snapshot.bandTasks = planned;
      await repository.saveCurrent(snapshot);
      results.push(await appendBandTaskEvent(snapshot, task));
      try {
        if (!options.bandTasks) throw new Error("Band task synchronization is not configured");
        const owner = observerRole(task);
        let identity = task.sync.bandTaskId ? {
          id: task.sync.bandTaskId,
          ...(task.sync.bandTaskNumber ? { number: task.sync.bandTaskNumber } : {}),
          ...(task.sync.bandAssignmentStatus ? { assignmentStatus: task.sync.bandAssignmentStatus } : {}),
        } : await options.bandTasks.findTask(snapshot.id, task.key, owner);
        if (!identity) identity = await options.bandTasks.createTask(task, owner);
        const status = toBandAssignmentStatus(task.sync.desiredState);
        if (task.owner.kind === "agent" && identity.assignmentStatus !== status) identity = await options.bandTasks.updateTask(task, identity, owner, status);
        task = bandCampaignTaskSchema.parse({
          ...task,
          state: task.sync.desiredState,
          sync: {
            ...task.sync,
            state: "completed",
            bandTaskId: identity.id,
            ...(identity.number ? { bandTaskNumber: identity.number } : {}),
            ...(task.owner.kind === "agent" ? { bandAssignmentStatus: status } : {}),
          },
        });
      } catch {
        task = bandCampaignTaskSchema.parse({ ...task, state: "degraded", sync: { ...task.sync, state: "degraded" } });
      }
      planned[index] = task;
      snapshot.bandTasks = planned;
      await repository.saveCurrent(snapshot);
      results.push(await appendBandTaskEvent(snapshot, task));
    }
    snapshot.bandTasks = planned;
    return results;
  };

  const recordHandoffs = async (before: CampaignSnapshot, snapshot: CampaignSnapshot) => {
    for (const [offset, handoff] of snapshot.handoffs.slice(before.handoffs.length).entries()) {
      const handoffIndex = before.handoffs.length + offset + 1;
      const key = `${snapshot.id}:handoff:${handoffIndex}`;
      const payload = collaborationPayload(handoff, snapshot);
      await repository.appendEvent({
        campaignId: snapshot.id,
        type: "handoff_recorded",
        status: snapshot.status,
        providerMode: snapshot.mode,
        summary: `${handoff.from} handed ${handoff.artifact} to ${handoff.to}`,
        artifact: handoff.artifact,
      });
      await mirror(snapshot, key, handoff, payload, 1, false);
    }
  };

  const commit = async (before: CampaignSnapshot, snapshot: CampaignSnapshot, type: keyof typeof operationSummary) => {
    await repository.saveCurrent(snapshot);
    await repository.appendEvent({ campaignId: snapshot.id, type, status: snapshot.status, providerMode: snapshot.mode, summary: operationSummary[type] });
    if (snapshot.status === "completed" && type !== "correction_completed") {
      await repository.appendEvent({ campaignId: snapshot.id, type: "campaign_completed", status: snapshot.status, providerMode: snapshot.mode, summary: "Campaign package completed" });
    }
    await recordHandoffs(before, snapshot);
    snapshot.bandTasks = planBandCampaignTasks(snapshot);
    await repository.saveCurrent(snapshot);
    if (options.bandTasks) {
      await syncBandGoal(snapshot);
      await reconcileBandTasks(snapshot);
    }
    if (options.bandTasks) workflow = createWorkflow(snapshot, snapshot.id);
    if (snapshot.status === "completed") await repository.retainCompleted(snapshot);
    return snapshot;
  };

  const persistFailure = async (before: CampaignSnapshot, error: unknown) => {
    const failed = workflow.snapshot();
    if (failed.status !== "workflow_failed" && failed.status !== "production_failed") throw error;
    failed.bandTasks = planBandCampaignTasks(failed);
    await repository.saveCurrent(failed);
    await recordHandoffs(before, failed);
    if (options.bandTasks) {
      await syncBandGoal(failed);
      await reconcileBandTasks(failed);
    }
    if (options.bandTasks) workflow = createWorkflow(failed, failed.id);
    await repository.appendEvent({
      campaignId: failed.id,
      type: "campaign_failed",
      status: failed.status,
      providerMode: failed.mode,
      summary: failed.failure?.message ?? failed.productionFailure?.message ?? "Campaign stage failed",
    });
    throw error;
  };

  const operation = async (type: keyof typeof operationSummary, run: () => Promise<CampaignSnapshot>) => {
    const before = workflow.snapshot();
    try {
      return await commit(before, await run(), type);
    } catch (error) {
      return persistFailure(before, error);
    }
  };

  const retryCollaboration = () => retryInFlight ??= (async () => {
    try {
      const snapshot = workflow.snapshot();
      const latest = new Map<string, CampaignEvent>();
      for (const event of await repository.eventsAfter(0)) if (event.collaboration) latest.set(event.collaboration.key, event);
      const incomplete = [...latest.values()].filter((event) => event.collaboration?.state === "degraded" || (
        event.collaboration?.receipt?.acknowledgmentState === "degraded"
        && event.collaboration.payload.sender !== "human"
        && event.collaboration.payload.recipient !== "human"
        && Boolean(options.collaboration?.acknowledge)
      ));
      const results: CampaignEvent[] = [];
      for (const event of incomplete) {
        const sync = event.collaboration!;
        if (sync.state === "degraded") {
          results.push(await mirror(snapshot, sync.key, sync.handoff, sync.payload, sync.attempt + 1, true));
          continue;
        }
        await appendSyncEvent(snapshot, sync.key, sync.handoff, sync.payload, "retrying", sync.attempt + 1, sync.receipt);
        try {
          if (!options.collaboration?.acknowledge || !sync.receipt?.originalResponseId) throw new Error("Band acknowledgment retry is unavailable");
          const receipt = sync.receipt;
          const acknowledgmentResponseId = await options.collaboration.acknowledge(sync.payload);
          results.push(await appendSyncEvent(snapshot, sync.key, sync.handoff, sync.payload, "completed", sync.attempt + 1, {
            ...receipt,
            acknowledgmentState: "completed",
            ...(acknowledgmentResponseId ? { acknowledgmentResponseId } : {}),
          }));
        } catch {
          results.push(await appendSyncEvent(snapshot, sync.key, sync.handoff, sync.payload, "completed", sync.attempt + 1, { ...sync.receipt!, acknowledgmentState: "degraded" }));
        }
      }
      return results;
    } finally {
      retryInFlight = undefined;
    }
  })();

  const retryBandTasks = () => taskRetryInFlight ??= (async () => {
    try {
      const snapshot = workflow.snapshot();
      await syncBandGoal(snapshot);
      const results = await reconcileBandTasks(snapshot, ["pending", "syncing", "degraded"]);
      workflow = createWorkflow(snapshot, snapshot.id);
      return results;
    } finally {
      taskRetryInFlight = undefined;
    }
  })();

  const retry = () => stageRetryInFlight ??= (async () => {
    try {
      const before = workflow.snapshot();
      try {
        const snapshot = await workflow.retry();
        const eventType = snapshot.status === "awaiting_source_profile" ? "campaign_started"
          : snapshot.status === "awaiting_concept_approval" ? "source_profile_approved"
            : snapshot.status === "awaiting_storyboard_approval" ? "concept_approved"
              : snapshot.correction?.state === "corrected_complete" ? "correction_completed" : "storyboard_approved";
        return await commit(before, snapshot, eventType);
      } catch (error) {
        return persistFailure(before, error);
      }
    } finally {
      stageRetryInFlight = undefined;
    }
  })();

  return {
    async start(input) {
      if (workflow.snapshot().status === "completed") {
        const completed = workflow.snapshot();
        await repository.clearCurrent();
        const id = options.campaignId?.(completed.mode) ?? `campaign-${completed.mode}-${randomUUID()}`;
        workflow = createWorkflow(undefined, id);
      }
      return operation("campaign_started", () => workflow.start(input));
    },
    approveSourceProfile: (input) => operation("source_profile_approved", () => workflow.approveSourceProfile(input)),
    registerUploadedAsset: (input) => operation("asset_uploaded", () => workflow.registerUploadedAsset(input)),
    approveConcept: (input) => operation("concept_approved", () => workflow.approveConcept(input)),
    approveStoryboard: (input) => operation("storyboard_approved", () => workflow.approveStoryboard(input)),
    retry,
    async requestCorrection(input) {
      const before = workflow.snapshot();
      return commit(before, await workflow.requestCorrection(input), "correction_requested");
    },
    async authorizeCorrection() {
      const before = workflow.snapshot();
      const correction = workflow.authorizeCorrection();
      const rerendering = workflow.snapshot();
      if (rerendering.status !== "rerendering") return correction;
      await repository.saveCurrent(rerendering);
      await repository.appendEvent({
        campaignId: rerendering.id,
        type: "correction_rerendering",
        status: rerendering.status,
        providerMode: rerendering.mode,
        summary: operationSummary.correction_rerendering,
      });
      await recordHandoffs(before, rerendering);
      try {
        return commit(rerendering, await correction, "correction_completed");
      } catch (error) {
        return persistFailure(rerendering, error);
      }
    },
    snapshot: () => workflow.snapshot(),
    async reset() {
      const current = workflow.snapshot();
      if (current.status !== "idle") await repository.deleteCampaign(current.id);
      workflow = createWorkflow();
      return workflow.snapshot();
    },
    eventsAfter: (sequence) => repository.eventsAfter(sequence),
    subscribe: (listener) => repository.subscribe(listener),
    retryCollaboration,
    retryBandTasks,
    bandTasks: () => workflow.snapshot().bandTasks ?? [],
    collaborationRoomUrl: () => options.collaborationRoomUrl,
    history: () => repository.listCompleted(),
    completedCampaign: (campaignId) => repository.loadCompleted(campaignId),
    async deleteCampaign(campaignId) {
      await repository.deleteCampaign(campaignId);
      if (workflow.snapshot().id === campaignId) workflow = createWorkflow();
      return workflow.snapshot();
    },
  };
};
