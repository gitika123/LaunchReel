import { z } from "zod";
import { campaignDurationSecondsSchema, campaignTypeSchema } from "./contracts";

export const DEMO_SOURCE_URL_ENV = "LAUNCHREEL_DEMO_SOURCE_URL" as const;
export const DEMO_FEATURE_URL_ENV = "LAUNCHREEL_DEMO_FEATURE_URL" as const;

const presetBase = {
  label: z.string().trim().min(1),
  campaignType: campaignTypeSchema,
  sourceWebsiteEnvironmentVariable: z.literal(DEMO_SOURCE_URL_ENV),
  targetAudience: z.string().trim().min(1),
  durationSeconds: campaignDurationSecondsSchema,
  creativeDirection: z.string().trim().min(1),
  callToAction: z.string().trim().min(1),
  operatorNotes: z.string().trim().min(1),
};

export const canonicalJudgingPresetSchema = z.discriminatedUnion("campaignType", [
  z.object({
    ...presetBase,
    campaignType: z.literal("product_launch"),
  }).strict(),
  z.object({
    ...presetBase,
    campaignType: z.literal("feature_announcement"),
    featureName: z.string().trim().min(1).optional(),
    factualFeatureDescription: z.string().trim().min(1).optional(),
    featurePageEnvironmentVariable: z.literal(DEMO_FEATURE_URL_ENV),
  }).strict(),
]);

export const canonicalJudgingPreset = canonicalJudgingPresetSchema.parse({
  label: "LaunchReel canonical judging demo",
  campaignType: "feature_announcement",
  sourceWebsiteEnvironmentVariable: DEMO_SOURCE_URL_ENV,
  targetAudience: "SaaS marketing teams that need a reviewable, evidence-grounded vertical launch video",
  durationSeconds: 30,
  featureName: "Human approval gates",
  factualFeatureDescription: "Source-profile, concept, and storyboard decisions remain explicit before final campaign delivery.",
  featurePageEnvironmentVariable: DEMO_FEATURE_URL_ENV,
  creativeDirection: "Editorial and assured: make the human decisions visible, keep evidence legible, and avoid unsupported claims.",
  callToAction: "Build your next launch reel",
  operatorNotes: "Apply the preset, verify both environment-backed URLs, then review every editable field. Applying does not open production.",
});

const browserInputUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHostname = hostname === "localhost" || hostname.endsWith(".localhost") || /^(0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) || hostname === "::1" || /^(fc|fd|fe80):/i.test(hostname);
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && !privateHostname;
}, "Expected a public HTTP or HTTPS URL without credentials");

const configurationIssueSchema = z.object({
  environmentVariable: z.enum([DEMO_SOURCE_URL_ENV, DEMO_FEATURE_URL_ENV]),
  reason: z.enum(["missing", "invalid_url"]),
}).strict();

export const judgingPresetResponseSchema = z.object({
  preset: canonicalJudgingPresetSchema,
  formInputs: z.object({
    sourceWebsite: browserInputUrlSchema.optional(),
    featurePageUrl: browserInputUrlSchema.optional(),
  }).strict(),
  configuration: z.object({
    ready: z.boolean(),
    issues: z.array(configurationIssueSchema),
  }).strict(),
}).strict();

export type CanonicalJudgingPreset = z.infer<typeof canonicalJudgingPresetSchema>;
export type JudgingPresetResponse = z.infer<typeof judgingPresetResponseSchema>;

const readBrowserInputUrl = (
  environment: NodeJS.ProcessEnv,
  environmentVariable: typeof DEMO_SOURCE_URL_ENV | typeof DEMO_FEATURE_URL_ENV,
) => {
  const value = environment[environmentVariable]?.trim();
  if (!value) return { issue: { environmentVariable, reason: "missing" as const } };
  const parsed = browserInputUrlSchema.safeParse(value);
  if (!parsed.success) return { issue: { environmentVariable, reason: "invalid_url" as const } };
  return { value: parsed.data };
};

export const getBrowserSafeJudgingPreset = (environment: NodeJS.ProcessEnv = process.env): JudgingPresetResponse => {
  const sourceWebsite = readBrowserInputUrl(environment, canonicalJudgingPreset.sourceWebsiteEnvironmentVariable);
  const featurePageUrl = canonicalJudgingPreset.campaignType === "feature_announcement"
    ? readBrowserInputUrl(environment, canonicalJudgingPreset.featurePageEnvironmentVariable)
    : undefined;
  const issues = [sourceWebsite.issue, featurePageUrl?.issue].filter((issue) => issue !== undefined);

  return judgingPresetResponseSchema.parse({
    preset: canonicalJudgingPreset,
    formInputs: {
      ...(sourceWebsite.value ? { sourceWebsite: sourceWebsite.value } : {}),
      ...(featurePageUrl?.value ? { featurePageUrl: featurePageUrl.value } : {}),
    },
    configuration: {
      ready: issues.length === 0,
      issues,
    },
  });
};
