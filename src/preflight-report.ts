import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const PREFLIGHT_COMMAND = "npm run preflight:live" as const;
export const PREFLIGHT_CURRENT_FOR_MS = 24 * 60 * 60 * 1000;

const statusSchema = z.enum(["PASS", "WARN", "BLOCKED"]);
const countsSchema = z.object({
  PASS: z.number().int().nonnegative(),
  WARN: z.number().int().nonnegative(),
  BLOCKED: z.number().int().nonnegative(),
}).strict();

export const redactedPreflightReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  command: z.literal(PREFLIGHT_COMMAND),
  outcome: statusSchema,
  scope: z.literal("local-configuration"),
  providerConnectivityChecked: z.literal(false),
  redaction: z.object({
    credentialsIncluded: z.literal(false),
    environmentValuesIncluded: z.literal(false),
    privateIdentifiersIncluded: z.literal(false),
    urlsIncluded: z.literal(false),
    absolutePathsIncluded: z.literal(false),
  }).strict(),
  counts: countsSchema,
  checks: z.array(z.object({
    label: z.string().min(1).max(100),
    status: statusSchema,
  }).strict()).max(50),
}).strict().superRefine((report, context) => {
  const actualCounts = {
    PASS: report.checks.filter(({ status }) => status === "PASS").length,
    WARN: report.checks.filter(({ status }) => status === "WARN").length,
    BLOCKED: report.checks.filter(({ status }) => status === "BLOCKED").length,
  };
  for (const status of statusSchema.options) {
    if (report.counts[status] !== actualCounts[status]) {
      context.addIssue({ code: "custom", message: `${status} count does not match checks`, path: ["counts", status] });
    }
  }
});

export type RedactedPreflightReport = z.infer<typeof redactedPreflightReportSchema>;
export type PreflightReportState =
  | { freshness: "never-run" }
  | { freshness: "stale" | "current"; report: RedactedPreflightReport };

export const localPreflightReportPath = () => join(process.cwd(), ".cache", "preflight", "live-report.json");

export const readLocalPreflightReport = async (now = Date.now()): Promise<PreflightReportState> => {
  try {
    const parsed = redactedPreflightReportSchema.safeParse(JSON.parse(await readFile(localPreflightReportPath(), "utf8")));
    if (!parsed.success) return { freshness: "never-run" };
    const age = now - Date.parse(parsed.data.generatedAt);
    return {
      freshness: age >= 0 && age <= PREFLIGHT_CURRENT_FOR_MS ? "current" : "stale",
      report: parsed.data,
    };
  } catch {
    return { freshness: "never-run" };
  }
};
