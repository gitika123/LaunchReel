import { z } from "zod";
import { assetProvenanceSchema, visualContentRoleSchema } from "./source-assets";
export { sourceProfileSchema } from "./source-profile";

export const providerModeSchema = z.enum(["fixture", "live", "cached"]);
export const agentRoleSchema = z.enum([
  "brand_market_analyst",
  "creative_director",
  "video_producer",
  "creative_critic",
]);

export const toolCallSchema = z.object({
  provider: z.enum(["token_router", "you", "deepgram", "band", "remotion", "filesystem"]),
  operation: z.string().min(1),
  status: z.enum(["completed", "degraded", "failed"]),
  summary: z.string().min(1),
  resultCount: z.number().int().nonnegative().optional(),
  degradation: z.string().min(1).optional(),
  searchId: z.string().min(1).optional(),
  providerLatency: z.number().nonnegative().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
}).strict();

export const agentRunSchema = z.object({
  role: agentRoleSchema,
  providerMode: providerModeSchema,
  validation: z.enum(["passed", "failed"]),
  modelProfile: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  promptVersion: z.string().min(1).optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  toolCalls: z.array(toolCallSchema).optional(),
}).strict();

export const campaignDurationSecondsSchema = z.union([z.literal(30), z.literal(60)]);
export const campaignTypeSchema = z.enum(["product_launch", "feature_announcement"]);
const publicPageUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
}, "Must be a public HTTP or HTTPS address without credentials");

const campaignConfigurationBase = {
  targetAudience: z.string().trim().min(1),
  durationSeconds: campaignDurationSecondsSchema,
  sourceWebsite: publicPageUrlSchema,
};

export const campaignConfigurationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("product_launch"),
    ...campaignConfigurationBase,
  }).strict(),
  z.object({
    type: z.literal("feature_announcement"),
    ...campaignConfigurationBase,
    featureName: z.string().trim().min(1),
    featureDescription: z.string().trim().min(1),
    featurePageUrl: publicPageUrlSchema,
  }).strict(),
]);

export const researchIntentSchema = z.enum([
  "audience_pain_points",
  "category_market_language",
  "competitor_positioning",
  "launch_hooks_current_signals",
]);

export const evidenceItemSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  sourceUrl: z.string().url(),
  sourceKind: z.enum(["source_website", "external_research"]),
  title: z.string().min(1).optional(),
  researchIntents: z.array(researchIntentSchema).min(1).optional(),
  searchId: z.string().min(1).optional(),
  providerLatency: z.number().nonnegative().optional(),
}).strict().superRefine((item, context) => {
  if (item.sourceKind === "external_research" && !item.researchIntents?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "External research must retain its research intent", path: ["researchIntents"] });
  }
  if (item.sourceKind === "source_website" && (item.researchIntents || item.searchId || item.providerLatency !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Source Website evidence cannot carry external search metadata" });
  }
});

export const brandMarketBriefSchema = z.object({
  saasCompany: z.string().min(1),
  productName: z.string().min(1),
  targetAudience: z.string().min(1),
  positioning: z.string().min(1),
  evidenceBasis: z.object({
    mode: z.enum(["website_grounded_only", "external_research"]),
    claimScope: z.enum(["source_website_only", "source_and_external"]),
    items: z.array(evidenceItemSchema).min(1),
  }).strict().superRefine(({ mode, claimScope, items }, context) => {
    const hasExternalResearch = items.some(({ sourceKind }) => sourceKind === "external_research");
    if (mode === "external_research" !== hasExternalResearch) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Evidence Basis mode must match retained external research", path: ["mode"] });
    }
    if ((mode === "website_grounded_only") !== (claimScope === "source_website_only")) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Website-only evidence must prohibit unsupported market claims", path: ["claimScope"] });
    }
  }),
}).strict();

export const conceptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  hook: z.string().min(1),
  message: z.string().min(1),
  emotionalDirection: z.string().min(1),
  visualMetaphor: z.string().min(1),
  cta: z.string().min(1),
  evidenceSourceIds: z.array(z.string().min(1)).min(1),
}).strict();

export const conceptSetSchema = z.object({
  concepts: z.array(conceptSchema).length(3),
}).strict();

export const conceptApprovalSchema = z.object({
  conceptId: z.string().min(1),
  direction: z.string().trim().max(1000).optional(),
}).strict();

export const storyboardApprovalSchema = z.object({
  approved: z.literal(true),
  storyboard: z.lazy(() => storyboardSchema).optional(),
}).strict();

export const sceneSchema = z.object({
  id: z.string().min(1),
  durationSeconds: z.number().int().min(2),
  narration: z.string().min(1).max(500),
  overlayText: z.string().min(1).max(120),
  visual: z.object({
    kind: assetProvenanceSchema,
    uri: z.string().min(1),
    assetId: z.string().min(1).optional(),
    contentRole: visualContentRoleSchema.optional(),
  }).strict(),
}).strict();

export const storyboardSchema = z.object({
  durationSeconds: campaignDurationSecondsSchema,
  scenes: z.array(sceneSchema),
}).strict().superRefine(({ durationSeconds, scenes }, context) => {
  const [minimumScenes, maximumScenes] = durationSeconds === 30 ? [4, 8] : [7, 14];
  if (scenes.length < minimumScenes || scenes.length > maximumScenes) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${durationSeconds}-second Campaigns require ${minimumScenes}–${maximumScenes} scenes`, path: ["scenes"] });
  }
  if (scenes.reduce((total, scene) => total + scene.durationSeconds, 0) !== durationSeconds) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Scene durations must sum exactly to Campaign duration", path: ["scenes"] });
  }
});

export const captionWordSchema = z.object({
  word: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
}).strict().refine(({ startSeconds, endSeconds }) => endSeconds > startSeconds, "Caption word end must follow its start");

export const mediaProductionSchema = z.object({
  durationSeconds: campaignDurationSecondsSchema,
  narration: z.object({
    required: z.literal(true),
    path: z.string().min(1),
    provider: z.enum(["deepgram", "fixture"]),
    model: z.string().min(1),
  }).strict(),
  captions: z.object({
    provider: z.enum(["deepgram", "fixture"]),
    model: z.string().min(1),
    words: z.array(captionWordSchema).min(1),
  }).strict(),
  music: z.object({
    path: z.string().min(1),
    provider: z.enum(["lyria", "fixture"]),
    origin: z.enum(["generated", "licensed"]),
    title: z.string().min(1),
    creator: z.string().min(1),
    license: z.string().min(1),
    sourceUrl: z.string().url(),
  }).strict(),
}).strict().superRefine(({ durationSeconds, captions }, context) => {
  let cursor = 0;
  for (const [index, word] of captions.words.entries()) {
    if (word.startSeconds < cursor || word.endSeconds > durationSeconds) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Caption words must be ordered within the Campaign duration", path: ["captions", "words", index] });
    }
    cursor = word.endSeconds;
  }
});

export const renderManifestSchema = z.object({
  campaignId: z.string().min(1),
  campaignType: campaignTypeSchema,
  width: z.literal(1080),
  height: z.literal(1920),
  fps: z.literal(30),
  durationSeconds: campaignDurationSecondsSchema,
  videoPath: z.string().min(1),
  thumbnailPath: z.string().min(1),
  compositionId: z.literal("LaunchReelProductLaunch"),
  providerMode: providerModeSchema,
  media: mediaProductionSchema,
}).strict().superRefine(({ durationSeconds, media }, context) => {
  if (media.durationSeconds !== durationSeconds) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Media timing must match the Campaign duration", path: ["media", "durationSeconds"] });
  }
});

export const objectiveQualityGateSchema = z.enum([
  "dimensions",
  "duration",
  "narration",
  "caption_timing",
  "asset_safety",
  "factual_support",
  "text_safe_bounds",
  "package_inventory",
  "provenance",
]);

export const objectiveQualityFailureSchema = z.object({
  gate: objectiveQualityGateSchema,
  reason: z.string().min(1),
}).strict();

export const objectiveQualityReportSchema = z.object({
  passed: z.boolean(),
  failures: z.array(objectiveQualityFailureSchema),
}).strict().superRefine(({ passed, failures }, context) => {
  if (passed === Boolean(failures.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Objective quality state must match its failures", path: ["passed"] });
  }
});

const criticReportValueSchema = z.object({
  blockingFailures: z.array(objectiveQualityFailureSchema),
  advisory: z.object({
    hook: z.number().min(1).max(5),
    pacing: z.number().min(1).max(5),
    visualCoherence: z.number().min(1).max(5),
    productVisibility: z.number().min(1).max(5),
    cta: z.number().min(1).max(5),
  }).strict(),
  advisoryNotes: z.array(z.string().min(1)),
}).strict();

export const criticReportSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object") return input;
  const value = input as Record<string, unknown>;
  const advisory = value.advisory && typeof value.advisory === "object" ? value.advisory as Record<string, unknown> : undefined;
  return {
    blockingFailures: value.blockingFailures ?? (value.objectivePassed === false ? [{ gate: "factual_support", reason: "Legacy critic reported an objective failure" }] : []),
    advisory: advisory ? {
      hook: advisory.hook,
      pacing: advisory.pacing,
      visualCoherence: advisory.visualCoherence ?? advisory.coherence,
      productVisibility: advisory.productVisibility,
      cta: advisory.cta,
    } : advisory,
    advisoryNotes: value.advisoryNotes ?? value.notes ?? [],
  };
}, criticReportValueSchema);

export const correctionTargetSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("campaign") }).strict(),
  z.object({ scope: z.literal("scene"), sceneId: z.string().min(1) }).strict(),
]);

export const correctionRequestSchema = z.object({
  target: correctionTargetSchema,
  requestedChange: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(1000),
}).strict();

export const correctionStateSchema = z.enum(["available", "requested", "rerendering", "corrected_complete"]);

export const campaignCorrectionSchema = z.object({
  state: correctionStateSchema,
  limitReached: z.boolean(),
  request: correctionRequestSchema.optional(),
  requestedAt: z.string().datetime().optional(),
  authorizedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
}).strict().superRefine(({ state, limitReached, request }, context) => {
  if (limitReached !== (state !== "available")) context.addIssue({ code: z.ZodIssueCode.custom, message: "Correction limit state must match availability", path: ["limitReached"] });
  if (state !== "available" && !request) context.addIssue({ code: z.ZodIssueCode.custom, message: "A consumed correction requires its request", path: ["request"] });
  if (state === "available" && request) context.addIssue({ code: z.ZodIssueCode.custom, message: "An available correction cannot already contain a request", path: ["request"] });
});

export const packageFiles = [
  "campaign.mp4",
  "thumbnail.jpg",
  "caption.txt",
  "cta-variants.txt",
  "citations.json",
  "critic-report.json",
  "provenance.json",
] as const;

export const packageManifestSchema = z.object({
  campaignId: z.string().min(1),
  mode: providerModeSchema,
  files: z.array(z.enum(packageFiles)).length(packageFiles.length),
  archivePath: z.string().min(1).optional(),
}).strict().superRefine(({ files }, context) => {
  if (new Set(files).size !== packageFiles.length || packageFiles.some((file) => !files.includes(file))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Package inventory must contain every required file exactly once", path: ["files"] });
  }
});

export const handoffSchema = z.object({
  from: z.union([agentRoleSchema, z.literal("human")]),
  to: z.union([agentRoleSchema, z.literal("human")]),
  artifact: z.enum(["source_profile", "brand_market_brief", "concept_set", "concept_approval", "storyboard", "storyboard_approval", "render_manifest", "critic_report", "package_manifest", "correction_request", "correction_authorization"]),
}).strict();

export const collaborationCountsSchema = z.object({
  pages: z.number().int().nonnegative().optional(),
  assets: z.number().int().nonnegative().optional(),
  warnings: z.number().int().nonnegative().optional(),
  evidenceItems: z.number().int().nonnegative().optional(),
  concepts: z.number().int().nonnegative().optional(),
  scenes: z.number().int().nonnegative().optional(),
  captionWords: z.number().int().nonnegative().optional(),
  blockingFailures: z.number().int().nonnegative().optional(),
  advisoryNotes: z.number().int().nonnegative().optional(),
  files: z.number().int().nonnegative().optional(),
}).strict();

export const collaborationPayloadSchema = z.object({
  campaignId: z.string().trim().min(1).max(128),
  campaignType: campaignTypeSchema,
  durationSeconds: campaignDurationSecondsSchema,
  providerMode: providerModeSchema,
  sender: handoffSchema.shape.from,
  recipient: handoffSchema.shape.to,
  artifactType: handoffSchema.shape.artifact,
  summary: z.string().trim().min(1).max(240),
  counts: collaborationCountsSchema.optional(),
  approval: z.string().trim().min(1).max(240).optional(),
}).strict();

export const bandCampaignTaskKeySchema = z.enum([
  "source_profile_ingestion",
  "market_research",
  "brand_market_brief",
  "creative_concept_set",
  "concept_approval",
  "storyboard",
  "storyboard_approval",
  "narration_and_captions",
  "video_render",
  "critic_review",
  "targeted_correction",
  "campaign_package",
]);
export const bandCampaignTaskStageSchema = z.enum(["ingestion", "research", "strategy", "creative", "approval", "production", "review", "correction", "delivery"]);
export const bandCampaignTaskStateSchema = z.enum(["queued", "active", "completed", "degraded", "failed"]);
export const bandCampaignTaskSyncStateSchema = z.enum(["pending", "syncing", "completed", "degraded"]);
export const bandTaskAssignmentStatusSchema = z.enum(["pending", "in_progress", "blocked", "in_review", "failed", "completed"]);
export const bandCampaignTaskOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), role: agentRoleSchema }).strict(),
  z.object({ kind: z.literal("human_boundary"), assignment: z.enum(["unassigned", "agent_observed"]) }).strict(),
]);
export const bandCampaignTaskSchema = z.object({
  key: bandCampaignTaskKeySchema,
  campaignId: z.string().min(1),
  label: z.string().min(1).max(120),
  owner: bandCampaignTaskOwnerSchema,
  stage: bandCampaignTaskStageSchema,
  state: bandCampaignTaskStateSchema,
  sync: z.object({
    state: bandCampaignTaskSyncStateSchema,
    attempt: z.number().int().nonnegative(),
    desiredState: bandCampaignTaskStateSchema,
    bandTaskId: z.string().min(1).optional(),
    bandTaskNumber: z.number().int().positive().optional(),
    bandAssignmentStatus: bandTaskAssignmentStatusSchema.optional(),
  }).strict(),
}).strict();

export type CampaignDurationSeconds = z.infer<typeof campaignDurationSecondsSchema>;
export type CampaignType = z.infer<typeof campaignTypeSchema>;
export type CampaignConfiguration = z.infer<typeof campaignConfigurationSchema>;
export type BrandMarketBrief = z.infer<typeof brandMarketBriefSchema>;
export type Concept = z.infer<typeof conceptSchema>;
export type ConceptSet = z.infer<typeof conceptSetSchema>;
export type ConceptApproval = z.infer<typeof conceptApprovalSchema>;
export type StoryboardApproval = z.infer<typeof storyboardApprovalSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;
export type MediaProduction = z.infer<typeof mediaProductionSchema>;
export type RenderManifest = z.infer<typeof renderManifestSchema>;
export type CriticReport = z.infer<typeof criticReportSchema>;
export type ObjectiveQualityFailure = z.infer<typeof objectiveQualityFailureSchema>;
export type ObjectiveQualityReport = z.infer<typeof objectiveQualityReportSchema>;
export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;
export type CampaignCorrection = z.infer<typeof campaignCorrectionSchema>;
export type PackageManifest = z.infer<typeof packageManifestSchema>;
export type Handoff = z.infer<typeof handoffSchema>;
export type CollaborationPayload = z.infer<typeof collaborationPayloadSchema>;
export type BandCampaignTask = z.infer<typeof bandCampaignTaskSchema>;
export type BandCampaignTaskKey = z.infer<typeof bandCampaignTaskKeySchema>;
export type BandCampaignTaskState = z.infer<typeof bandCampaignTaskStateSchema>;
export type BandTaskAssignmentStatus = z.infer<typeof bandTaskAssignmentStatusSchema>;
export type AgentRole = z.infer<typeof agentRoleSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type ResearchIntent = z.infer<typeof researchIntentSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;

export const assertConceptEvidenceIds = (conceptSet: ConceptSet, brief: BrandMarketBrief) => {
  const evidenceIds = new Set(brief.evidenceBasis.items.map(({ id }) => id));
  const unknownId = conceptSet.concepts.flatMap(({ evidenceSourceIds }) => evidenceSourceIds).find((id) => !evidenceIds.has(id));
  if (unknownId) throw new Error(`Creative concepts referenced unknown Evidence Basis ID: ${unknownId}`);
  return conceptSet;
};
