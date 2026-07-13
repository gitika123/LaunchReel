import { parseBandWave1Args, runBandWave1Verification, writeBandWave1Report } from "./band-wave1-verifier";

const usage = "Usage: npm run verify:band-wave1 -- [--live]";

try {
  const { live } = parseBandWave1Args(process.argv.slice(2));
  const report = await runBandWave1Verification({ live });
  const paths = await writeBandWave1Report(report);

  console.log(`Band Wave 1 verification: ${report.outcome} (${report.mode})`);
  for (const item of report.config) {
    console.log(`${item.name}: ${item.present ? "present" : "missing"}${item.required ? " (required for --live)" : " (optional)"}`);
  }
  console.log(`Network calls: ${report.checks.networkCalls}`);
  console.log(`Reports: ${paths.jsonPath}; ${paths.markdownPath}`);

  if (live && report.outcome !== "success") process.exitCode = 1;
} catch (error) {
  console.error(usage);
  console.error(error instanceof Error ? error.message : "Invalid arguments");
  process.exitCode = 2;
}
