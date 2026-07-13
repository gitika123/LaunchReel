import { z } from "zod";
import type { CampaignConfiguration } from "./contracts";
import type { IngestionWarning, SourceWebsiteResult } from "./ingestion";
import { campaignAssetSchema, type CampaignAsset } from "./source-assets";

const attributedProfileTextSchema = z.object({
  value: z.string().trim().min(1),
  sourcePageUrl: z.string().url(),
}).strict();

const ingestionWarningSchema = z.object({
  code: z.enum(["page_load_failed", "page_timeout", "total_timeout", "http_error", "unsupported_content_type", "response_too_large"]),
  url: z.string().url(),
  message: z.string().min(1),
}).strict();

export const sourceProfileSchema = z.object({
  sourceWebsite: z.string().url(),
  saasCompany: z.string().trim().min(1).max(200),
  productName: z.string().trim().min(1).max(200),
  positioning: z.string().trim().min(1).max(2000),
  description: z.string().trim().min(1).max(4000),
  colors: z.array(z.string().trim().min(1).max(100)).max(20),
  callsToAction: z.array(z.string().trim().min(1).max(300)).max(20),
  claims: z.array(attributedProfileTextSchema).min(1).max(50),
  assets: z.array(campaignAssetSchema).max(40),
  warnings: z.array(ingestionWarningSchema).max(20),
  pagesCrawled: z.number().int().min(1).max(5),
}).strict();

export const sourceProfileApprovalSchema = z.object({
  saasCompany: z.string().trim().min(1).max(200),
  productName: z.string().trim().min(1).max(200),
  positioning: z.string().trim().min(1).max(2000),
  description: z.string().trim().min(1).max(4000),
  colors: z.array(z.string().trim().min(1).max(100)).max(20),
  callsToAction: z.array(z.string().trim().min(1).max(300)).max(20),
}).strict();

export type SourceProfile = z.infer<typeof sourceProfileSchema>;
export type SourceProfileApproval = z.infer<typeof sourceProfileApprovalSchema>;

export interface SourceProfileProvider {
  extract(configuration: CampaignConfiguration): Promise<SourceProfile>;
}

const textValues = (items: Array<{ value: string }>, maximum: number) => [...new Set(items.map(({ value }) => value))].slice(0, maximum);

const sourceAssets = (result: SourceWebsiteResult): CampaignAsset[] => {
  const assets = [...result.logoCandidates, ...result.images, ...result.screenshots];
  const seen = new Set<string>();
  return assets.flatMap((asset, index) => {
    if (seen.has(asset.url)) return [];
    seen.add(asset.url);
    return [campaignAssetSchema.parse({
      id: `source-${index + 1}`,
      name: asset.alt || asset.kind.replace("_", " "),
      provenance: "source",
      uri: asset.url,
      ...(asset.mediaType === "image/png" || asset.mediaType === "image/jpeg" || asset.mediaType === "image/webp" ? { mediaType: asset.mediaType } : {}),
      sourcePageUrl: asset.attribution.sourcePageUrl,
      sourceUrl: asset.attribution.sourceUrl ?? asset.url,
      ...(asset.kind === "logo" || asset.kind === "icon" ? { contentRole: "logo" as const } : {}),
    })];
  }).slice(0, 40);
};

export const sourceProfileFromIngestion = (result: SourceWebsiteResult): SourceProfile => {
  const title = result.metadata.title?.value ?? result.headings[0]?.value ?? new URL(result.sourceWebsite).hostname;
  const description = result.metadata.description?.value ?? result.body[0]?.value ?? result.headings[0]?.value ?? title;
  const claims = [...result.claims, ...result.headings].slice(0, 50).map((claim) => ({
    value: claim.value,
    sourcePageUrl: claim.attribution.sourcePageUrl,
  }));
  if (!claims.length) claims.push({ value: description, sourcePageUrl: result.sourceWebsite });
  return sourceProfileSchema.parse({
    sourceWebsite: result.sourceWebsite,
    saasCompany: title,
    productName: title,
    positioning: description,
    description,
    colors: textValues(result.colors, 20),
    callsToAction: textValues(result.callsToAction, 20),
    claims,
    assets: sourceAssets(result),
    warnings: result.warnings,
    pagesCrawled: result.pages.length,
  });
};

export const applySourceProfileApproval = (profile: SourceProfile, approval: SourceProfileApproval) => sourceProfileSchema.parse({
  ...profile,
  ...sourceProfileApprovalSchema.parse(approval),
});

export const sourceProfileEvidence = (profile: SourceProfile) => profile.claims.map((claim, index) => ({
  id: `source-${index + 1}`,
  claim: claim.value,
  sourceUrl: claim.sourcePageUrl,
  sourceKind: "source_website" as const,
  title: profile.productName,
}));

export const fixtureSourceProfile = (configuration: CampaignConfiguration): SourceProfile => sourceProfileSchema.parse({
  sourceWebsite: configuration.sourceWebsite,
  saasCompany: "LaunchReel Fixture Labs",
  productName: "LaunchReel",
  positioning: "An autonomous creative company that turns a SaaS Source Website into a complete launch Campaign.",
  description: "LaunchReel coordinates evidence-backed product launch Campaigns through visible human approvals.",
  colors: ["#315cff", "#ff5b45"],
  callsToAction: ["Build your launch"],
  claims: [{ value: "LaunchReel coordinates complete product launch Campaigns.", sourcePageUrl: configuration.sourceWebsite }],
  assets: [{
    id: "source-fixture",
    name: "LaunchReel Source Website",
    provenance: "source",
    uri: "/fixtures/scene-2.png",
    sourcePageUrl: configuration.sourceWebsite,
    sourceUrl: configuration.sourceWebsite,
    contentRole: "product_ui",
  }],
  warnings: [],
  pagesCrawled: 1,
});

export class FixtureSourceProfileProvider implements SourceProfileProvider {
  async extract(configuration: CampaignConfiguration) {
    return fixtureSourceProfile(configuration);
  }
}

export type { IngestionWarning };
