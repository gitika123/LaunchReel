import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalJudgingPreset, canonicalJudgingPresetSchema, DEMO_SOURCE_URL_ENV } from "../src/judging-preset";
import { localPreflightReportPath, PREFLIGHT_COMMAND, redactedPreflightReportSchema } from "../src/preflight-report";

type Status = "PASS" | "WARN" | "BLOCKED";
type Facts = Record<string, boolean | number | string | string[]>;
interface Check {
  id: string;
  label: string;
  status: Status;
  summary: string;
  facts: Facts;
}

const rootDirectory = process.cwd();
const localEnvironmentPath = join(rootDirectory, ".env.local");
const checks: Check[] = [];
const add = (id: string, label: string, status: Status, summary: string, facts: Facts = {}) => checks.push({ id, label, status, summary, facts });
const present = (environment: NodeJS.ProcessEnv, name: string) => Boolean(environment[name]?.trim());

const parseEnvironment = (content: string) => {
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    parsed[match[1]!] = value;
  }
  return parsed;
};

const environment = { ...process.env };
try {
  const localEnvironment = parseEnvironment(await readFile(localEnvironmentPath, "utf8"));
  for (const [name, value] of Object.entries(localEnvironment)) if (environment[name] === undefined) environment[name] = value;
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") add("environment.file", "Local environment", "BLOCKED", "The local environment file could not be read.", { fileName: ".env.local" });
}

const requiredNames = (id: string, label: string, names: readonly string[]) => {
  const missing = names.filter((name) => !present(environment, name));
  add(id, label, missing.length ? "BLOCKED" : "PASS", missing.length ? `${missing.length} required variable(s) are missing.` : "All required variable names are present.", {
    requiredNames: [...names],
    presentNames: names.filter((name) => !missing.includes(name)),
    missingNames: missing,
  });
};

const safeUrlFacts = (value: string | undefined, allowHttpLocalhost = false): Facts => {
  if (!value?.trim()) return { configured: false, valid: false, browserSafe: false };
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const localhost = hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1";
    const privateHostname = localhost || /^(0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) || /^(fc|fd|fe80):/i.test(hostname);
    const permittedProtocol = url.protocol === "https:" || (allowHttpLocalhost && url.protocol === "http:" && localhost);
    return {
      configured: true,
      valid: true,
      browserSafe: !url.username && !url.password && permittedProtocol && (allowHttpLocalhost ? !privateHostname || localhost : !privateHostname),
      https: url.protocol === "https:",
      containsCredentials: Boolean(url.username || url.password),
      privateHost: privateHostname,
    };
  } catch {
    return { configured: true, valid: false, browserSafe: false };
  }
};

const modeLive = environment.LAUNCHREEL_MODE?.trim() === "live";
add("runtime.mode", "Runtime mode", modeLive ? "PASS" : "BLOCKED", modeLive ? "Runtime mode is live." : "LAUNCHREEL_MODE must select live mode.", {
  envName: "LAUNCHREEL_MODE",
  present: present(environment, "LAUNCHREEL_MODE"),
  live: modeLive,
});

requiredNames("token-router.variables", "Token Router variables", [
  "TOKEN_ROUTER_API_KEY",
  "TOKEN_ROUTER_BASE_URL",
  "TOKEN_ROUTER_MODEL_ANALYST",
  "TOKEN_ROUTER_MODEL_DIRECTOR",
  "TOKEN_ROUTER_MODEL_PRODUCER",
  "TOKEN_ROUTER_MODEL_CRITIC",
]);
checks.at(-1)!.facts.modelRoles = ["brand_market_analyst", "creative_director", "video_producer", "creative_critic"];
const routerBaseFacts = safeUrlFacts(environment.TOKEN_ROUTER_BASE_URL);
add("token-router.base", "Token Router base", routerBaseFacts.browserSafe ? "PASS" : "BLOCKED", routerBaseFacts.browserSafe ? "Configured base is browser-safe HTTPS." : "Configured base must be an HTTPS URL without embedded credentials.", {
  envName: "TOKEN_ROUTER_BASE_URL",
  ...routerBaseFacts,
});

requiredNames("you.variables", "You.com variables", ["YDC_API_KEY", "YDC_BASE_URL"]);
const youBaseFacts = safeUrlFacts(environment.YDC_BASE_URL);
add("you.base", "You.com base", youBaseFacts.browserSafe ? "PASS" : "BLOCKED", youBaseFacts.browserSafe ? "Configured base is browser-safe HTTPS." : "YDC_BASE_URL must be a public HTTPS URL without embedded credentials.", {
  envName: "YDC_BASE_URL",
  ...youBaseFacts,
});

requiredNames("deepgram.variables", "Deepgram variables", ["DEEPGRAM_API_KEY", "DEEPGRAM_TTS_MODEL"]);

const bandNames = [
  "BAND_CHAT_ID",
  "BAND_ANALYST_AGENT_ID", "BAND_ANALYST_AGENT_API_KEY",
  "BAND_DIRECTOR_AGENT_ID", "BAND_DIRECTOR_AGENT_API_KEY",
  "BAND_PRODUCER_AGENT_ID", "BAND_PRODUCER_AGENT_API_KEY",
  "BAND_CRITIC_AGENT_ID", "BAND_CRITIC_AGENT_API_KEY",
] as const;
requiredNames("band.variables", "Band room and agent credentials", bandNames);
const bandBase = environment.BAND_REST_URL?.trim() || "https://app.band.ai";
const bandBaseFacts = safeUrlFacts(bandBase, true);
add("band.base", "Band REST base", bandBaseFacts.browserSafe ? "PASS" : "BLOCKED", bandBaseFacts.browserSafe ? "Band REST base is browser-safe; the application default is used when unconfigured." : "Band REST base must be HTTPS, or HTTP on localhost, without embedded credentials.", {
  envName: "BAND_REST_URL",
  usingApplicationDefault: !present(environment, "BAND_REST_URL"),
  ...bandBaseFacts,
});
const roomUrlFacts = safeUrlFacts(environment.BAND_ROOM_URL);
add("band.display-url", "Band display URL", !roomUrlFacts.configured || roomUrlFacts.browserSafe ? "PASS" : "WARN", !roomUrlFacts.configured ? "Optional display URL is not configured." : roomUrlFacts.browserSafe ? "Optional display URL is browser-safe." : "Optional display URL is invalid or unsafe and will be ignored.", {
  envName: "BAND_ROOM_URL",
  optional: true,
  ...roomUrlFacts,
});

const nearestExistingDirectory = async (path: string): Promise<string | undefined> => {
  let candidate = resolve(path);
  while (true) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch { /* inspect the nearest existing parent without creating anything */ }
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
};
const writableFacts = async (path: string): Promise<Facts> => {
  const existing = await nearestExistingDirectory(path);
  if (!existing) return { targetExists: false, writable: false };
  try {
    await access(existing, constants.W_OK);
    return { targetExists: existing === resolve(path), nearestExistingParentWritable: true, writable: true };
  } catch {
    return { targetExists: existing === resolve(path), nearestExistingParentWritable: false, writable: false };
  }
};

const configuredDataDirectory = environment.LAUNCHREEL_DATA_DIR?.trim();
const dataDirectory = configuredDataDirectory ? resolve(rootDirectory, configuredDataDirectory) : join(rootDirectory, "data", "campaigns");
const liveDataDirectory = join(dataDirectory, "live");
const dataWritable = await writableFacts(liveDataDirectory);
add("campaign.storage", "Campaign data storage", dataWritable.writable ? "PASS" : "BLOCKED", dataWritable.writable ? "Resolved live Campaign storage is writable or has a writable existing parent." : "Resolved live Campaign storage is not writable.", {
  envName: "LAUNCHREEL_DATA_DIR",
  source: configuredDataDirectory ? "environment" : "application-default",
  configuredPathAbsolute: configuredDataDirectory ? isAbsolute(configuredDataDirectory) : false,
  ...dataWritable,
});

let activeCampaignCount = 0;
try {
  const activeEntries = await readdir(join(liveDataDirectory, "active"), { withFileTypes: true });
  activeCampaignCount += activeEntries.filter((entry) => entry.isDirectory()).length;
} catch { /* missing/unreadable is reported only as presence, without changing storage */ }
try {
  if ((await stat(join(liveDataDirectory, "current", "campaign.json"))).isFile()) activeCampaignCount += 1;
} catch { /* no legacy active Campaign */ }
add("campaign.active", "Active live Campaign", activeCampaignCount === 1 ? "PASS" : "WARN", activeCampaignCount === 1 ? "Exactly one active live Campaign is present." : activeCampaignCount === 0 ? "No active live Campaign is present; starting one remains possible." : "Multiple active live Campaign locations were detected.", {
  present: activeCampaignCount > 0,
  count: activeCampaignCount,
  expectedMaximum: 1,
});

const fileExists = async (path: string) => {
  try { return (await stat(path)).isFile(); } catch { return false; }
};
const remotionCliCandidates = process.platform === "win32"
  ? [join(rootDirectory, "node_modules", ".bin", "remotion.cmd"), join(rootDirectory, "node_modules", ".bin", "remotion")]
  : [join(rootDirectory, "node_modules", ".bin", "remotion")];
const [cliCandidates, entryPresent, fallbackPresent] = await Promise.all([
  Promise.all(remotionCliCandidates.map(fileExists)),
  fileExists(join(rootDirectory, "src", "index.ts")),
  fileExists(join(rootDirectory, "public", "fixtures", "pulseboard-music.wav")),
]);
add("media.inputs", "Media production inputs", cliCandidates.some(Boolean) && entryPresent && fallbackPresent ? "PASS" : "BLOCKED", cliCandidates.some(Boolean) && entryPresent && fallbackPresent ? "Local media CLI, entry point, and licensed fallback are present." : "One or more required local media inputs are missing.", {
  cliPresent: cliCandidates.some(Boolean),
  entryPresent,
  licensedFallbackPresent: fallbackPresent,
});
const mediaOutputDirectory = join(rootDirectory, "public", "campaigns");
const outputWritable = await writableFacts(mediaOutputDirectory);
add("media.output", "Media output storage", outputWritable.writable ? "PASS" : "BLOCKED", outputWritable.writable ? "Media output is writable or has a writable existing parent." : "Media output is not writable.", outputWritable);
try {
  const disk = await statfs((await nearestExistingDirectory(mediaOutputDirectory)) ?? rootDirectory);
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  const warningBytes = 2 * 1024 * 1024 * 1024;
  add("media.disk", "Media disk capacity", freeBytes >= warningBytes ? "PASS" : "WARN", freeBytes >= warningBytes ? "Available local disk is above the media warning threshold." : "Available local disk is below the 2 GiB media warning threshold.", {
    warningThresholdBytes: warningBytes,
    availableAtLeastWarningThreshold: freeBytes >= warningBytes,
  });
} catch {
  add("media.disk", "Media disk capacity", "WARN", "Local disk capacity could not be determined.", { availableAtLeastWarningThreshold: false });
}

const presetValidated = canonicalJudgingPresetSchema.safeParse(canonicalJudgingPreset).success;
const presetSourceFacts = safeUrlFacts(environment[DEMO_SOURCE_URL_ENV]);
const presetSourcePresent = present(environment, DEMO_SOURCE_URL_ENV);
const presetReady = presetValidated && presetSourcePresent && presetSourceFacts.browserSafe === true;
add("demo.preset", "Demo preset", presetReady ? "PASS" : "WARN", !presetSourcePresent ? "The demo Source Website variable is missing; the studio can still be configured manually." : !presetSourceFacts.browserSafe ? "The demo Source Website must be a public HTTPS URL without credentials." : !presetValidated ? "The canonical judging preset is invalid." : "Demo source, Campaign type, duration, and audience are configured and valid.", {
  sourceWebsiteEnvName: DEMO_SOURCE_URL_ENV,
  sourceWebsitePresent: presetSourcePresent,
  sourceWebsiteValid: presetSourceFacts.browserSafe === true,
  campaignTypeValid: ["product_launch", "feature_announcement"].includes(canonicalJudgingPreset.campaignType),
  durationValid: [30, 60].includes(canonicalJudgingPreset.durationSeconds),
  audiencePresent: canonicalJudgingPreset.targetAudience.trim().length > 0,
  presetValidated,
  optionalForLiveRuntime: true,
});

const outcome: Status = checks.some(({ status }) => status === "BLOCKED") ? "BLOCKED" : checks.some(({ status }) => status === "WARN") ? "WARN" : "PASS";
const counts = {
  PASS: checks.filter(({ status }) => status === "PASS").length,
  WARN: checks.filter(({ status }) => status === "WARN").length,
  BLOCKED: checks.filter(({ status }) => status === "BLOCKED").length,
};
const report = redactedPreflightReportSchema.parse({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  command: PREFLIGHT_COMMAND,
  outcome,
  scope: "local-configuration",
  providerConnectivityChecked: false,
  redaction: {
    credentialsIncluded: false,
    environmentValuesIncluded: false,
    privateIdentifiersIncluded: false,
    urlsIncluded: false,
    absolutePathsIncluded: false,
  },
  counts,
  checks: checks.map(({ label, status }) => ({ label, status })),
});
const reportPath = localPreflightReportPath();
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

console.log("LaunchReel local live-readiness preflight");
console.log("Local configuration only: no network, provider connectivity checks, Campaign/Band changes, or rendering");
for (const check of checks) console.log(`[${check.status}] ${check.label}: ${check.summary}`);
console.log(`Result: ${outcome} (${counts.PASS} PASS, ${counts.WARN} WARN, ${counts.BLOCKED} BLOCKED)`);
console.log("A redacted local report was saved for the demo launchpad.");
if (outcome === "BLOCKED") process.exitCode = 1;
