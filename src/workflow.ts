import { z } from "zod";
import {
  agentRunSchema,
  assertConceptEvidenceIds,
  bandCampaignTaskSchema,
  brandMarketBriefSchema,
  campaignConfigurationSchema,
  campaignCorrectionSchema,
  conceptApprovalSchema,
  conceptSetSchema,
  correctionRequestSchema,
  criticReportSchema,
  handoffSchema,
  objectiveQualityFailureSchema,
  objectiveQualityReportSchema,
  packageManifestSchema,
  providerModeSchema,
  renderManifestSchema,
  storyboardApprovalSchema,
  storyboardSchema,
  type AgentRun,
  type CorrectionRequest,
  type Handoff,
  type ObjectiveQualityFailure,
  type Storyboard,
} from "./contracts";
import type { CampaignAgents, CampaignProviders } from "./ports";
import { ProviderError } from "./providers/http";
import { assertAssetCanFillScene, campaignAssetSchema } from "./source-assets";
import { applySourceProfileApproval, sourceProfileApprovalSchema, sourceProfileSchema } from "./source-profile";

export const campaignStatusSchema = z.enum(["idle", "awaiting_source_profile", "awaiting_concept_approval", "awaiting_storyboard_approval", "workflow_failed", "production_failed", "correction_requested", "rerendering", "completed"]);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const campaignFailureStageSchema = z.enum([
  "source_website_ingestion",
  "you_research",
  "token_router_generation",
  "band_synchronization",
  "deepgram_narration",
  "remotion_rendering",
  "critic_validation",
  "package_generation",
]);
export const campaignFailureOperationSchema = z.enum(["source_profile", "concepts", "storyboard", "production", "critic", "package"]);
export const campaignFailureSchema = z.object({
  stage: campaignFailureStageSchema,
  operation: campaignFailureOperationSchema,
  provider: z.string().min(1),
  retryable: z.boolean(),
  message: z.string().min(1),
  resolution: z.string().min(1),
}).strict();
export type CampaignFailure = z.infer<typeof campaignFailureSchema>;

export const campaignSnapshotSchema = z.object({
  id: z.string().min(1),
  status: campaignStatusSchema,
  mode: providerModeSchema,
  configuration: campaignConfigurationSchema.optional(),
  sourceProfile: sourceProfileSchema.optional(),
  uploadedAssets: z.array(campaignAssetSchema).default([]),
  brief: brandMarketBriefSchema.optional(),
  conceptSet: conceptSetSchema.optional(),
  conceptApproval: conceptApprovalSchema.optional(),
  storyboard: storyboardSchema.optional(),
  renderManifest: renderManifestSchema.optional(),
  objectiveQuality: objectiveQualityReportSchema.optional(),
  criticReport: criticReportSchema.optional(),
  packageManifest: packageManifestSchema.optional(),
  failure: campaignFailureSchema.optional(),
  correction: campaignCorrectionSchema.optional(),
  productionFailure: z.object({
    provider: z.string().min(1),
    retryable: z.boolean(),
    message: z.string().min(1),
    stage: campaignFailureStageSchema.optional(),
    operation: campaignFailureOperationSchema.optional(),
    resolution: z.string().min(1).optional(),
  }).strict().optional(),
  agentRuns: z.array(agentRunSchema),
  handoffs: z.array(handoffSchema),
  bandTasks: z.array(bandCampaignTaskSchema).optional(),
}).strict();

export type CampaignSnapshot = z.infer<typeof campaignSnapshotSchema>;

export interface CampaignWorkflow {
  start(input: unknown): Promise<CampaignSnapshot>;
  approveSourceProfile(input: unknown): Promise<CampaignSnapshot>;
  registerUploadedAsset(input: unknown): Promise<CampaignSnapshot>;
  approveConcept(input: unknown): Promise<CampaignSnapshot>;
  approveStoryboard(input?: unknown): Promise<CampaignSnapshot>;
  retry(): Promise<CampaignSnapshot>;
  requestCorrection(input: unknown): Promise<CampaignSnapshot>;
  authorizeCorrection(): Promise<CampaignSnapshot>;
  snapshot(): CampaignSnapshot;
}

const copy = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();

class ObjectiveQualityError extends Error {
  readonly report;

  constructor(failures: ObjectiveQualityFailure[]) {
    const report = objectiveQualityReportSchema.parse({ passed: false, failures });
    super(`Objective quality gates failed: ${report.failures.map(({ gate }) => gate).join(", ")}`);
    this.report = report;
  }
}

const uniqueFailures = (failures: ObjectiveQualityFailure[]) => [...new Map(failures.map((failure) => [failure.gate, objectiveQualityFailureSchema.parse(failure)])).values()];

const safeVisualUri = (value: unknown) => {
  if (typeof value !== "string" || !value || value.includes("\\") || value.split("/").includes("..")) return false;
  if (value.startsWith("/")) return /^\/(fixtures|campaigns|api\/campaigns\/current\/assets)(\/|\?)/.test(value);
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const privateHostname = hostname === "localhost" || hostname.endsWith(".localhost") || /^(0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) || hostname === "::1" || /^(fc|fd|fe80):/i.test(hostname);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && !privateHostname;
  } catch {
    return false;
  }
};

const objectiveFailuresFor = (
  candidate: unknown,
  storyboard: Storyboard,
  configuration: z.infer<typeof campaignConfigurationSchema>,
  knownAssetIds: Set<string>,
) => {
  const failures: ObjectiveQualityFailure[] = [];
  const render = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  const media = render.media && typeof render.media === "object" ? render.media as Record<string, unknown> : {};
  const narration = media.narration && typeof media.narration === "object" ? media.narration as Record<string, unknown> : {};
  const captions = media.captions && typeof media.captions === "object" ? media.captions as Record<string, unknown> : {};
  const words = Array.isArray(captions.words) ? captions.words : [];

  if (render.width !== 1080 || render.height !== 1920 || render.fps !== 30) failures.push({ gate: "dimensions", reason: "Promotional Video must be 1080×1920 at 30 FPS" });
  if (render.durationSeconds !== configuration.durationSeconds || media.durationSeconds !== configuration.durationSeconds || storyboard.durationSeconds !== configuration.durationSeconds) failures.push({ gate: "duration", reason: "Render, media, Storyboard, and configured durations must match" });
  if (render.campaignType !== configuration.type) failures.push({ gate: "factual_support", reason: "Rendered Campaign type must match the approved configuration" });
  if (typeof render.videoPath !== "string" || !render.videoPath || typeof render.thumbnailPath !== "string" || !render.thumbnailPath) failures.push({ gate: "asset_safety", reason: "Rendered video and thumbnail assets must be present" });
  if (narration.required !== true || typeof narration.path !== "string" || !narration.path) failures.push({ gate: "narration", reason: "Required narration is missing" });
  let captionCursor = 0;
  if (!words.length || words.some((word) => {
    if (!word || typeof word !== "object") return true;
    const value = word as Record<string, unknown>;
    const invalid = typeof value.startSeconds !== "number" || typeof value.endSeconds !== "number" || value.startSeconds < captionCursor || value.endSeconds <= value.startSeconds || value.endSeconds > configuration.durationSeconds;
    if (typeof value.endSeconds === "number") captionCursor = value.endSeconds;
    return invalid;
  })) failures.push({ gate: "caption_timing", reason: "Synchronized captions must be ordered within the Campaign duration" });
  if (storyboard.scenes.some(({ visual }) => !safeVisualUri(visual.uri) || Boolean(visual.assetId && !knownAssetIds.has(visual.assetId)))) failures.push({ gate: "asset_safety", reason: "Every scene must use a present, safe Campaign asset" });
  if (storyboard.scenes.some(({ narration: text, overlayText }) => !text || text.length > 500 || !overlayText || overlayText.length > 120)) failures.push({ gate: "text_safe_bounds", reason: "Narration and overlay text must remain within safe composition bounds" });
  if (!renderManifestSchema.safeParse(candidate).success) {
    if (!failures.length) failures.push({ gate: "duration", reason: "Render manifest failed objective runtime validation" });
  }
  return uniqueFailures(failures);
};

const correctedStoryboard = (storyboard: Storyboard, correction: CorrectionRequest) => {
  const targetSceneId = correction.target.scope === "scene" ? correction.target.sceneId : undefined;
  const targetIndex = targetSceneId ? storyboard.scenes.findIndex(({ id }) => id === targetSceneId) : storyboard.scenes.length - 1;
  return storyboardSchema.parse({
    ...storyboard,
    scenes: storyboard.scenes.map((scene, index) => index === targetIndex ? { ...scene, overlayText: correction.requestedChange } : scene),
  });
};

const stageProvider = (stage: CampaignFailure["stage"]) => ({
  source_website_ingestion: "source_website",
  you_research: "you",
  token_router_generation: "token_router",
  band_synchronization: "band",
  deepgram_narration: "deepgram",
  remotion_rendering: "remotion",
  critic_validation: "critic",
  package_generation: "filesystem",
}[stage]);

const failureFrom = (error: unknown, operation: CampaignFailure["operation"], fallbackStage: CampaignFailure["stage"]): CampaignFailure => {
  const provider = error instanceof ObjectiveQualityError ? "quality" : error instanceof ProviderError ? error.provider : stageProvider(fallbackStage);
  const stage = provider === "source_website" ? "source_website_ingestion"
    : provider === "you" ? "you_research"
      : provider === "deepgram" ? "deepgram_narration"
        : provider === "remotion" ? "remotion_rendering"
          : provider === "filesystem" ? "package_generation"
            : provider === "token_router" && operation === "critic" ? "critic_validation"
              : provider === "token_router" ? "token_router_generation" : fallbackStage;
  const retryable = error instanceof ObjectiveQualityError ? false : error instanceof ProviderError ? error.retryable : true;
  const message = error instanceof Error ? error.message : "Campaign stage failed";
  return campaignFailureSchema.parse({
    stage,
    operation,
    provider,
    retryable,
    message,
    resolution: error instanceof ObjectiveQualityError
      ? "Correct the identified quality issue before producing another Campaign."
      : retryable ? "Retry this stage; completed Campaign work will be reused." : "Update the required input or server configuration, then start another Campaign.",
  });
};

export const createCampaignWorkflow = (
  agents: CampaignAgents,
  providers: CampaignProviders,
  campaignId = "campaign-fixture",
  initialState?: CampaignSnapshot,
  mode: "fixture" | "live" | "cached" = "fixture",
): CampaignWorkflow => {
  const recovered = initialState ? campaignSnapshotSchema.parse(initialState) : undefined;
  let state: CampaignSnapshot = recovered
    ? recovered.status === "completed" && !recovered.correction ? { ...recovered, correction: { state: "available", limitReached: false } } : recovered
    : { id: campaignId, status: "idle", mode, uploadedAssets: [], agentRuns: [], handoffs: [] };

  const snapshot = () => copy(state);
  const requireStatus = (required: CampaignStatus) => {
    if (state.status !== required) throw new Error(`Campaign must be ${required}; current status is ${state.status}`);
  };
  const recordRun = (run: AgentRun) => state.agentRuns.push(agentRunSchema.parse(run));
  const handoff = (value: Handoff) => state.handoffs.push(handoffSchema.parse(value));
  const validateVisualPolicy = (storyboard: Storyboard) => {
    for (const scene of storyboard.scenes) assertAssetCanFillScene({ provenance: scene.visual.kind }, scene.visual.contentRole);
  };
  const validateStoryboardEdits = (storyboard: Storyboard) => {
    const assets = [...(state.sourceProfile?.assets ?? []), ...state.uploadedAssets];
    for (const [index, scene] of storyboard.scenes.entries()) {
      const current = state.storyboard!.scenes[index];
      if (!current || current.id !== scene.id || current.durationSeconds !== scene.durationSeconds) throw new Error("Storyboard timing, order, and scene IDs are system-controlled");
      const visualChanged = scene.visual.kind !== current.visual.kind || scene.visual.uri !== current.visual.uri || scene.visual.assetId !== current.visual.assetId;
      if (!visualChanged) continue;
      const asset = assets.find(({ id }) => id === scene.visual.assetId);
      if (!asset || asset.provenance !== scene.visual.kind || asset.uri !== scene.visual.uri) throw new Error("Storyboard images must use a validated Campaign asset");
      assertAssetCanFillScene(asset, current.visual.contentRole);
      if (current.visual.contentRole) scene.visual.contentRole = current.visual.contentRole;
    }
    validateVisualPolicy(storyboard);
  };
  const fail = (error: unknown, operation: CampaignFailure["operation"], fallbackStage: CampaignFailure["stage"], production = false) => {
    const failure = failureFrom(error, operation, fallbackStage);
    state = {
      ...state,
      status: production ? "production_failed" : "workflow_failed",
      failure,
      productionFailure: production ? failure : undefined,
    };
  };

  const extractSourceProfile = async () => {
    try {
      const sourceProfile = sourceProfileSchema.parse(await providers.sourceProfile.extract(state.configuration!));
      state = { ...state, status: "awaiting_source_profile", sourceProfile, failure: undefined, productionFailure: undefined };
      handoff({ from: "brand_market_analyst", to: "human", artifact: "source_profile" });
      return snapshot();
    } catch (error) {
      fail(error, "source_profile", "source_website_ingestion");
      throw error;
    }
  };

  const createConcepts = async () => {
    try {
      if (!state.brief) {
        const analystResult = await agents.analyst.analyze(state.configuration!, state.sourceProfile!);
        const brief = brandMarketBriefSchema.parse(analystResult.artifact);
        recordRun(analystResult.run);
        handoff({ from: "human", to: "brand_market_analyst", artifact: "source_profile" });
        handoff({ from: "brand_market_analyst", to: "creative_director", artifact: "brand_market_brief" });
        state = { ...state, brief };
      }
      if (!state.conceptSet) {
        const directorResult = await agents.director.propose(state.brief!);
        const conceptSet = conceptSetSchema.parse(directorResult.artifact);
        assertConceptEvidenceIds(conceptSet, state.brief!);
        recordRun(directorResult.run);
        handoff({ from: "creative_director", to: "human", artifact: "concept_set" });
        state = { ...state, conceptSet };
      }
      state = { ...state, status: "awaiting_concept_approval", failure: undefined, productionFailure: undefined };
      return snapshot();
    } catch (error) {
      fail(error, "concepts", error instanceof ProviderError && error.provider === "you" ? "you_research" : "token_router_generation");
      throw error;
    }
  };

  const createStoryboard = async () => {
    try {
      if (!state.storyboard) {
        const directorResult = await agents.director.storyboard(state.brief!, state.conceptApproval!, state.configuration!);
        const storyboard = storyboardSchema.parse(directorResult.artifact);
        if (storyboard.durationSeconds !== state.configuration!.durationSeconds) throw new Error("Storyboard duration must match the configured Campaign duration");
        validateVisualPolicy(storyboard);
        recordRun(directorResult.run);
        handoff({ from: "creative_director", to: "human", artifact: "storyboard" });
        state = { ...state, storyboard };
      }
      state = { ...state, status: "awaiting_storyboard_approval", failure: undefined, productionFailure: undefined };
      return snapshot();
    } catch (error) {
      fail(error, "storyboard", "token_router_generation");
      throw error;
    }
  };

  const packageContext = () => {
    const selectedConcept = state.conceptSet!.concepts.find(({ id }) => id === state.conceptApproval!.conceptId)!;
    return {
      storyboard: state.storyboard!,
      sourceProfile: state.sourceProfile!,
      citations: state.brief!.evidenceBasis.items,
      ctaVariants: [selectedConcept.cta, `Discover ${state.brief!.productName}`, `See ${state.brief!.productName} in action`],
      ...(state.correction?.request ? { correction: state.correction.request } : {}),
    };
  };
  const failProduction = (error: unknown, operation: CampaignFailure["operation"], fallbackStage: CampaignFailure["stage"]) => {
    fail(error, operation, fallbackStage, true);
    if (error instanceof ObjectiveQualityError) state = { ...state, objectiveQuality: error.report };
  };
  const validateRender = (candidate: unknown) => {
    const knownAssetIds = new Set([...(state.sourceProfile?.assets ?? []), ...state.uploadedAssets].map(({ id }) => id));
    const failures = objectiveFailuresFor(candidate, state.storyboard!, state.configuration!, knownAssetIds);
    if (failures.length) throw new ObjectiveQualityError(failures);
    return renderManifestSchema.parse(candidate);
  };
  const packageCampaign = async () => {
    try {
      const packageManifest = packageManifestSchema.parse(await providers.packager.package(state.id, state.renderManifest!, state.criticReport!, packageContext()));
      if (!packageManifest.files.includes("provenance.json")) throw new ObjectiveQualityError([{ gate: "provenance", reason: "Campaign package is missing provenance" }]);
      return packageManifest;
    } catch (error) {
      if (error instanceof ObjectiveQualityError) throw error;
      const message = error instanceof Error ? error.message : "Campaign package failed validation";
      if (error instanceof z.ZodError || /(inventory|provenance|validation|required file|exactly)/i.test(message)) {
        const gate = /provenance/i.test(message) ? "provenance" as const : "package_inventory" as const;
        throw new ObjectiveQualityError([{ gate, reason: message }]);
      }
      throw error;
    }
  };
  const produceCampaign = async (corrected = false, producerResult?: Awaited<ReturnType<CampaignAgents["producer"]["produce"]>>) => {
    if (state.storyboard!.durationSeconds !== state.configuration!.durationSeconds) throw new Error("Storyboard duration must match the configured Campaign duration");
    try {
      if (producerResult || !state.renderManifest) {
        const result = producerResult ?? await agents.producer.produce(state.id, state.storyboard!, state.configuration!);
        const renderManifest = validateRender(result.artifact);
        recordRun(result.run);
        handoff({ from: "video_producer", to: "creative_critic", artifact: "render_manifest" });
        state = { ...state, renderManifest, criticReport: undefined, packageManifest: undefined };
      } else {
        validateRender(state.renderManifest);
      }
    } catch (error) {
      failProduction(error, "production", error instanceof ObjectiveQualityError ? "critic_validation" : "remotion_rendering");
      throw error;
    }
    try {
      if (!state.criticReport) {
        const criticResult = await agents.critic.critique(state.renderManifest!, state.storyboard!);
        const criticReport = criticReportSchema.parse(criticResult.artifact);
        recordRun(criticResult.run);
        handoff({ from: "creative_critic", to: "human", artifact: "critic_report" });
        state = { ...state, criticReport };
      }
      const blockingFailures = state.criticReport!.blockingFailures;
      if (blockingFailures.length) throw new ObjectiveQualityError(blockingFailures);
    } catch (error) {
      failProduction(error, "critic", "critic_validation");
      throw error;
    }
    try {
      if (!state.packageManifest) {
        const packageManifest = await packageCampaign();
        handoff({ from: "creative_critic", to: "human", artifact: "package_manifest" });
        state = { ...state, packageManifest };
      }
    } catch (error) {
      failProduction(error, "package", "package_generation");
      throw error;
    }
    state = {
      ...state,
      status: "completed",
      objectiveQuality: { passed: true, failures: [] },
      correction: corrected ? { ...state.correction!, state: "corrected_complete", limitReached: true, completedAt: now() } : state.correction ?? { state: "available", limitReached: false },
      failure: undefined,
      productionFailure: undefined,
    };
    return snapshot();
  };

  return {
    async start(input) {
      requireStatus("idle");
      const configuration = campaignConfigurationSchema.parse(input);
      state = { ...state, configuration };
      return extractSourceProfile();
    },

    async approveSourceProfile(input) {
      requireStatus("awaiting_source_profile");
      const sourceProfile = applySourceProfileApproval(state.sourceProfile!, sourceProfileApprovalSchema.parse(input));
      state = { ...state, sourceProfile };
      return createConcepts();
    },

    async registerUploadedAsset(input) {
      if (state.status === "idle" || state.status === "completed" || state.status === "correction_requested" || state.status === "rerendering") throw new Error("Campaign is not accepting uploaded assets");
      const asset = campaignAssetSchema.parse(input);
      if (asset.provenance !== "uploaded") throw new Error("Only validated uploaded assets can be registered");
      if (state.uploadedAssets.some(({ id }) => id === asset.id)) throw new Error(`Asset ${asset.id} is already registered`);
      state = { ...state, uploadedAssets: [...state.uploadedAssets, asset] };
      return snapshot();
    },

    async approveConcept(input) {
      requireStatus("awaiting_concept_approval");
      const approval = conceptApprovalSchema.parse(input);
      if (!state.conceptSet?.concepts.some(({ id }) => id === approval.conceptId)) throw new Error(`Unknown concept: ${approval.conceptId}`);
      handoff({ from: "human", to: "creative_director", artifact: "concept_approval" });
      state = { ...state, conceptApproval: approval };
      return createStoryboard();
    },

    async approveStoryboard(input = { approved: true }) {
      if (state.status !== "awaiting_storyboard_approval" && (state.status !== "production_failed" || Boolean(state.correction?.request))) {
        throw new Error(`Campaign must be awaiting_storyboard_approval or production_failed; current status is ${state.status}`);
      }
      const approval = storyboardApprovalSchema.parse(input);
      if (approval.storyboard) {
        if (state.renderManifest) throw new Error("Storyboard cannot change after production has started");
        const storyboard = storyboardSchema.parse(approval.storyboard);
        validateStoryboardEdits(storyboard);
        state = { ...state, storyboard };
      }
      if (state.status === "awaiting_storyboard_approval") handoff({ from: "human", to: "video_producer", artifact: "storyboard_approval" });
      return produceCampaign();
    },

    async retry() {
      const failure = state.failure ?? state.productionFailure;
      if (!failure) throw new Error("Campaign has no failed stage to retry");
      if (!failure.retryable) throw new Error(failure.resolution ?? "This failure requires an input or configuration change");
      if (failure.operation === "source_profile") return extractSourceProfile();
      if (failure.operation === "concepts") return createConcepts();
      if (failure.operation === "storyboard") return createStoryboard();
      return produceCampaign(state.correction?.state === "rerendering");
    },

    async requestCorrection(input) {
      if (state.correction?.limitReached) throw new Error("Campaign correction limit reached");
      requireStatus("completed");
      if (state.correction?.state !== "available") throw new Error("Campaign correction is not available");
      const request = correctionRequestSchema.parse(input);
      const targetSceneId = request.target.scope === "scene" ? request.target.sceneId : undefined;
      if (targetSceneId && !state.storyboard?.scenes.some(({ id }) => id === targetSceneId)) throw new Error(`Unknown correction scene: ${targetSceneId}`);
      state = {
        ...state,
        status: "correction_requested",
        correction: { state: "requested", limitReached: true, request, requestedAt: now() },
      };
      handoff({ from: "human", to: "video_producer", artifact: "correction_request" });
      return snapshot();
    },

    async authorizeCorrection() {
      requireStatus("correction_requested");
      const correction = state.correction?.request;
      const previousRender = state.renderManifest;
      if (!correction || !previousRender) throw new Error("Campaign has no correction ready for authorization");
      state = {
        ...state,
        status: "rerendering",
        storyboard: correctedStoryboard(state.storyboard!, correction),
        renderManifest: undefined,
        criticReport: undefined,
        packageManifest: undefined,
        correction: { ...state.correction!, state: "rerendering", limitReached: true, authorizedAt: now() },
      };
      handoff({ from: "human", to: "video_producer", artifact: "correction_authorization" });
      try {
        const result = agents.producer.correct
          ? await agents.producer.correct(state.id, state.storyboard!, state.configuration!, correction, previousRender)
          : await agents.producer.produce(state.id, state.storyboard!, state.configuration!);
        return await produceCampaign(true, result);
      } catch (error) {
        if (state.status !== "production_failed") failProduction(error, "production", "remotion_rendering");
        throw error;
      }
    },

    snapshot,
  };
};
