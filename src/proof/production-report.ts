import type { AgentRole } from "../contracts";
import type { CampaignEvent } from "../persistence";
import type { CampaignSnapshot } from "../workflow";

const agentRoles: AgentRole[] = ["brand_market_analyst", "creative_director", "video_producer", "creative_critic"];
const requiredPackageFiles = ["campaign.mp4", "thumbnail.jpg", "caption.txt", "cta-variants.txt", "citations.json", "critic-report.json", "provenance.json"] as const;

const roleNames: Record<AgentRole, string> = {
  brand_market_analyst: "Brand and Market Analyst",
  creative_director: "Creative Director",
  video_producer: "Video Producer",
  creative_critic: "Creative Critic",
};

const bandAgentNames: Record<AgentRole, string> = {
  brand_market_analyst: "LaunchReel Analyst",
  creative_director: "LaunchReel Creative Director",
  video_producer: "LaunchReel Video Producer",
  creative_critic: "LaunchReel Creative Critic",
};

const sensitiveValue = /(?:api[-_ ]?key|authorization|bearer|credential|password|secret|access[-_ ]?token)\s*[:=]/i;
const absolutePath = /^(?:[a-z]:[\\/]|\\\\|\/(?:users|home|var|tmp|private|opt|srv)\/|file:)/i;
const sensitiveQueryKey = /(?:api[-_]?key|auth|credential|password|secret|signature|token)/i;
const privateHost = /^(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|0\.0\.0\.0|\[?::1\]?)$/i;

const safeLabel = (value: string | undefined, fallback = "Not recorded") => {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized || absolutePath.test(normalized) || sensitiveValue.test(normalized)) return fallback;
  return normalized.slice(0, 240);
};

const safePublicUrl = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || privateHost.test(url.hostname)) return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQueryKey.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const eventTime = (events: CampaignEvent[], type: CampaignEvent["type"]) => events.find((event) => event.type === type)?.occurredAt;
const latestBandEvents = (events: CampaignEvent[]) => {
  const latest = new Map<string, CampaignEvent>();
  for (const event of events) {
    if (event.collaboration?.provider === "band") latest.set(event.collaboration.key, event);
  }
  return [...latest.values()].sort((left, right) => left.sequence - right.sequence);
};

export type BandBoardState = "configuring" | "syncing" | "active" | "completed" | "degraded" | "retrying";
export type BandTaskState = Exclude<BandBoardState, "configuring"> | "configuring";

export interface BandProductionBoard {
  goal: string;
  state: BandBoardState;
  counts: { total: number; completed: number; incomplete: number };
  room?: { label: string; url: string };
  agents: Array<{ role: string; name: string }>;
  tasks: Array<{
    key: string;
    label: string;
    owner: string;
    humanBoundary: boolean;
    localState: "queued" | "active" | "completed" | "degraded" | "failed";
    syncState: "pending" | "syncing" | "completed" | "degraded";
    attempt: number;
    bandTaskId?: string;
  }>;
  handoffs: Array<{
    artifact: string;
    sender: string;
    recipient: string;
    humanBoundary: boolean;
    approval: string;
    syncState: BandTaskState;
    originalReceipt?: { sequence: number; occurredAt: string };
    messageReceipt?: string;
    acknowledgementReceipt?: string;
  }>;
  degradedDisclosure?: string;
}

const participantName = (value: string) => value === "human"
  ? "Human Approver"
  : bandAgentNames[value as AgentRole] ?? safeLabel(value.replaceAll("_", " "));

export const deriveBandProductionBoard = ({ snapshot, events = [], bandRoomUrl }: ProductionProofInput): BandProductionBoard => {
  const bandEvents = latestBandEvents(events);
  const roomUrl = safePublicUrl(bandRoomUrl);
  const records = new Map(bandEvents.map((event) => {
    const handoff = event.collaboration!.handoff;
    return [`${handoff.artifact}:${handoff.from}:${handoff.to}`, event];
  }));
  const handoffEvents = events.filter(({ type }) => type === "handoff_recorded");
  const handoffs = [...snapshot.handoffs];
  for (const event of bandEvents) {
    const handoff = event.collaboration!.handoff;
    if (!handoffs.some((candidate) => candidate.artifact === handoff.artifact && candidate.from === handoff.from && candidate.to === handoff.to)) handoffs.push(handoff);
  }
  const tasks = (snapshot.bandTasks ?? []).map((task) => ({
    key: task.key,
    label: safeLabel(task.label),
    owner: task.owner.kind === "agent" ? bandAgentNames[task.owner.role] : "Human approval boundary",
    humanBoundary: task.owner.kind === "human_boundary",
    localState: task.state,
    syncState: task.sync.state,
    attempt: task.sync.attempt,
    ...(task.sync.bandTaskId ? { bandTaskId: safeLabel(task.sync.bandTaskId) } : {}),
  }));
  const handoffRecords = handoffs.map((handoff) => {
    const event = records.get(`${handoff.artifact}:${handoff.from}:${handoff.to}`);
    const collaboration = event?.collaboration;
    const snapshotIndex = snapshot.handoffs.indexOf(handoff);
    const original = handoffEvents.find(({ artifact }) => artifact === handoff.artifact) ?? (snapshotIndex >= 0 ? handoffEvents[snapshotIndex] : undefined);
    return {
      artifact: safeLabel(handoff.artifact.replaceAll("_", " ")),
      sender: participantName(handoff.from),
      recipient: participantName(handoff.to),
      humanBoundary: handoff.from === "human" || handoff.to === "human",
      approval: collaboration?.payload.approval ? safeLabel(collaboration.payload.approval) : handoff.from === "human" ? "Human approval recorded locally" : handoff.to === "human" ? "Human decision requested" : "Not required",
      syncState: (collaboration?.state ?? (original ? "active" : "configuring")) as BandTaskState,
      ...(original ? { originalReceipt: { sequence: original.sequence, occurredAt: original.occurredAt } } : {}),
      ...(collaboration?.receipt?.originalResponseId ? { messageReceipt: safeLabel(collaboration.receipt.originalResponseId) } : {}),
      ...(collaboration?.receipt?.acknowledgmentResponseId ? { acknowledgementReceipt: safeLabel(collaboration.receipt.acknowledgmentResponseId) } : {}),
    };
  });
  const completed = tasks.filter(({ localState, syncState }) => localState === "completed" && syncState === "completed").length;
  const incomplete = tasks.length - completed;
  const state: BandBoardState = tasks.some(({ syncState }) => syncState === "degraded") || handoffRecords.some(({ syncState }) => syncState === "degraded")
    ? "degraded"
    : handoffRecords.some(({ syncState }) => syncState === "retrying")
      ? "retrying"
      : tasks.some(({ syncState }) => syncState === "syncing") || handoffRecords.some(({ syncState }) => syncState === "syncing")
        ? "syncing"
        : snapshot.status === "completed" && tasks.length > 0 && incomplete === 0
          ? "completed"
          : tasks.length || handoffRecords.length
            ? "active"
            : "configuring";
  const campaignType = snapshot.configuration?.type === "feature_announcement" ? "feature announcement" : "product launch";
  const duration = snapshot.configuration ? `${snapshot.configuration.durationSeconds}-second ` : "";
  const audience = safeLabel(snapshot.configuration?.targetAudience, "the approved audience");

  return {
    goal: `Coordinate a ${duration}${campaignType} for ${audience}.`,
    state,
    counts: { total: tasks.length, completed, incomplete },
    ...(roomUrl ? { room: { label: `Shared room · ${new URL(roomUrl).hostname}`, url: roomUrl } } : {}),
    agents: agentRoles.map((role) => ({ role: roleNames[role], name: bandAgentNames[role] })),
    tasks,
    handoffs: handoffRecords,
    ...(state === "degraded" ? { degradedDisclosure: "Band sync is degraded. Local persisted work remains authoritative; incomplete operations may be retried without replaying completed mirrors." } : {}),
  };
};

export interface ProductionProofReport {
  schemaVersion: "launchreel.production-proof.v1";
  campaign: {
    id: string;
    type: "Product Launch" | "Feature Announcement";
    durationSeconds: number;
    providerMode: "fixture" | "live" | "cached";
    status: "completed";
    startedAt?: string;
    completedAt?: string;
    elapsedMilliseconds?: number;
    approvals: Array<{ name: string; occurredAt?: string }>;
    handoffs: Array<{ from: string; to: string; artifact: string; occurredAt?: string }>;
  };
  tokenRouter: {
    agents: Array<{
      role: string;
      modelIds: string[];
      modelProfiles: string[];
      promptVersions: string[];
      providerModes: Array<"fixture" | "live" | "cached">;
      validation: "passed" | "failed" | "not recorded";
      runCount: number;
      startedAt?: string;
      completedAt?: string;
      inputTokens?: number;
      outputTokens?: number;
    }>;
  };
  you: {
    state: "completed" | "degraded" | "website-only fallback" | "fixture" | "not recorded";
    evidenceMode: "external research" | "Source Website only";
    intents: string[];
    queryCount: number;
    citedFindingCount: number;
    originals: Array<{ title: string; url: string }>;
  };
  band: BandProductionBoard;
  deepgram: {
    state: "completed" | "fixture" | "not recorded";
    narrationRequired: boolean;
    ttsModel?: string;
    captionTimingModel?: string;
    captionTiming: "word-level" | "not recorded";
    timedWordCount: number;
  };
  remotion: {
    state: "live" | "fixture" | "cached" | "not recorded";
    compositionId?: string;
    width?: number;
    height?: number;
    fps?: number;
    frameCount?: number;
    durationSeconds?: number;
    codecs?: string[];
  };
  package: {
    inventory: string[];
    citationCount: number;
    provenancePresent: boolean;
    validation: "passed" | "failed";
  };
}

export interface ProductionProofInput {
  snapshot: CampaignSnapshot;
  events?: CampaignEvent[];
  bandRoomUrl?: string;
}

export const deriveProductionProof = ({ snapshot, events = [], bandRoomUrl }: ProductionProofInput): ProductionProofReport => {
  if (snapshot.status !== "completed" || !snapshot.configuration || !snapshot.packageManifest) {
    throw new Error("Production Proof requires a completed persisted Campaign");
  }

  const startedAt = eventTime(events, "campaign_started");
  const completedAt = eventTime(events, "campaign_completed");
  const startMilliseconds = startedAt ? Date.parse(startedAt) : Number.NaN;
  const completedMilliseconds = completedAt ? Date.parse(completedAt) : Number.NaN;
  const handoffEvents = events.filter(({ type }) => type === "handoff_recorded");
  const tokenAgents = agentRoles.map((role) => {
    const runs = snapshot.agentRuns.filter((run) => run.role === role);
    const inputTokens = runs.reduce((total, run) => total + (run.inputTokens ?? 0), 0);
    const outputTokens = runs.reduce((total, run) => total + (run.outputTokens ?? 0), 0);
    const startedAt = runs.find((run) => run.startedAt)?.startedAt;
    const completedAt = [...runs].reverse().find((run) => run.completedAt)?.completedAt;
    return {
      role: roleNames[role],
      modelIds: [...new Set(runs.flatMap(({ modelId }) => modelId ? [safeLabel(modelId)] : []))],
      modelProfiles: [...new Set(runs.flatMap(({ modelProfile }) => modelProfile ? [safeLabel(modelProfile)] : []))],
      promptVersions: [...new Set(runs.flatMap(({ promptVersion }) => promptVersion ? [safeLabel(promptVersion)] : []))],
      providerModes: [...new Set(runs.map(({ providerMode }) => providerMode))],
      validation: !runs.length ? "not recorded" as const : runs.some(({ validation }) => validation === "failed") ? "failed" as const : "passed" as const,
      runCount: runs.length,
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(runs.some(({ inputTokens }) => inputTokens !== undefined) ? { inputTokens } : {}),
      ...(runs.some(({ outputTokens }) => outputTokens !== undefined) ? { outputTokens } : {}),
    };
  });

  const youCalls = snapshot.agentRuns.flatMap(({ toolCalls = [] }) => toolCalls.filter(({ provider }) => provider === "you"));
  const externalEvidence = snapshot.brief?.evidenceBasis.items.filter(({ sourceKind }) => sourceKind === "external_research") ?? [];
  const intents = [...new Set(youCalls.map(({ operation }) => operation.startsWith("search:") ? operation.slice(7).replaceAll("_", " ") : operation))];
  const originals = externalEvidence.flatMap(({ title, sourceUrl }) => {
    const url = safePublicUrl(sourceUrl);
    return url ? [{ title: safeLabel(title, new URL(url).hostname), url }] : [];
  });
  const youState = snapshot.brief?.evidenceBasis.mode === "website_grounded_only"
    ? "website-only fallback" as const
    : youCalls.some(({ status }) => status !== "completed")
      ? "degraded" as const
      : snapshot.mode === "fixture" ? "fixture" as const : externalEvidence.length ? "completed" as const : "not recorded" as const;

  const band = deriveBandProductionBoard({ snapshot, events, bandRoomUrl });

  const media = snapshot.renderManifest?.media;
  const narrationProvider = media?.narration.provider;
  const inventory = snapshot.packageManifest.files.map((file) => safeLabel(file));
  const exactInventory = inventory.length === requiredPackageFiles.length
    && new Set(inventory).size === requiredPackageFiles.length
    && requiredPackageFiles.every((file) => inventory.includes(file));

  return {
    schemaVersion: "launchreel.production-proof.v1",
    campaign: {
      id: safeLabel(snapshot.id),
      type: snapshot.configuration.type === "feature_announcement" ? "Feature Announcement" : "Product Launch",
      durationSeconds: snapshot.configuration.durationSeconds,
      providerMode: snapshot.mode,
      status: "completed",
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(Number.isFinite(startMilliseconds) && Number.isFinite(completedMilliseconds) && completedMilliseconds >= startMilliseconds
        ? { elapsedMilliseconds: completedMilliseconds - startMilliseconds }
        : {}),
      approvals: [
        { name: "Source Profile Approval", occurredAt: eventTime(events, "source_profile_approved") },
        { name: "Concept Approval", occurredAt: eventTime(events, "concept_approved") },
        { name: "Storyboard Approval", occurredAt: eventTime(events, "storyboard_approved") },
      ].map(({ name, occurredAt }) => ({ name, ...(occurredAt ? { occurredAt } : {}) })),
      handoffs: snapshot.handoffs.map((handoff, index) => ({
        from: safeLabel(handoff.from.replaceAll("_", " ")),
        to: safeLabel(handoff.to.replaceAll("_", " ")),
        artifact: safeLabel(handoff.artifact.replaceAll("_", " ")),
        ...(handoffEvents[index]?.occurredAt ? { occurredAt: handoffEvents[index].occurredAt } : {}),
      })),
    },
    tokenRouter: { agents: tokenAgents },
    you: {
      state: youState,
      evidenceMode: snapshot.brief?.evidenceBasis.mode === "external_research" ? "external research" : "Source Website only",
      intents,
      queryCount: youCalls.length,
      citedFindingCount: externalEvidence.length,
      originals,
    },
    band,
    deepgram: {
      state: narrationProvider === "deepgram" ? "completed" : narrationProvider === "fixture" ? "fixture" : "not recorded",
      narrationRequired: media?.narration.required ?? false,
      ...(media?.narration.model ? { ttsModel: safeLabel(media.narration.model) } : {}),
      ...(media?.captions.model ? { captionTimingModel: safeLabel(media.captions.model) } : {}),
      captionTiming: media?.captions.words.length ? "word-level" : "not recorded",
      timedWordCount: media?.captions.words.length ?? 0,
    },
    remotion: snapshot.renderManifest ? {
      state: snapshot.renderManifest.providerMode,
      compositionId: safeLabel(snapshot.renderManifest.compositionId),
      width: snapshot.renderManifest.width,
      height: snapshot.renderManifest.height,
      fps: snapshot.renderManifest.fps,
      frameCount: snapshot.renderManifest.durationSeconds * snapshot.renderManifest.fps,
      durationSeconds: snapshot.renderManifest.durationSeconds,
    } : { state: "not recorded" },
    package: {
      inventory,
      citationCount: snapshot.brief?.evidenceBasis.items.length ?? 0,
      provenancePresent: inventory.includes("provenance.json"),
      validation: exactInventory && inventory.includes("provenance.json") ? "passed" : "failed",
    },
  };
};

export const serializeProductionProof = (input: ProductionProofInput) => `${JSON.stringify(deriveProductionProof(input), null, 2)}\n`;
