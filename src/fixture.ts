import { packageFiles, type AgentRole, type AgentRun, type BrandMarketBrief, type CampaignConfiguration, type ConceptApproval, type CorrectionRequest, type MediaProduction, type RenderManifest, type Storyboard } from "./contracts";
import type {
  BrandMarketAnalystAgent,
  CreativeCriticAgent,
  CreativeDirectorAgent,
  PackageProvider,
  RenderProvider,
  VideoProducerAgent,
} from "./ports";
import { FixtureSourceProfileProvider, sourceProfileEvidence, type SourceProfile } from "./source-profile";
import { createCampaignWorkflow, type CampaignSnapshot } from "./workflow";

const fixtureRun = (role: AgentRole): AgentRun => ({ role, providerMode: "fixture", validation: "passed" });

export class FixtureBrandMarketAnalyst implements BrandMarketAnalystAgent {
  async analyze(configuration: CampaignConfiguration, sourceProfile: SourceProfile) {
    const featureEvidence = configuration.type === "feature_announcement" ? [{
      id: "source-feature",
      claim: `${configuration.featureName}: ${configuration.featureDescription}`,
      sourceUrl: configuration.featurePageUrl,
      sourceKind: "source_website" as const,
      title: configuration.featureName,
    }] : [];
    return {
      artifact: {
        saasCompany: sourceProfile.saasCompany,
        productName: sourceProfile.productName,
        targetAudience: configuration.targetAudience,
        positioning: sourceProfile.positioning,
        evidenceBasis: {
          mode: "website_grounded_only" as const,
          claimScope: "source_website_only" as const,
          items: [...sourceProfileEvidence(sourceProfile), ...featureEvidence],
        },
      },
      run: fixtureRun("brand_market_analyst"),
    };
  }
}

export class FixtureCreativeDirector implements CreativeDirectorAgent {
  async propose(brief: BrandMarketBrief) {
    const feature = brief.evidenceBasis.items.find(({ id }) => id === "source-feature");
    const shared = {
      message: feature?.claim ?? "Move from product facts to a coherent launch Campaign.",
      evidenceSourceIds: feature ? ["source-1", feature.id] : ["source-1"],
    };
    const subject = feature?.title ?? "Your product";
    return {
      artifact: {
        concepts: [
          { ...shared, id: "concept-momentum", title: "Launch Momentum", hook: `${subject} is ready. Is your Campaign?`, emotionalDirection: "Confident urgency", visualMetaphor: "A production line accelerating", cta: feature ? `Discover ${subject}` : "Build your launch" },
          { ...shared, id: "concept-convergence", title: "One Creative Company", hook: "Stop stitching Campaign assets together.", emotionalDirection: "Relief and clarity", visualMetaphor: "Scattered assets converge into one Campaign", cta: feature ? `Explore ${subject}` : "Unify your campaign" },
          { ...shared, id: "concept-evidence", title: "Grounded Creativity", hook: "Creative work that starts with product truth.", emotionalDirection: "Trust and ambition", visualMetaphor: "Evidence cards become polished scenes", cta: feature ? `See ${subject} in action` : "Launch from evidence" },
        ],
      },
      run: fixtureRun("creative_director"),
    };
  }

  async storyboard(_brief: BrandMarketBrief, approval: ConceptApproval, configuration: CampaignConfiguration) {
    const subject = configuration.type === "feature_announcement" ? configuration.featureName : "Your product";
    const overlays = [
      `${subject} is ready`,
      "Grounded in product truth",
      "Built for the audience",
      "Three creative directions",
      "Human-approved production",
      "Narration tells the story",
      "Captions stay synchronized",
      "Motion supports the message",
      "Critic checks the Campaign",
      configuration.type === "feature_announcement" ? `Discover ${configuration.featureName}` : "Build your launch",
    ].slice(0, configuration.durationSeconds / 6);
    return {
      artifact: {
        durationSeconds: configuration.durationSeconds,
        scenes: overlays.map((overlayText, index) => ({
          id: `scene-${index + 1}`,
          durationSeconds: 6,
          narration: `${overlayText}. ${approval.direction ?? "A complete Campaign moves forward with clear approvals."}`,
          overlayText,
          visual: { kind: "fixture" as const, uri: `/fixtures/scene-${index + 1}.png` },
        })),
      },
      run: fixtureRun("creative_director"),
    };
  }
}

const fixtureMedia = (campaignId: string, storyboard: Storyboard): MediaProduction => ({
  durationSeconds: storyboard.durationSeconds,
  narration: { required: true, path: `/campaigns/${campaignId}/assets/narration.wav`, provider: "fixture", model: "SAM synthetic fixture voice" },
  captions: { provider: "fixture", model: "fixture-word-timing-v1", words: [{ word: "LaunchReel", startSeconds: 0.1, endSeconds: 0.8 }] },
  music: {
    path: `/campaigns/${campaignId}/assets/music.wav`,
    provider: "fixture",
    origin: "licensed",
    title: "LaunchReel Fixture Pulse",
    creator: "LaunchReel",
    license: "CC0-1.0",
    sourceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
});

export class FixtureRenderProvider implements RenderProvider {
  async render(campaignId: string, storyboard: Storyboard, media: MediaProduction, configuration: CampaignConfiguration) {
    return {
      campaignId,
      campaignType: configuration.type,
      width: 1080 as const,
      height: 1920 as const,
      fps: 30 as const,
      durationSeconds: storyboard.durationSeconds,
      videoPath: `/campaigns/${campaignId}/campaign.mp4`,
      thumbnailPath: `/campaigns/${campaignId}/thumbnail.jpg`,
      compositionId: "LaunchReelProductLaunch" as const,
      providerMode: "fixture" as const,
      media,
    };
  }
}

export class FixtureVideoProducer implements VideoProducerAgent {
  constructor(private readonly renderer: RenderProvider) {}

  async produce(campaignId: string, storyboard: Storyboard, configuration: CampaignConfiguration) {
    const media = fixtureMedia(campaignId, storyboard);
    return {
      artifact: await this.renderer.render(campaignId, storyboard, media, configuration, "fixture"),
      run: fixtureRun("video_producer"),
    };
  }

  async correct(campaignId: string, storyboard: Storyboard, configuration: CampaignConfiguration, _correction: CorrectionRequest, previousRender: RenderManifest) {
    return {
      artifact: await this.renderer.render(campaignId, storyboard, previousRender.media, configuration, "fixture"),
      run: fixtureRun("video_producer"),
    };
  }
}

export class FixtureCreativeCritic implements CreativeCriticAgent {
  async critique() {
    return {
      artifact: {
        blockingFailures: [],
        advisory: { hook: 4, pacing: 4, visualCoherence: 5, productVisibility: 4, cta: 4 },
        advisoryNotes: ["Fixture Campaign satisfies the objective gates; creative feedback remains advisory."],
      },
      run: fixtureRun("creative_critic"),
    };
  }
}

export class FixturePackageProvider implements PackageProvider {
  async package(campaignId: string) {
    return {
      campaignId,
      mode: "fixture" as const,
      files: [...packageFiles],
      archivePath: `/campaigns/${campaignId}/campaign.zip`,
    };
  }
}

export const createFixtureWorkflow = (initialState?: CampaignSnapshot, campaignId = "campaign-fixture") => {
  const renderer = new FixtureRenderProvider();
  return createCampaignWorkflow(
    {
      analyst: new FixtureBrandMarketAnalyst(),
      director: new FixtureCreativeDirector(),
      producer: new FixtureVideoProducer(renderer),
      critic: new FixtureCreativeCritic(),
    },
    { packager: new FixturePackageProvider(), sourceProfile: new FixtureSourceProfileProvider() },
    campaignId,
    initialState,
  );
};
