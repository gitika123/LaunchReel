import { join } from "node:path";
import type { CampaignConfiguration } from "./contracts";
import { createFixtureWorkflow } from "./fixture";
import { createLiveSourceWebsiteIngestionDependencies } from "./ingestion-live.server";
import { ingestSourceWebsite } from "./ingestion";
import {
  LiveBrandMarketAnalyst,
  LiveCreativeCritic,
  LiveCreativeDirector,
  LiveVideoProducer,
  liveMediaProductionFromEnvironment,
  tokenRouterModelsFromEnvironment,
} from "./live";
import { LocalPackageProvider } from "./package";
import { createJsonCampaignRepository, createPersistedCampaignRuntime, type CampaignEvent } from "./persistence";
import { bandMirrorFromEnvironment, bandTaskBoardFromEnvironment, validBandRoomUrl } from "./providers/band";
import { ProviderError } from "./providers/http";
import { TokenRouterClient } from "./providers/token-router";
import { YouSearchClient } from "./providers/you";
import { RemotionRenderProvider } from "./video/render";
import { LocalCampaignAssetStore } from "./source-assets";
import { sourceProfileFromIngestion } from "./source-profile";
import { createCampaignWorkflow, type CampaignSnapshot } from "./workflow";

const runtime = globalThis as typeof globalThis & {
  launchReelFixtureRuntime?: ReturnType<typeof createPersistedCampaignRuntime>;
  launchReelLiveRuntime?: ReturnType<typeof createPersistedCampaignRuntime>;
};

const collaboration = () => {
  try {
    return { collaboration: bandMirrorFromEnvironment(process.env), bandTasks: bandTaskBoardFromEnvironment(process.env) };
  } catch {
    return {};
  }
};

const dataDirectory = () => process.env.LAUNCHREEL_DATA_DIR ?? join(process.cwd(), "data", "campaigns");
const assetDirectory = (mode: "fixture" | "live") => join(dataDirectory(), mode === "live" ? "assets" : "fixture-assets");

const repository = (mode: "fixture" | "live") => createJsonCampaignRepository({
  rootDirectory: join(dataDirectory(), mode),
  campaignAssetDirectories: [
    assetDirectory(mode),
    ...(mode === "live" ? [join(process.cwd(), "public", "campaigns")] : []),
  ],
});

const collaborationOptions = () => ({
  ...collaboration(),
  collaborationRoomUrl: validBandRoomUrl(process.env.BAND_ROOM_URL),
});

export const getCampaignAssetStore = () => new LocalCampaignAssetStore(assetDirectory(process.env.LAUNCHREEL_MODE === "live" ? "live" : "fixture"));

export interface CampaignPresentationData {
  snapshot?: CampaignSnapshot;
  events: CampaignEvent[];
  configuredMode: "fixture" | "live";
  runtimeMode: "fixture" | "live";
  source: "active" | "retained" | "none";
  providerConfigurationPresent: boolean;
  fixtureDemoEnabled: boolean;
  fixtureFallbackActive: boolean;
  bandRoomUrl?: string;
}

const liveProviderEnvironmentNames = [
  "TOKEN_ROUTER_API_KEY", "TOKEN_ROUTER_BASE_URL",
  "TOKEN_ROUTER_MODEL_ANALYST", "TOKEN_ROUTER_MODEL_DIRECTOR", "TOKEN_ROUTER_MODEL_PRODUCER", "TOKEN_ROUTER_MODEL_CRITIC",
  "YDC_API_KEY", "YDC_BASE_URL", "DEEPGRAM_API_KEY", "DEEPGRAM_TTS_MODEL",
  "BAND_CHAT_ID", "BAND_ANALYST_AGENT_ID", "BAND_ANALYST_AGENT_API_KEY", "BAND_DIRECTOR_AGENT_ID", "BAND_DIRECTOR_AGENT_API_KEY",
  "BAND_PRODUCER_AGENT_ID", "BAND_PRODUCER_AGENT_API_KEY", "BAND_CRITIC_AGENT_ID", "BAND_CRITIC_AGENT_API_KEY",
] as const;

export const getCampaignPresentationData = async (requestedMode?: "fixture" | "live"): Promise<CampaignPresentationData> => {
  const configuredMode = process.env.LAUNCHREEL_MODE === "live" ? "live" : "fixture";
  const fixtureDemoEnabled = process.env.LAUNCHREEL_ENABLE_FIXTURE_DEMO === "true";
  const fixtureFallbackActive = requestedMode === "fixture" && fixtureDemoEnabled;
  const runtimeMode = fixtureFallbackActive ? "fixture" : configuredMode;
  const providerConfigurationPresent = runtimeMode === "fixture" || liveProviderEnvironmentNames.every((name) => Boolean(process.env[name]?.trim()));
  const campaignRepository = repository(runtimeMode);
  if (!fixtureFallbackActive) {
    const active = await campaignRepository.loadCurrent();
    if (active) {
      return {
        snapshot: active,
        events: await campaignRepository.eventsAfter(0),
        configuredMode,
        runtimeMode,
        source: "active",
        providerConfigurationPresent,
        fixtureDemoEnabled,
        fixtureFallbackActive,
        bandRoomUrl: validBandRoomUrl(process.env.BAND_ROOM_URL),
      };
    }
  }
  const latest = (await campaignRepository.listCompleted())[0];
  return {
    snapshot: latest ? await campaignRepository.loadCompleted(latest.campaignId) : undefined,
    events: latest ? await campaignRepository.loadCompletedEvents(latest.campaignId) : [],
    configuredMode,
    runtimeMode,
    source: latest ? "retained" : "none",
    providerConfigurationPresent,
    fixtureDemoEnabled,
    fixtureFallbackActive,
    ...(fixtureFallbackActive ? {} : { bandRoomUrl: validBandRoomUrl(process.env.BAND_ROOM_URL) }),
  };
};

export const getFixtureCampaignRuntime = () => runtime.launchReelFixtureRuntime ??= createPersistedCampaignRuntime(
  repository("fixture"),
  (initialState, campaignId) => createFixtureWorkflow(initialState, campaignId),
);

const requiredEnvironment = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in live mode`);
  return value;
};

const createLiveWorkflow = (initialState?: CampaignSnapshot, campaignId = "campaign-live") => {
  const rootDirectory = process.cwd();
  const publicDirectory = join(rootDirectory, "public");
  const campaignDirectory = join(publicDirectory, "campaigns");
  const router = new TokenRouterClient({
    apiKey: requiredEnvironment("TOKEN_ROUTER_API_KEY"),
    baseUrl: requiredEnvironment("TOKEN_ROUTER_BASE_URL"),
    models: tokenRouterModelsFromEnvironment(process.env),
    modelProfile: "launchreel-live",
  });
  const research = new YouSearchClient({
    apiKey: requiredEnvironment("YDC_API_KEY"),
    baseUrl: requiredEnvironment("YDC_BASE_URL"),
  });
  const media = liveMediaProductionFromEnvironment(process.env, rootDirectory);
  const renderer = new RemotionRenderProvider({ rootDirectory, publicDirectory });
  const ingestionDependencies = createLiveSourceWebsiteIngestionDependencies();
  const sourceProfile = {
    async extract(configuration: CampaignConfiguration) {
      try {
        return sourceProfileFromIngestion(await ingestSourceWebsite({
          sourceWebsite: configuration.sourceWebsite,
          ...(configuration.type === "feature_announcement" ? { featurePage: configuration.featurePageUrl } : {}),
        }, ingestionDependencies));
      } catch (error) {
        throw new ProviderError("source_website", "unavailable", true, error instanceof Error ? error.message : "Source Website ingestion failed", { cause: error });
      }
    },
  };
  return createCampaignWorkflow(
    {
      analyst: new LiveBrandMarketAnalyst(router, research),
      director: new LiveCreativeDirector(router),
      producer: new LiveVideoProducer(router, media, renderer),
      critic: new LiveCreativeCritic(router),
    },
    { packager: new LocalPackageProvider({ rootDirectory: campaignDirectory }), sourceProfile },
    campaignId,
    initialState,
    "live",
  );
};

export const getLiveCampaignRuntime = () => runtime.launchReelLiveRuntime ??= createPersistedCampaignRuntime(
  repository("live"),
  createLiveWorkflow,
  collaborationOptions(),
);

export const getCampaignRuntime = () => process.env.LAUNCHREEL_MODE === "live"
  ? getLiveCampaignRuntime()
  : getFixtureCampaignRuntime();
