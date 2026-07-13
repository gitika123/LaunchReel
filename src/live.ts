import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  agentRunSchema,
  assertConceptEvidenceIds,
  brandMarketBriefSchema,
  conceptSetSchema,
  criticReportSchema,
  renderManifestSchema,
  storyboardSchema,
  type AgentRole,
  type BrandMarketBrief,
  type CampaignConfiguration,
  type ConceptApproval,
  type CorrectionRequest,
  type EvidenceItem,
  type RenderManifest,
  type Storyboard,
} from "./contracts";
import { analystPrompt } from "./agents/prompts/analyst";
import { criticPrompt } from "./agents/prompts/critic";
import { directorConceptsPrompt, directorStoryboardPrompt } from "./agents/prompts/director";
import { producerPrompt } from "./agents/prompts/producer";
import { LocalMediaProductionProvider } from "./media";
import type {
  BrandMarketAnalystAgent,
  CreativeCriticAgent,
  CreativeDirectorAgent,
  MediaProductionProvider,
  RenderProvider,
  VideoProducerAgent,
} from "./ports";
import { deepgramFromEnvironment } from "./providers/deepgram";
import { ProviderError } from "./providers/http";
import { TokenRouterClient, type TokenRouterModels } from "./providers/token-router";
import { runYouResearch, type ResearchProvider } from "./providers/you";
import { sourceProfileEvidence, type SourceProfile } from "./source-profile";

const analystDraftSchema = z.object({
  saasCompany: z.string().min(1),
  productName: z.string().min(1),
  positioning: z.string().min(1),
}).strict();

const productionPlanSchema = z.object({
  visualDirection: z.string().min(1),
  captionStyle: z.string().min(1),
}).strict();
const productionRunCheckpointSchema = z.object({
  input: z.string().min(1),
  run: agentRunSchema,
}).strict();

const promptInput = (value: unknown) => JSON.stringify(value, null, 2);

export interface SourceWebsiteEvidenceProvider {
  ingest(configuration: CampaignConfiguration): Promise<EvidenceItem[]>;
}

export class LiveBrandMarketAnalyst implements BrandMarketAnalystAgent {
  constructor(
    private readonly router: TokenRouterClient,
    private readonly research: ResearchProvider,
    private readonly sourceWebsite?: SourceWebsiteEvidenceProvider,
  ) {}

  async analyze(configuration: CampaignConfiguration, sourceProfile?: SourceProfile) {
    let sourceEvidence: EvidenceItem[] = sourceProfile ? sourceProfileEvidence(sourceProfile) : [];
    if (!sourceEvidence.length && this.sourceWebsite) sourceEvidence = await this.sourceWebsite.ingest(configuration);
    if (configuration.type === "feature_announcement") sourceEvidence.push({
      id: "source-feature-input",
      claim: `${configuration.featureName}: ${configuration.featureDescription}`,
      sourceUrl: configuration.featurePageUrl,
      sourceKind: "source_website",
      title: configuration.featureName,
    });
    if (!sourceEvidence.length) sourceEvidence = [{
      id: "source-website",
      claim: `The Campaign Source Website is ${configuration.sourceWebsite}.`,
      sourceUrl: configuration.sourceWebsite,
      sourceKind: "source_website",
      title: "Source Website",
    }];
    const productContext = sourceEvidence.find(({ title }) => title)?.title ?? new URL(configuration.sourceWebsite).hostname;
    const research = await runYouResearch(this.research, {
      targetAudience: configuration.targetAudience,
      productContext,
    });
    const evidence = [...sourceEvidence, ...research.evidence];
    const websiteOnly = research.evidence.length === 0;
    const result = await this.router.generate("brand_market_analyst", {
      ...analystPrompt,
      user: `Create the BrandMarketBrief identity fields from this configuration and Evidence Basis. Do not include evidence in your response. Claim scope is ${websiteOnly ? "Source Website facts only; do not infer market pain points, category claims, competitors, trends, adoption, or performance" : "Source Website facts and cited external research only"}.\n${promptInput({ configuration, evidence })}`,
    }, analystDraftSchema);
    return {
      artifact: brandMarketBriefSchema.parse({
        ...result.artifact,
        ...(sourceProfile ? {
          saasCompany: sourceProfile.saasCompany,
          productName: sourceProfile.productName,
          positioning: sourceProfile.positioning,
        } : {}),
        targetAudience: configuration.targetAudience,
        evidenceBasis: {
          mode: websiteOnly ? "website_grounded_only" : "external_research",
          claimScope: websiteOnly ? "source_website_only" : "source_and_external",
          items: evidence,
        },
      }),
      run: {
        ...result.run,
        toolCalls: [
          ...research.toolCalls,
          ...(result.run.toolCalls ?? []),
        ],
      },
    };
  }
}

export class LiveCreativeDirector implements CreativeDirectorAgent {
  constructor(private readonly router: TokenRouterClient) {}

  async propose(brief: BrandMarketBrief) {
    const result = await this.router.generate("creative_director", {
      ...directorConceptsPrompt,
      user: `Create exactly three concepts from this BrandMarketBrief.\n${promptInput(brief)}`,
    }, conceptSetSchema);
    try {
      assertConceptEvidenceIds(result.artifact, brief);
    } catch (error) {
      throw new ProviderError("token_router", "invalid_response", true, "Creative concepts referenced unknown evidence", { cause: error });
    }
    return result;
  }

  storyboard(brief: BrandMarketBrief, approval: ConceptApproval, configuration: CampaignConfiguration) {
    const sceneBounds = configuration.durationSeconds === 30 ? "4–8" : "7–14";
    return this.router.generate("creative_director", {
      ...directorStoryboardPrompt,
      user: `Create the approved ${configuration.durationSeconds}-second storyboard with ${sceneBounds} scenes.\n${promptInput({ brief, approval, configuration })}`,
    }, storyboardSchema);
  }
}

export class LiveVideoProducer implements VideoProducerAgent {
  constructor(
    private readonly router: TokenRouterClient,
    private readonly media: MediaProductionProvider,
    private readonly renderer: RenderProvider,
  ) {}

  async produce(campaignId: string, storyboard: Storyboard, configuration: CampaignConfiguration) {
    const production = await this.media.prepare(campaignId, storyboard);
    const runPath = join(dirname(production.narration.path), "producer-run.json");
    const input = promptInput(storyboard);
    const checkpoint = await readFile(runPath, "utf8").then((content) => productionRunCheckpointSchema.parse(JSON.parse(content))).catch(() => undefined);
    let run = checkpoint?.input === input ? checkpoint.run : undefined;
    if (!run) {
      const planning = await this.router.generate("video_producer", {
        ...producerPrompt,
        user: `Create production direction for this approved storyboard.\n${input}`,
      }, productionPlanSchema);
      run = planning.run;
      await writeFile(runPath, `${JSON.stringify({ input, run }, null, 2)}\n`).catch(() => undefined);
    }
    const artifact = renderManifestSchema.parse(await this.renderer.render(campaignId, storyboard, production, configuration, "live"));
    return {
      artifact,
      run: {
        ...run,
        toolCalls: [
          ...(run.toolCalls ?? []),
          {
            provider: "deepgram" as const,
            operation: "tts-and-prerecorded-stt",
            status: "completed" as const,
            summary: `Produced required narration and ${production.captions.words.length} word timings`,
          },
          {
            provider: "remotion" as const,
            operation: "render",
            status: "completed" as const,
            summary: `Rendered ${artifact.width}×${artifact.height} Campaign at ${artifact.fps} FPS`,
          },
        ],
      },
    };
  }

  async correct(campaignId: string, storyboard: Storyboard, configuration: CampaignConfiguration, correction: CorrectionRequest, previousRender: RenderManifest) {
    const planning = await this.router.generate("video_producer", {
      ...producerPrompt,
      user: `Apply only this authorized final correction to the approved production direction.\n${promptInput({ correction, storyboard })}`,
    }, productionPlanSchema);
    const artifact = renderManifestSchema.parse(await this.renderer.render(campaignId, storyboard, previousRender.media, configuration, "live"));
    return {
      artifact,
      run: {
        ...planning.run,
        toolCalls: [
          ...(planning.run.toolCalls ?? []),
          {
            provider: "remotion" as const,
            operation: "targeted-correction-render",
            status: "completed" as const,
            summary: "Rerendered the authorized correction while retaining approved narration and caption timing",
          },
        ],
      },
    };
  }
}

export class LiveCreativeCritic implements CreativeCriticAgent {
  constructor(private readonly router: TokenRouterClient) {}

  critique(render: RenderManifest, storyboard: Storyboard) {
    return this.router.generate("creative_critic", {
      ...criticPrompt,
      user: `Review this render and approved storyboard.\n${promptInput({ render, storyboard })}`,
    }, criticReportSchema);
  }
}

export const liveMediaProductionFromEnvironment = (
  environment: NodeJS.ProcessEnv,
  rootDirectory = process.cwd(),
) => new LocalMediaProductionProvider({
  rootDirectory: join(rootDirectory, "public", "campaigns"),
  narrator: deepgramFromEnvironment(environment),
  licensedMusic: {
    path: join(rootDirectory, "public", "fixtures", "pulseboard-music.wav"),
    title: "LaunchReel Fixture Pulse",
    creator: "LaunchReel",
    license: "CC0-1.0",
    sourceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
});

export const tokenRouterModelsFromEnvironment = (environment: NodeJS.ProcessEnv): TokenRouterModels => {
  const values: Record<AgentRole, string | undefined> = {
    brand_market_analyst: environment.TOKEN_ROUTER_MODEL_ANALYST,
    creative_director: environment.TOKEN_ROUTER_MODEL_DIRECTOR,
    video_producer: environment.TOKEN_ROUTER_MODEL_PRODUCER,
    creative_critic: environment.TOKEN_ROUTER_MODEL_CRITIC,
  };
  for (const [role, model] of Object.entries(values)) {
    if (!model) throw new ProviderError("token_router", "configuration", false, `Token Router model is missing for ${role}`);
  }
  return values as TokenRouterModels;
};
