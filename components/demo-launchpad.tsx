import Link from "next/link";
import type { AgentRun, ToolCall } from "@/src/contracts";
import type { CampaignPresentationData } from "@/src/runtime";
import { PREFLIGHT_COMMAND, type PreflightReportState } from "@/src/preflight-report";
import { deriveBandProductionBoard } from "@/src/proof/production-report";
import type { CampaignSnapshot } from "@/src/workflow";

const providerNames = {
  you: "You.com",
  band: "Band",
  token_router: "Token Router",
  deepgram: "Deepgram",
  remotion: "Remotion",
} as const;

type Provider = keyof typeof providerNames;
type ProofTone = "recorded" | "degraded" | "pending" | "fixture";

type ProviderProof = {
  provider: Provider;
  state: string;
  detail: string;
  evidence: string;
  tone: ProofTone;
};

const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const safeLabel = (value: string | undefined, fallback = "Not recorded") => {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized || /(?:api[-_ ]?key|authorization|bearer|credential|password|secret|access[-_ ]?token)\s*[:=]/i.test(normalized) || /^(?:[a-z]:[\\/]|\\\\|\/(?:users|home|var|tmp|private|opt|srv)\/|file:)/i.test(normalized)) return fallback;
  return normalized.slice(0, 180);
};
const publicUrl = (value?: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const privateHostname = hostname === "localhost" || hostname.endsWith(".localhost") || /^(0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) || hostname === "::1" || /^(fc|fd|fe80):/i.test(hostname);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || privateHostname) return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/(?:api[-_]?key|auth|credential|password|secret|signature|token)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return undefined;
  }
};
const toolCalls = (snapshot: CampaignSnapshot | undefined, provider: Provider) => snapshot?.agentRuns.flatMap((run) => run.toolCalls ?? []).filter((call) => call.provider === provider) ?? [];
const toneForCalls = (calls: ToolCall[]): ProofTone => calls.some(({ status }) => status === "failed" || status === "degraded") ? "degraded" : calls.some(({ status }) => status === "completed") ? "recorded" : "pending";
const stateForCalls = (calls: ToolCall[]) => calls.some(({ status }) => status === "failed") ? "Failure recorded" : calls.some(({ status }) => status === "degraded") ? "Degradation recorded" : calls.some(({ status }) => status === "completed") ? "Activity recorded" : "Not recorded";

function ProviderMark({ provider }: { provider: Provider }) {
  const label = providerNames[provider];
  return (
    <span className={`demo-provider-mark demo-provider-${provider}`} role="img" aria-label={`${label} provider`}>
      <span aria-hidden="true">{provider === "you" ? "y." : label.slice(0, 2)}</span>
      <strong>{label}</strong>
    </span>
  );
}

const providerProof = (snapshot: CampaignSnapshot | undefined, data: CampaignPresentationData): ProviderProof[] => {
  const youCalls = toolCalls(snapshot, "you");
  const tokenCalls = toolCalls(snapshot, "token_router");
  const remotionCalls = toolCalls(snapshot, "remotion");
  const deepgramCalls = toolCalls(snapshot, "deepgram");
  const externalEvidence = snapshot?.brief?.evidenceBasis.items.filter(({ sourceKind }) => sourceKind === "external_research").length ?? 0;
  const websiteEvidence = snapshot?.brief?.evidenceBasis.items.filter(({ sourceKind }) => sourceKind === "source_website").length ?? 0;
  const band = snapshot ? deriveBandProductionBoard({ snapshot, events: data.events, bandRoomUrl: data.bandRoomUrl }) : undefined;
  const deepgramNarration = snapshot?.renderManifest?.media.narration.provider === "deepgram";
  const deepgramCaptions = snapshot?.renderManifest?.media.captions.provider === "deepgram";
  const hasRenderManifest = Boolean(snapshot?.renderManifest);
  const tokenRuns = snapshot?.agentRuns.filter((run) => run.toolCalls?.some(({ provider }) => provider === "token_router")).length ?? 0;
  const bandTone: ProofTone = band?.state === "degraded" ? "degraded" : band && ["active", "completed"].includes(band.state) ? "recorded" : "pending";

  if (data.fixtureFallbackActive) {
    const bandReceipts = data.events.filter(({ collaboration }) => collaboration?.provider === "band" && collaboration.receipt?.originalResponseId);
    const fixtureState = (recorded: boolean) => recorded ? "Fixture evidence retained" : "Fixture — not recorded";
    return [
      {
        provider: "you",
        state: fixtureState(youCalls.length > 0),
        detail: youCalls.length ? "Persisted fixture tool records are shown without presenting them as a live call." : "The retained fixture Campaign contains no You.com provider receipt.",
        evidence: youCalls.length ? `${youCalls.length} fixture tool record${youCalls.length === 1 ? "" : "s"}` : "No persisted fixture provider evidence",
        tone: "fixture",
      },
      {
        provider: "band",
        state: fixtureState(bandReceipts.length > 0),
        detail: bandReceipts.length ? "Persisted fixture receipts are shown without contacting Band from this page." : "Local Handoffs are not treated as Band activity without a persisted provider receipt.",
        evidence: bandReceipts.length ? `${bandReceipts.length} fixture receipt${bandReceipts.length === 1 ? "" : "s"}` : "No persisted fixture provider evidence",
        tone: "fixture",
      },
      {
        provider: "token_router",
        state: fixtureState(tokenCalls.length > 0),
        detail: tokenCalls.length ? "Persisted fixture tool records are shown without presenting them as a live model call." : "Fixture Agent artifacts do not establish Token Router activity.",
        evidence: tokenCalls.length ? `${tokenCalls.length} fixture tool record${tokenCalls.length === 1 ? "" : "s"}` : "No persisted fixture provider evidence",
        tone: "fixture",
      },
      {
        provider: "deepgram",
        state: fixtureState(deepgramCalls.length > 0),
        detail: deepgramCalls.length ? "Persisted fixture tool records are shown without presenting them as a live media call." : "Fixture narration and captions are not Deepgram provider evidence.",
        evidence: deepgramCalls.length ? `${deepgramCalls.length} fixture tool record${deepgramCalls.length === 1 ? "" : "s"}` : "No persisted fixture provider evidence",
        tone: "fixture",
      },
      {
        provider: "remotion",
        state: hasRenderManifest ? "Fixture manifest retained" : "Fixture — not recorded",
        detail: hasRenderManifest ? "A fixture render manifest is persisted; it does not establish a physical video output or a live provider call." : "No fixture render manifest is persisted and no video output is claimed.",
        evidence: snapshot?.renderManifest ? `${snapshot.renderManifest.width}×${snapshot.renderManifest.height} · ${snapshot.renderManifest.fps} FPS manifest only` : "No persisted fixture provider evidence",
        tone: "fixture",
      },
    ];
  }

  return [
    {
      provider: "you",
      state: externalEvidence ? `${externalEvidence} cited finding${externalEvidence === 1 ? "" : "s"}` : stateForCalls(youCalls),
      detail: externalEvidence ? "Attributable external research is retained in the Evidence Basis." : websiteEvidence ? "Website-grounded evidence remains available without implying external research." : "No research activity is present in the persisted Campaign.",
      evidence: `${websiteEvidence} Source Website fact${websiteEvidence === 1 ? "" : "s"} retained`,
      tone: externalEvidence ? "recorded" : toneForCalls(youCalls),
    },
    {
      provider: "band",
      state: band ? titleCase(band.state) : "Not recorded",
      detail: band?.degradedDisclosure ?? (band?.handoffs.length ? "Persisted Handoff records show the collaboration sequence." : "No Band Handoff record is available."),
      evidence: band ? `${band.counts.completed}/${band.counts.total} task mirrors · ${band.handoffs.length} Handoffs` : "No persisted board evidence",
      tone: bandTone,
    },
    {
      provider: "token_router",
      state: stateForCalls(tokenCalls),
      detail: tokenRuns ? "Model, prompt, mode, and validation provenance are retained per Agent run." : "No routed Agent activity is present in the persisted Campaign.",
      evidence: `${tokenRuns}/4 Agent records with routed calls`,
      tone: toneForCalls(tokenCalls),
    },
    {
      provider: "deepgram",
      state: deepgramNarration && deepgramCaptions ? "Narration + captions recorded" : stateForCalls(deepgramCalls),
      detail: deepgramNarration && deepgramCaptions ? "The persisted render manifest identifies Deepgram for required audio and timed captions." : "Fixture or absent media is labeled as such; provider success is not inferred.",
      evidence: deepgramNarration || deepgramCaptions ? `${deepgramNarration ? "Narration" : "No narration"} · ${deepgramCaptions ? "Captions" : "No captions"}` : "No Deepgram manifest evidence",
      tone: deepgramNarration && deepgramCaptions ? "recorded" : toneForCalls(deepgramCalls),
    },
    {
      provider: "remotion",
      state: hasRenderManifest ? "Render manifest persisted" : stateForCalls(remotionCalls),
      detail: hasRenderManifest ? "Composition, dimensions, frame rate, and duration were validated before persistence." : "No render output is claimed without a persisted manifest.",
      evidence: snapshot?.renderManifest ? `${snapshot.renderManifest.width}×${snapshot.renderManifest.height} · ${snapshot.renderManifest.fps} FPS · ${snapshot.renderManifest.durationSeconds}s` : "No persisted render manifest",
      tone: hasRenderManifest ? snapshot?.mode === "fixture" ? "fixture" : "recorded" : toneForCalls(remotionCalls),
    },
  ];
};

const readinessFor = (snapshot?: CampaignSnapshot) => {
  if (!snapshot) return { label: "Not ready", detail: "No persisted Campaign", tone: "pending" } as const;
  if (snapshot.status === "completed" && snapshot.configuration && snapshot.packageManifest) return { label: "Ready to present", detail: "Completed persisted record", tone: "recorded" } as const;
  if (snapshot.status === "workflow_failed" || snapshot.status === "production_failed") return { label: "Fallback required", detail: safeLabel(snapshot.failure?.stage ?? snapshot.productionFailure?.stage, "Failure recorded"), tone: "degraded" } as const;
  return { label: "Review required", detail: titleCase(snapshot.status), tone: "pending" } as const;
};

const approvalCount = (snapshot?: CampaignSnapshot) => [
  snapshot?.status !== "awaiting_source_profile" && snapshot?.sourceProfile,
  snapshot?.conceptApproval,
  snapshot?.storyboard && ["production_failed", "correction_requested", "rerendering", "completed"].includes(snapshot.status),
].filter(Boolean).length;

const chosenConcept = (snapshot?: CampaignSnapshot) => snapshot?.conceptSet?.concepts.find(({ id }) => id === snapshot.conceptApproval?.conceptId);
const agentEvidence = (runs: AgentRun[]) => runs.filter(({ validation }) => validation === "passed").length;
const preflightTimestamp = (value: string) => new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
}).format(new Date(value));

export function DemoLaunchpad({ data, preflight }: { data: CampaignPresentationData; preflight: PreflightReportState }) {
  const { snapshot } = data;
  const readiness = readinessFor(snapshot);
  const proofs = providerProof(snapshot, data);
  const sourceUrl = publicUrl(snapshot?.configuration?.sourceWebsite);
  const sourceHost = sourceUrl ? new URL(sourceUrl).hostname : undefined;
  const selectedConcept = chosenConcept(snapshot);
  const approvals = approvalCount(snapshot);
  const passedAgents = agentEvidence(snapshot?.agentRuns ?? []);
  const packageReady = snapshot?.packageManifest?.files.length === 7;
  const evidenceCount = snapshot?.brief?.evidenceBasis.items.length ?? 0;
  const report = preflight.freshness === "never-run" ? undefined : preflight.report;
  const preflightLabel = preflight.freshness === "never-run" ? "Never run" : preflight.freshness === "stale" ? "Stale" : report!.outcome;
  const preflightTone = preflight.freshness === "current" ? report!.outcome.toLowerCase() : preflight.freshness;
  const currentState = snapshot ? titleCase(snapshot.status) : "Standby";

  return (
    <div className="demo-shell">
      <a className="skip-link" href="#demo-main">Skip to launchpad</a>
      <header className="demo-header">
        <Link className="wordmark" href="/" aria-label="LaunchReel home">Launch<span>Reel</span></Link>
        <div className="demo-header-identity"><span>Presentation control</span><strong>Demo launchpad</strong></div>
        <dl className="demo-header-status">
          <div><dt>Runtime</dt><dd>{data.runtimeMode} · persisted</dd></div>
          <div><dt>Readiness</dt><dd className={`demo-state demo-state-${readiness.tone}`}>{readiness.label}</dd></div>
          <div><dt>Current state</dt><dd>{currentState}</dd></div>
        </dl>
      </header>

      <main id="demo-main" className="demo-main">
        {data.fixtureFallbackActive && <div className="demo-fixture-disclosure" role="status"><strong>Fixture — not live</strong><span>This view reads only retained fixture evidence and never claims live provider activity.</span><Link href="/demo">Return to configured {data.configuredMode} mode</Link></div>}
        {data.fixtureFallbackActive && !snapshot && <section className="demo-fixture-empty" aria-labelledby="fixture-empty-title"><p className="eyebrow">Retained fixture unavailable</p><h1 id="fixture-empty-title">No retained fixture Campaign.</h1><p>Nothing is fabricated. Against the separately started local fixture-mode server, generate persisted fixture evidence with exactly:</p><code>npm run rehearse:fixture -- -- --server-url http://localhost:3001</code><p>This creates a persisted fixture record only. No video file or downloadable package output is present or claimed.</p></section>}
        <section className="demo-hero" aria-labelledby="demo-title">
          <div className="demo-hero-copy">
            <p className="section-index">00 / Presentation control</p>
            <p className="eyebrow">Read only · persisted evidence</p>
            <h1 id="demo-title">Run the story.<br /><em>Not the system.</em></h1>
          </div>
          <div className="demo-readiness-card">
            <span className={`demo-ready-light demo-ready-${readiness.tone}`} aria-hidden="true" />
            <p className="eyebrow">Presentation readiness</p>
            <strong>{readiness.label}</strong>
            <span>{readiness.detail}</span>
            <small>This page never starts, approves, retries, renders, deletes, resets, or mirrors Campaign work.</small>
            {data.fixtureDemoEnabled && !data.fixtureFallbackActive && <Link className="demo-fixture-link" href="/demo?mode=fixture" prefetch={false}>Load disclosed fixture Campaign</Link>}
          </div>
        </section>

        <nav className="demo-nav" aria-label="Presentation destinations">
          <a href="/studio"><span>01</span><strong>Configure</strong><small>Open production app</small></a>
          <a href="/studio#main-content"><span>02</span><strong>Studio</strong><small>Inspect work sequence</small></a>
          <a href="#campaign"><span>03</span><strong>Campaign</strong><small>Current persisted state</small></a>
          <a href="#proof"><span>04</span><strong>Production Proof</strong><small>Provider receipts</small></a>
          <a href="/judging"><span>05</span><strong>Judging mode</strong><small>Completed run record</small></a>
          {data.bandRoomUrl && <a href={data.bandRoomUrl} target="_blank" rel="noreferrer"><span>↗</span><strong>Band room</strong><small>Validated public URL</small></a>}
        </nav>

        <section className="demo-preflight" aria-labelledby="preflight-title">
          <div className="demo-section-intro">
            <p className="section-index">01 / Before presenting</p>
            <h2 id="preflight-title">Local preflight.</h2>
            <p>This server-rendered view reads a redacted local report. It reports local configuration only, not provider connectivity, and never runs preflight in the browser.</p>
            <div className="demo-preflight-command">
              <span>Copy and run manually in the operator terminal</span>
              <code>{PREFLIGHT_COMMAND}</code>
            </div>
          </div>
          <article className={`demo-preflight-report preflight-${preflightTone}`}>
            <header>
              <div><span>Report status</span><strong>{preflightLabel}</strong></div>
              {report && <div><span>Recorded result</span><strong>{report.outcome}</strong></div>}
            </header>
            {report ? (
              <>
                <p>Generated <time dateTime={report.generatedAt}>{preflightTimestamp(report.generatedAt)}</time>{preflight.freshness === "stale" ? " · run the command again before relying on this result" : " · current within 24 hours"}</p>
                <dl className="demo-preflight-counts">
                  <div><dt>PASS</dt><dd>{report.counts.PASS}</dd></div>
                  <div><dt>WARN</dt><dd>{report.counts.WARN}</dd></div>
                  <div><dt>BLOCKED</dt><dd>{report.counts.BLOCKED}</dd></div>
                </dl>
              </>
            ) : (
              <p>No valid local preflight report is available. Run the displayed command manually; this page will not run it for you.</p>
            )}
            <small>Credentials, environment values, private identifiers, URLs, absolute paths, and the report&apos;s storage location are excluded.</small>
          </article>
        </section>

        <section className="demo-cue-section" aria-labelledby="cue-title">
          <div className="demo-section-heading"><div><p className="section-index">02 / Signature visual</p><h2 id="cue-title">The Campaign, left to right.</h2></div><span>Scroll horizontally on smaller screens</span></div>
          <div className="demo-cue-scroll" tabIndex={0} role="region" aria-label="Campaign cue sheet: Source to Proof">
            <ol className="demo-cue-sheet">
              <li><span>01</span><p className="eyebrow">Source</p><strong>{safeLabel(snapshot?.sourceProfile?.productName, sourceHost ?? "No Campaign")}</strong><small>{sourceHost ? `Public source · ${sourceHost}` : "Persisted Source Profile required"}</small></li>
              <li><span>02</span><p className="eyebrow">Evidence</p><strong>{evidenceCount} attributed item{evidenceCount === 1 ? "" : "s"}</strong><small>{snapshot?.brief?.evidenceBasis.mode === "external_research" ? "Source + external research" : "Source Website only"}</small></li>
              <li><span>03</span><p className="eyebrow">Direction</p><strong>{safeLabel(selectedConcept?.title, "Awaiting selection")}</strong><small>{safeLabel(selectedConcept?.emotionalDirection, "No approved direction")}</small></li>
              <li><span>04</span><p className="eyebrow">Approval</p><strong>{approvals} / 3 boundaries</strong><small>Profile · Concept · Storyboard</small></li>
              <li><span>05</span><p className="eyebrow">Production</p><strong>{snapshot?.storyboard?.scenes.length ?? 0} scenes · {snapshot?.configuration?.durationSeconds ?? "—"}s</strong><small>{passedAgents}/4 Agent artifacts validated</small></li>
              <li><span>06</span><p className="eyebrow">Proof</p><strong>{packageReady ? data.fixtureFallbackActive ? "7 / 7 manifest entries" : "7 / 7 packaged" : "Not complete"}</strong><small>{snapshot?.renderManifest ? data.fixtureFallbackActive ? "Fixture manifest only · no video output claimed" : `${snapshot.renderManifest.width}×${snapshot.renderManifest.height} · ${snapshot.renderManifest.fps} FPS` : "No render manifest"}</small></li>
            </ol>
          </div>
        </section>

        <section id="proof" className="demo-sponsor-proof" aria-labelledby="sponsor-title">
          <div className="demo-section-heading"><div><p className="section-index">03 / Sponsor proof strip</p><h2 id="sponsor-title">Receipts, not assumptions.</h2></div><span>Persisted evidence only</span></div>
          <div className="demo-proof-strip">
            {proofs.map((proof) => <article key={proof.provider} className={`demo-proof-card proof-${proof.tone}`}><header><ProviderMark provider={proof.provider} /><span>{proof.state}</span></header><p>{proof.detail}</p><footer>{proof.evidence}</footer></article>)}
          </div>
        </section>

        <section id="campaign" className="demo-campaign" aria-labelledby="campaign-title">
          <div className="demo-section-intro"><p className="section-index">04 / Current Campaign</p><h2 id="campaign-title">The record on deck.</h2><p>Identity and creative details are bounded to presentation-safe persisted fields.</p></div>
          <dl className="demo-campaign-grid">
            <div><dt>Campaign ID</dt><dd>{safeLabel(snapshot?.id)}</dd></div>
            <div><dt>Product</dt><dd>{safeLabel(snapshot?.sourceProfile?.productName ?? snapshot?.brief?.productName)}</dd></div>
            <div><dt>Campaign type</dt><dd>{snapshot?.configuration ? titleCase(snapshot.configuration.type) : "Not recorded"}</dd></div>
            <div><dt>Duration</dt><dd>{snapshot?.configuration ? `${snapshot.configuration.durationSeconds} seconds` : "Not recorded"}</dd></div>
            <div><dt>Audience</dt><dd>{safeLabel(snapshot?.configuration?.targetAudience)}</dd></div>
            <div><dt>Stage</dt><dd>{snapshot ? titleCase(snapshot.status) : "Not recorded"}</dd></div>
            <div><dt>Provider mode</dt><dd>{snapshot?.mode ? titleCase(snapshot.mode) : "Not recorded"}</dd></div>
            <div><dt>Approvals</dt><dd>{approvals}/3 recorded boundaries</dd></div>
            <div><dt>Package availability</dt><dd>{packageReady ? data.fixtureFallbackActive ? "7/7 manifest entries retained; no archive output claimed" : "7/7 artifacts recorded" : "Not available; no package output claimed"}</dd></div>
            <div><dt>Approved direction</dt><dd>{safeLabel(selectedConcept?.title)}</dd></div>
            <div><dt>Evidence Basis</dt><dd>{evidenceCount ? `${evidenceCount} attributed items` : "Not recorded"}</dd></div>
            <div><dt>Storyboard</dt><dd>{snapshot?.storyboard ? `${snapshot.storyboard.scenes.length} scenes` : "Not recorded"}</dd></div>
            <div><dt>Output</dt><dd>{snapshot?.renderManifest ? data.fixtureFallbackActive ? "Fixture manifest retained; no video output claimed" : `${snapshot.renderManifest.width}×${snapshot.renderManifest.height} at ${snapshot.renderManifest.fps} FPS` : "Not recorded; no video output claimed"}</dd></div>
            {sourceUrl && <div><dt>Source Website</dt><dd><a href={sourceUrl} target="_blank" rel="noreferrer">{sourceHost}<span aria-hidden="true"> ↗</span></a></dd></div>}
          </dl>
        </section>

        <section className="demo-operator" aria-labelledby="operator-title">
          <div className="demo-section-heading"><div><p className="section-index">05 / Operator sequence</p><h2 id="operator-title">Say it. Click it. Prove it.</h2></div><span>Six beats · one narrative</span></div>
          <ol className="demo-operator-list">
            {[
              ["Source", "Say", "LaunchReel starts with the company’s public Source Website, not a blank prompt.", "Click", "Campaign details", "Evidence", sourceHost ? `Validated public host: ${sourceHost}` : "No public source is present; disclose standby state."],
              ["Evidence", "Say", "The Analyst separates Source Website facts from attributable external research.", "Click", "Sponsor proof strip", "Evidence", `${evidenceCount} retained Evidence Basis item${evidenceCount === 1 ? "" : "s"}.`],
              ["Direction", "Say", "The Creative Director turns those facts into options, then a human chooses the direction.", "Click", "Cue sheet · Direction", "Evidence", selectedConcept ? `Approved: ${safeLabel(selectedConcept.title)}.` : "No approved concept is recorded."],
              ["Approval", "Say", "Consequential cuts stop at explicit human boundaries.", "Click", "Cue sheet · Approval", "Evidence", `${approvals}/3 approval boundaries are present.`],
              ["Production", "Say", "The Producer assembles narration, captions, scenes, and a deterministic Remotion composition.", "Click", "Deepgram + Remotion proof", "Evidence", snapshot?.renderManifest ? data.fixtureFallbackActive ? `${snapshot.renderManifest.durationSeconds}s fixture manifest retained; no video output claimed.` : `${snapshot.renderManifest.durationSeconds}s validated manifest.` : "No production manifest is present."],
              ["Proof", "Say", "The Critic gates completion, and the package keeps the Campaign auditable.", "Click", "Judging mode", "Evidence", packageReady ? data.fixtureFallbackActive ? "7/7 manifest names persisted; no package output claimed." : "7/7 required artifact names persisted." : "Package proof is incomplete; do not claim completion."],
            ].map(([beat, sayLabel, say, clickLabel, click, evidenceLabel, evidence], index) => <li key={beat}><span>{String(index + 1).padStart(2, "0")}</span><strong>{beat}</strong><dl><div><dt>{sayLabel}</dt><dd>{say}</dd></div><div><dt>{clickLabel}</dt><dd>{click}</dd></div><div><dt>{evidenceLabel}</dt><dd>{evidence}</dd></div></dl></li>)}
          </ol>
        </section>

        <section className="demo-fallbacks" aria-labelledby="fallback-title">
          <div className="demo-section-intro"><p className="section-index">06 / Degradation script</p><h2 id="fallback-title">If a service is quiet, the truth gets louder.</h2><p>Never substitute a configured provider for a successful provider. Name the persisted state, use the bounded fallback, and continue only where the workflow permits.</p></div>
          <div className="demo-fallback-grid">
            <article><strong>You.com</strong><p>If external research is unavailable, present Source Website-only evidence and explicitly prohibit unsupported market claims.</p></article>
            <article><strong>Band</strong><p>If synchronization degrades, local persisted Campaign work remains authoritative. Do not retry from this page or imply the room was updated.</p></article>
            <article><strong>Token Router</strong><p>If an Agent call fails validation, stop at the recorded workflow failure. Do not present an absent Artifact as generated.</p></article>
            <article><strong>Deepgram</strong><p>If required narration or timed captions are absent, completion is blocked. Never present silent output as a completed Campaign.</p></article>
            <article><strong>Remotion</strong><p>If no validated render manifest exists, show storyboard and production records only. Do not render or claim a finished video here.</p></article>
            <article><strong>No Campaign</strong><p>Use the launchpad in standby, state that no persisted record is loaded, then navigate to Configure only with operator intent.</p></article>
          </div>
        </section>
      </main>

      <footer className="demo-footer"><strong>LaunchReel / Demo launchpad</strong><span>Read only · no provider calls · persisted evidence</span></footer>
    </div>
  );
}
