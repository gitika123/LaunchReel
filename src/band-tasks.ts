import {
  bandCampaignTaskSchema,
  bandTaskAssignmentStatusSchema,
  type AgentRole,
  type BandCampaignTask,
  type BandCampaignTaskKey,
  type BandCampaignTaskState,
  type BandTaskAssignmentStatus,
} from "./contracts";
import type { CampaignSnapshot, CampaignStatus } from "./workflow";

const definitions: ReadonlyArray<Pick<BandCampaignTask, "key" | "label" | "owner" | "stage">> = [
  { key: "source_profile_ingestion", label: "Source Profile ingestion", owner: { kind: "agent", role: "brand_market_analyst" }, stage: "ingestion" },
  { key: "market_research", label: "Market research", owner: { kind: "agent", role: "brand_market_analyst" }, stage: "research" },
  { key: "brand_market_brief", label: "BrandMarketBrief", owner: { kind: "agent", role: "brand_market_analyst" }, stage: "strategy" },
  { key: "creative_concept_set", label: "CreativeConceptSet", owner: { kind: "agent", role: "creative_director" }, stage: "creative" },
  { key: "concept_approval", label: "Concept Approval", owner: { kind: "human_boundary", assignment: "agent_observed" }, stage: "approval" },
  { key: "storyboard", label: "Storyboard", owner: { kind: "agent", role: "creative_director" }, stage: "creative" },
  { key: "storyboard_approval", label: "Storyboard Approval", owner: { kind: "human_boundary", assignment: "agent_observed" }, stage: "approval" },
  { key: "narration_and_captions", label: "Narration and captions", owner: { kind: "agent", role: "video_producer" }, stage: "production" },
  { key: "video_render", label: "Video render", owner: { kind: "agent", role: "video_producer" }, stage: "production" },
  { key: "critic_review", label: "Critic review", owner: { kind: "agent", role: "creative_critic" }, stage: "review" },
  { key: "targeted_correction", label: "Targeted correction", owner: { kind: "agent", role: "video_producer" }, stage: "correction" },
  { key: "campaign_package", label: "Campaign package", owner: { kind: "agent", role: "video_producer" }, stage: "delivery" },
];

const activeKeys: Partial<Record<CampaignStatus, BandCampaignTaskKey[]>> = {
  awaiting_concept_approval: ["concept_approval"],
  awaiting_storyboard_approval: ["storyboard_approval"],
  correction_requested: ["targeted_correction"],
  rerendering: ["targeted_correction"],
};

const completed = (key: BandCampaignTaskKey, snapshot: CampaignSnapshot) => {
  const correctionInProgress = Boolean(snapshot.correction?.request && snapshot.correction.state !== "corrected_complete");
  switch (key) {
    case "source_profile_ingestion": return Boolean(snapshot.sourceProfile);
    case "market_research":
    case "brand_market_brief": return Boolean(snapshot.brief);
    case "creative_concept_set": return Boolean(snapshot.conceptSet);
    case "concept_approval": return Boolean(snapshot.conceptApproval);
    case "storyboard": return Boolean(snapshot.storyboard);
    case "storyboard_approval": return Boolean(snapshot.renderManifest);
    case "narration_and_captions":
    case "video_render": return Boolean(snapshot.renderManifest) && !correctionInProgress;
    case "critic_review": return Boolean(snapshot.criticReport) && !correctionInProgress;
    case "targeted_correction": return snapshot.correction?.state === "corrected_complete";
    case "campaign_package": return Boolean(snapshot.packageManifest) && !correctionInProgress;
  }
};

const desiredState = (key: BandCampaignTaskKey, snapshot: CampaignSnapshot): BandCampaignTaskState => {
  if (completed(key, snapshot)) return "completed";
  if (snapshot.failure && ((key === "source_profile_ingestion" && snapshot.failure.operation === "source_profile")
    || (["market_research", "brand_market_brief", "creative_concept_set"].includes(key) && snapshot.failure.operation === "concepts")
    || (key === "storyboard" && snapshot.failure.operation === "storyboard")
    || (["narration_and_captions", "video_render", "targeted_correction"].includes(key) && snapshot.failure.operation === "production")
    || (key === "critic_review" && snapshot.failure.operation === "critic")
    || (key === "campaign_package" && snapshot.failure.operation === "package"))) return "failed";
  return activeKeys[snapshot.status]?.includes(key) ? "active" : "queued";
};

export const planBandCampaignTasks = (snapshot: CampaignSnapshot): BandCampaignTask[] => {
  const previous = new Map((snapshot.bandTasks ?? []).map((task) => [task.key, task]));
  return definitions
    .filter(({ key }) => key !== "targeted_correction" || Boolean(snapshot.correction?.request))
    .map((definition) => {
      const state = desiredState(definition.key, snapshot);
      const existing = previous.get(definition.key);
      return bandCampaignTaskSchema.parse({
        ...definition,
        campaignId: snapshot.id,
        state: existing?.state === "degraded" && existing.sync.desiredState === state ? "degraded" : state,
        sync: existing
          ? { ...existing.sync, state: existing.sync.desiredState === state ? existing.sync.state : "pending", desiredState: state }
          : { state: "pending", attempt: 0, desiredState: state },
      });
    });
};

export const toBandAssignmentStatus = (state: BandCampaignTaskState): BandTaskAssignmentStatus => bandTaskAssignmentStatusSchema.parse({
  queued: "pending",
  active: "in_progress",
  completed: "completed",
  degraded: "blocked",
  failed: "failed",
}[state]);

export interface BandTaskIdentity {
  id: string;
  number?: number;
  assignmentStatus?: BandTaskAssignmentStatus;
}

export interface BandTaskProvider {
  syncGoal?(goal: { title: string; summary: string }): Promise<void>;
  findTask(campaignId: string, key: BandCampaignTaskKey, owner: AgentRole): Promise<BandTaskIdentity | undefined>;
  createTask(task: BandCampaignTask, owner: AgentRole): Promise<BandTaskIdentity>;
  updateTask(task: BandCampaignTask, identity: BandTaskIdentity, owner: AgentRole, status: BandTaskAssignmentStatus): Promise<BandTaskIdentity>;
}
