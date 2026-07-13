import type { SourceProfile, SourceProfileProvider } from "./source-profile";
import type {
  AgentRun,
  BrandMarketBrief,
  CampaignConfiguration,
  ConceptApproval,
  CorrectionRequest,
  ConceptSet,
  CriticReport,
  EvidenceItem,
  MediaProduction,
  PackageManifest,
  RenderManifest,
  Storyboard,
} from "./contracts";

export interface AgentResult<T> {
  artifact: T;
  run: AgentRun;
}

export interface BrandMarketAnalystAgent {
  analyze(configuration: CampaignConfiguration, sourceProfile: SourceProfile): Promise<AgentResult<BrandMarketBrief>>;
}

export interface CreativeDirectorAgent {
  propose(brief: BrandMarketBrief): Promise<AgentResult<ConceptSet>>;
  storyboard(brief: BrandMarketBrief, approval: ConceptApproval, configuration: CampaignConfiguration): Promise<AgentResult<Storyboard>>;
}

export interface VideoProducerAgent {
  produce(campaignId: string, storyboard: Storyboard, configuration: CampaignConfiguration): Promise<AgentResult<RenderManifest>>;
  correct?(campaignId: string, storyboard: Storyboard, configuration: CampaignConfiguration, correction: CorrectionRequest, previousRender: RenderManifest): Promise<AgentResult<RenderManifest>>;
}

export interface CreativeCriticAgent {
  critique(render: RenderManifest, storyboard: Storyboard): Promise<AgentResult<CriticReport>>;
}

export interface MediaProductionProvider {
  prepare(campaignId: string, storyboard: Storyboard): Promise<MediaProduction>;
}

export interface RenderProvider {
  render(campaignId: string, storyboard: Storyboard, media: MediaProduction, configuration: CampaignConfiguration, mode?: "fixture" | "live" | "cached"): Promise<RenderManifest>;
}

export interface PackageContext {
  storyboard: Storyboard;
  sourceProfile: SourceProfile;
  citations: EvidenceItem[];
  ctaVariants: string[];
  correction?: CorrectionRequest;
}

export interface PackageProvider {
  package(campaignId: string, render: RenderManifest, report: CriticReport, context: PackageContext): Promise<PackageManifest>;
}

export interface CampaignAgents {
  analyst: BrandMarketAnalystAgent;
  director: CreativeDirectorAgent;
  producer: VideoProducerAgent;
  critic: CreativeCriticAgent;
}

export interface CampaignProviders {
  packager: PackageProvider;
  sourceProfile: SourceProfileProvider;
}
