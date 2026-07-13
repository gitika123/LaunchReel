import { parseQaArgs } from "../src/qa/cli";
import { loadCampaignSnapshot, runCampaignQa } from "../src/qa/campaign-qa";

try {
  const options = parseQaArgs(process.argv.slice(2));
  const snapshot = options.snapshotPath ? await loadCampaignSnapshot(options.snapshotPath) : undefined;
  const report = await runCampaignQa({ archivePath: options.archivePath, outputDirectory: options.outputDirectory, snapshot });
  console.log(`Campaign ${report.campaignId}: ${report.outcome}`);
  console.log(report.paths.markdownSummary);
  if (report.outcome === "failed") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Campaign QA failed");
  process.exitCode = 1;
}
