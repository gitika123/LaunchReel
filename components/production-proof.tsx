"use client";

import React, { useCallback, useEffect, useRef } from "react";
import type { CampaignEvent } from "@/src/persistence";
import { deriveProductionProof } from "@/src/proof/production-report";
import type { CampaignSnapshot } from "@/src/workflow";

const providerNames = {
  you: "You.com",
  band: "Band",
  deepgram: "Deepgram",
  tokenRouter: "Token Router",
  remotion: "Remotion",
} as const;

type Provider = keyof typeof providerNames;

function ProviderMark({ provider }: { provider: Provider }) {
  const label = providerNames[provider];
  return (
    <span className={`proof-provider-mark proof-provider-${provider}`} role="img" aria-label={`${label} provider`}>
      {provider === "band" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.4" /><circle cx="18" cy="7" r="2.4" /><circle cx="12" cy="17" r="2.4" /><path d="m8 8.2 3 6.4m5-6.4-3 6.4M8.4 7h7.2" /></svg>
      ) : <span aria-hidden="true">{provider === "you" ? "y." : label.slice(0, 2)}</span>}
      <strong>{label}</strong>
    </span>
  );
}

const displayTime = (value?: string) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value))
  : "Not recorded";
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const stateClass = (state: string) => state.includes("degraded") || state.includes("fallback") || state.includes("not ") ? "proof-state-degraded" : "proof-state-complete";

function ProofReel({ snapshot }: { snapshot: CampaignSnapshot }) {
  const mode = snapshot.packageManifest!.mode;
  const overlay = snapshot.storyboard?.scenes.at(-1)?.overlayText ?? "Campaign complete";
  return (
    <section className="production-proof-reel" aria-labelledby="proof-reel-heading">
      <div className="proof-section-heading">
        <div><p className="eyebrow">Approved Promotional Video</p><h2 id="proof-reel-heading">The proof reel</h2></div>
        <span className={`proof-mode proof-mode-${mode}`}>{mode} output</span>
      </div>
      {mode === "live" ? (
        <video className="campaign-video" controls playsInline poster={`/campaigns/${snapshot.id}/thumbnail.jpg`}>
          <source src={`/campaigns/${snapshot.id}/campaign.mp4`} type="video/mp4" />
        </video>
      ) : (
        <div className="proof-reel-placeholder" aria-label={`${titleCase(mode)} promotional video preview`}>
          <span>Launch / Reel</span>
          <strong>{overlay}</strong>
          <small>{snapshot.configuration!.durationSeconds}s · 9:16 · approved cut</small>
        </div>
      )}
      <p className="preview-disclosure"><strong>{titleCase(mode)} disclosure:</strong> {mode === "live" ? "this is the approved Remotion output from this persisted Campaign." : mode === "cached" ? "this is visibly labeled cached playback; it is not presented as a new provider run." : "this designed fixture preview represents the persisted fixture Campaign and does not claim live provider activity."}</p>
    </section>
  );
}

export function ProductionProof({ snapshot, events = [], bandRoomUrl, judging = false }: {
  snapshot: CampaignSnapshot;
  events?: CampaignEvent[];
  bandRoomUrl?: string;
  judging?: boolean;
}) {
  const report = deriveProductionProof({ snapshot, events, bandRoomUrl });
  const criticScores = Object.values(snapshot.criticReport?.advisory ?? {});
  const criticAverage = criticScores.length ? criticScores.reduce((total, score) => total + score, 0) / criticScores.length : undefined;
  const generatedAtRef = useRef<HTMLTimeElement>(null);
  const stampGeneratedAt = useCallback(() => {
    const generatedAt = new Date().toISOString();
    if (generatedAtRef.current) {
      generatedAtRef.current.dateTime = generatedAt;
      generatedAtRef.current.textContent = displayTime(generatedAt);
    }
  }, []);

  useEffect(() => {
    const handleBeforePrint = () => stampGeneratedAt();
    window.addEventListener("beforeprint", handleBeforePrint);
    return () => window.removeEventListener("beforeprint", handleBeforePrint);
  }, [stampGeneratedAt]);

  const printProductionProof = () => {
    stampGeneratedAt();
    window.print();
  };

  return (
    <main id="main-content" className={`production-proof ${judging ? "production-proof-judging" : ""}`}>
      <header className="proof-masthead">
        <div>
          <p className="section-index">04 / Production record</p>
          <p className="eyebrow">Completed Campaign · Run Proof</p>
          <h1>A complete Campaign, packaged.</h1>
        </div>
        <div className="proof-completion">
          <span className="proof-completion-mark" aria-hidden="true">✓</span>
          <div><small>Completion</small><strong>{titleCase(report.campaign.status)}</strong><time dateTime={report.campaign.completedAt}>{displayTime(report.campaign.completedAt)}</time></div>
          <button type="button" className="print-production-action print-control" onClick={printProductionProof}>Print Production Proof</button>
        </div>
      </header>

      {report.campaign.providerMode === "fixture" ? (
        <aside className="proof-fixture-disclosure" role="note" aria-label="Fixture production proof disclosure">
          <strong>Fixture Production Proof</strong>
          <span>Designed fixture evidence only — no live provider activity is claimed.</span>
        </aside>
      ) : null}

      <div className="proof-identity" aria-label="Campaign identity">
        <div><span>Campaign ID</span><strong>{report.campaign.id}</strong></div>
        <div><span>Type</span><strong>{report.campaign.type}</strong></div>
        <div><span>Duration</span><strong>{report.campaign.durationSeconds} seconds</strong></div>
        <div><span>Provider mode</span><strong className={`proof-mode proof-mode-${report.campaign.providerMode}`}>{report.campaign.providerMode}</strong></div>
      </div>

      <div className="proof-lead-grid">
        <ProofReel snapshot={snapshot} />
        <aside className="proof-approval-docket" aria-labelledby="approval-record-heading">
          <p className="eyebrow">Human direction</p>
          <h2 id="approval-record-heading">Approval record</h2>
          <ol>
            {report.campaign.approvals.map((approval, index) => (
              <li key={approval.name}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{approval.name}</strong><time dateTime={approval.occurredAt}>{displayTime(approval.occurredAt)}</time></div></li>
            ))}
          </ol>
          <div className="proof-critic">
            <span>Creative Critic</span>
            <strong>{snapshot.objectiveQuality?.passed || (snapshot.criticReport && snapshot.criticReport.blockingFailures.length === 0) ? "Objective validation passed" : "Not recorded"}</strong>
            <small>{criticAverage === undefined ? "Advisory score not recorded" : `Advisory average ${criticAverage.toFixed(1)} / 5`}</small>
          </div>
          <div className="proof-actions print-control">
            {snapshot.packageManifest?.mode === "live" ? <a className="primary-action" href="/api/campaigns/current/package" download={`launchreel-${snapshot.id}.zip`}>Download Campaign ZIP <span aria-hidden="true">↗</span></a> : <button className="primary-action" disabled>Campaign ZIP unavailable in {snapshot.packageManifest?.mode} mode</button>}
            <a className="proof-report-link" href="/api/campaigns/current/report" download={`launchreel-${snapshot.id}-production-proof.json`}>Download run report <span aria-hidden="true">↓</span></a>
          </div>
        </aside>
      </div>

      <section className="proof-sponsors" aria-labelledby="sponsor-proof-heading">
        <div className="proof-section-heading">
          <div><p className="eyebrow">Sponsor activity · persisted evidence</p><h2 id="sponsor-proof-heading">Production infrastructure, with receipts.</h2></div>
          <span>No configured success is inferred</span>
        </div>

        <article className="proof-provider-card proof-token-card">
          <header><ProviderMark provider="tokenRouter" /><span className="proof-state">{report.campaign.providerMode} run record</span></header>
          <div className="token-agent-grid">
            {report.tokenRouter.agents.map((agent, index) => (
              <div key={agent.role}>
                <span>{String(index + 1).padStart(2, "0")} · {agent.role}</span>
                <strong>{agent.modelIds.join(", ") || "Model not recorded"}</strong>
                <small>{agent.promptVersions.join(", ") || "Prompt not recorded"}</small>
                <dl>
                  <div><dt>Profile / mode</dt><dd>{agent.modelProfiles.join(", ") || "Not recorded"} · {agent.providerModes.join(", ") || "none"}</dd></div>
                  <div><dt>Validation</dt><dd className={agent.validation === "passed" ? "proof-pass" : "proof-warn"}>{agent.validation}</dd></div>
                  <div><dt>Runs</dt><dd>{agent.runCount}</dd></div>
                  <div><dt>Timing</dt><dd>{agent.startedAt && agent.completedAt ? `${displayTime(agent.startedAt)} → ${displayTime(agent.completedAt)}` : "Not recorded"}</dd></div>
                  <div><dt>Tokens</dt><dd>{agent.inputTokens === undefined && agent.outputTokens === undefined ? "Not returned" : `${agent.inputTokens ?? 0} in / ${agent.outputTokens ?? 0} out`}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        </article>

        <div className="proof-provider-grid">
          <article className="proof-provider-card proof-you-card">
            <header><ProviderMark provider="you" /><span className={`proof-state ${stateClass(report.you.state)}`}>{report.you.state}</span></header>
            <p>{report.you.evidenceMode === "Source Website only" ? "No external findings are substituted. Unsupported market claims remain prohibited." : "Attributable external findings are retained with their original sources."}</p>
            <dl className="proof-metrics">
              <div><dt>Intents</dt><dd>{report.you.intents.length ? report.you.intents.join(" · ") : "Not recorded"}</dd></div>
              <div><dt>Queries</dt><dd>{report.you.queryCount}</dd></div>
              <div><dt>Cited findings</dt><dd>{report.you.citedFindingCount}</dd></div>
            </dl>
            {report.you.originals.length ? <ul className="proof-originals">{report.you.originals.map((original) => <li key={original.url}><a href={original.url} target="_blank" rel="noreferrer">{original.title}<span aria-hidden="true"> ↗</span></a></li>)}</ul> : <small className="proof-disclosure">No clickable external originals were retained.</small>}
          </article>

          <article className={`proof-provider-card proof-band-card band-board-${report.band.state}`}>
            <header><ProviderMark provider="band" /><span className={`proof-state ${stateClass(report.band.state)}`}>{report.band.state}</span></header>
            <div className="proof-band-goal"><span>Room goal</span><strong>{report.band.goal}</strong></div>
            <div className="proof-band-counts" aria-label="Band production task counts"><span><strong>{report.band.counts.total}</strong> tasks</span><span><strong>{report.band.counts.completed}</strong> synced</span><span><strong>{report.band.counts.incomplete}</strong> incomplete</span></div>
            {report.band.degradedDisclosure ? <small className="proof-disclosure" role="status">{report.band.degradedDisclosure} No provider success is claimed for incomplete operations.</small> : null}
            <ul className="proof-remote-agents" aria-label="Four named Band agents">{report.band.agents.map((agent) => <li key={agent.role}><span aria-hidden="true">●</span><strong>{agent.name}</strong><small>{agent.role}</small></li>)}</ul>
            {report.band.room ? <a className="proof-room-link" href={report.band.room.url} target="_blank" rel="noreferrer">{report.band.room.label}<span aria-hidden="true"> ↗</span></a> : <small className="proof-disclosure">Validated shared room URL not configured for display.</small>}
            <ol className="proof-mirrors" aria-label="Band production tasks">
              {report.band.tasks.map((task) => <li key={task.key}><span className={`mirror-state mirror-${task.syncState}`}>{task.syncState}</span><div><strong>{task.label}</strong><small>{task.owner} · local {task.localState}</small><small>{task.humanBoundary ? "Human approval boundary · unassigned" : "Named Remote Agent assignment"}</small></div></li>)}
            </ol>
            <ol className="proof-mirrors" aria-label="Band handoff receipt history">
              {report.band.handoffs.length ? report.band.handoffs.map((handoff, index) => (
                <li key={`${handoff.artifact}-${index}`}>
                  <span className={`mirror-state mirror-${handoff.syncState}`}>{handoff.syncState}</span>
                  <div><strong>{handoff.artifact}</strong><small>{handoff.sender} → {handoff.recipient} · {handoff.humanBoundary ? "human boundary" : "Agent Handoff"}</small><small>Approval · {handoff.approval}</small><code>Local receipt · {handoff.originalReceipt ? `event ${handoff.originalReceipt.sequence} · ${displayTime(handoff.originalReceipt.occurredAt)}` : "not recorded"}</code><code>Message receipt · {handoff.messageReceipt ?? "not returned"}</code><code>Acknowledgment receipt · {handoff.acknowledgementReceipt ?? "not returned"}</code></div>
                </li>
              )) : <li><span className="mirror-state mirror-configuring">none</span><div><strong>No persisted handoffs</strong><small>No provider success is claimed.</small></div></li>}
            </ol>
          </article>
        </div>

        <div className="proof-provider-grid proof-technical-grid">
          <article className="proof-provider-card">
            <header><ProviderMark provider="deepgram" /><span className={`proof-state ${stateClass(report.deepgram.state)}`}>{report.deepgram.state}</span></header>
            <dl className="proof-metrics">
              <div><dt>TTS model</dt><dd>{report.deepgram.ttsModel ?? "Not recorded"}</dd></div>
              <div><dt>Caption timing model</dt><dd>{report.deepgram.captionTimingModel ?? "Not recorded"}</dd></div>
              <div><dt>Narration required</dt><dd>{report.deepgram.narrationRequired ? "Yes" : "No"}</dd></div>
              <div><dt>Timed words</dt><dd>{report.deepgram.timedWordCount} · {report.deepgram.captionTiming}</dd></div>
            </dl>
          </article>
          <article className="proof-provider-card">
            <header><ProviderMark provider="remotion" /><span className={`proof-state ${stateClass(report.remotion.state)}`}>{report.remotion.state}</span></header>
            <dl className="proof-metrics">
              <div><dt>Composition</dt><dd>{report.remotion.compositionId ?? "Not recorded"}</dd></div>
              <div><dt>Canvas</dt><dd>{report.remotion.width && report.remotion.height ? `${report.remotion.width} × ${report.remotion.height}` : "Not recorded"}</dd></div>
              <div><dt>Timeline</dt><dd>{report.remotion.fps ? `${report.remotion.fps} FPS · ${report.remotion.frameCount} frames · ${report.remotion.durationSeconds}s` : "Not recorded"}</dd></div>
              <div><dt>Codecs</dt><dd>{report.remotion.codecs?.join(" · ") ?? "Not returned by persisted render"}</dd></div>
            </dl>
          </article>
        </div>
      </section>

      <section className="proof-handoffs" aria-labelledby="handoff-proof-heading">
        <div className="proof-section-heading"><div><p className="eyebrow">Local source of truth</p><h2 id="handoff-proof-heading">Agent Handoffs</h2></div><span>{report.campaign.handoffs.length} persisted transfers</span></div>
        <ol>{report.campaign.handoffs.map((handoff, index) => <li key={`${handoff.artifact}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{handoff.artifact}</strong><small>{handoff.from} → {handoff.to}</small></div><time dateTime={handoff.occurredAt}>{displayTime(handoff.occurredAt)}</time></li>)}</ol>
      </section>

      <section className="proof-package" aria-labelledby="package-proof-heading">
        <div className="proof-section-heading"><div><p className="eyebrow">Final Campaign package</p><h2 id="package-proof-heading">Seven files. Exact inventory.</h2></div><span className={report.package.validation === "passed" ? "proof-pass" : "proof-warn"}>Validation {report.package.validation}</span></div>
        <div className="proof-package-summary"><div><strong>{report.package.inventory.length}</strong><span>required files</span></div><div><strong>{report.package.citationCount}</strong><span>citations retained</span></div><div><strong>{report.package.provenancePresent ? "Yes" : "No"}</strong><span>provenance present</span></div></div>
        <ol>{report.package.inventory.map((file, index) => <li key={file}><span>{String(index + 1).padStart(2, "0")}</span><strong>{file}</strong><small>{file === "provenance.json" ? "Provenance manifest" : "Validated Campaign artifact"}</small></li>)}</ol>
      </section>

      <footer className="proof-print-footer" aria-label="Printed Production Proof footer">
        <span>Campaign ID: {report.campaign.id}</span>
        <span>Provider mode: {report.campaign.providerMode}</span>
        <span>Generated report: <time ref={generatedAtRef}>Not recorded</time></span>
        <strong>LaunchReel</strong>
      </footer>
    </main>
  );
}
