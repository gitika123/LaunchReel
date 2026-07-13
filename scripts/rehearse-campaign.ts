import { parseRehearsalArgs, runRehearsal } from "../src/rehearsal";

try {
  const report = await runRehearsal(parseRehearsalArgs(process.argv.slice(2)));
  console.log(`Campaign ${report.campaignId}: ${report.outcome}`);
  console.log(report.finalPaths.rehearsalSummary);
  if (report.outcome === "failed") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Campaign rehearsal failed");
  process.exitCode = 1;
}
