"use client";

import React, { useEffect, useState } from "react";
import { campaignFixture, type AgentRun, type StoryboardScene } from "@/lib/campaign-fixture";
import { ProductionProof } from "@/components/production-proof";
import type { CampaignDurationSeconds, CampaignType } from "@/src/contracts";
import type { JudgingPresetResponse } from "@/src/judging-preset";
import type { CampaignEvent, CampaignHistoryEntry } from "@/src/persistence";
import type { CampaignAsset } from "@/src/source-assets";
import type { SourceProfileApproval } from "@/src/source-profile";
import { deriveBandProductionBoard } from "@/src/proof/production-report";
import type { CampaignSnapshot } from "@/src/workflow";

type View = "configure" | "studio" | "campaign";
type Approval = "concept" | "storyboard";

const Arrow = () => <span aria-hidden="true">↗</span>;
const durationTimecode = (durationSeconds: CampaignDurationSeconds) => durationSeconds === 60 ? "01:00" : "00:30";
const providerLabel = (provider: string) => ({
  you: "You.com",
  "You.com": "You.com",
  band: "Band",
  Band: "Band",
  token_router: "Token Router",
  "Token Router": "Token Router",
  deepgram: "Deepgram",
  Deepgram: "Deepgram",
  remotion: "Remotion",
  Remotion: "Remotion",
  filesystem: "Filesystem",
  Filesystem: "Filesystem",
}[provider] ?? provider);

function ProviderMark({ provider, compact = false }: { provider: string; compact?: boolean }) {
  const label = providerLabel(provider);
  const kind = label === "You.com" ? "you" : label === "Band" ? "band" : "generic";
  return (
    <span className={`provider-mark provider-${kind} ${compact ? "provider-compact" : ""}`}>
      {kind === "you" ? (
        <span className="you-mark" aria-hidden="true">y.</span>
      ) : kind === "band" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.4" /><circle cx="18" cy="7" r="2.4" /><circle cx="12" cy="17" r="2.4" /><path d="m8 8.2 3 6.4m5-6.4-3 6.4M8.4 7h7.2" /></svg>
      ) : <span aria-hidden="true">{label.slice(0, 2)}</span>}
      <strong>{label}</strong>
    </span>
  );
}

function ProvenanceTag({ mode }: { mode: "fixture" | "source" | "uploaded" | "generated" | "cached" | "live" }) {
  return <span className={`provenance-tag provenance-${mode}`}>{mode}</span>;
}

function StudioHeader({ view, mode, judging, onNavigate, onHistory }: { view: View; mode: "fixture" | "live" | "cached"; judging: boolean; onNavigate: (view: View) => void; onHistory: () => void }) {
  const views: { id: View; label: string }[] = judging ? [{ id: "campaign", label: "Run Proof" }] : [
    { id: "configure", label: "Configure" },
    { id: "studio", label: "Studio" },
    { id: "campaign", label: "Campaign" },
  ];

  return (
    <header className="studio-header">
      {judging ? <a className="wordmark" href="/studio" aria-label="LaunchReel Studio">Launch<span>Reel</span></a> : (
        <button className="wordmark" onClick={() => onNavigate("configure")} aria-label="LaunchReel home">Launch<span>Reel</span></button>
      )}
      <nav aria-label="Campaign views">
        {views.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "nav-active" : ""}
            onClick={() => onNavigate(item.id)}
            aria-current={view === item.id ? "page" : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="header-tools header-proof-mode">
        {!judging && <button className="history-trigger" onClick={onHistory}>History</button>}
        <div className="mode-lockup" aria-label={`${mode} mode`}><span className="status-light" /> {mode} run</div>
        <a href={judging ? "/studio" : "/judging"}>{judging ? "Exit judging mode" : "Judging mode"}</a>
      </div>
    </header>
  );
}

function PageMasthead({ index, label, title, detail }: { index: string; label: string; title: string; detail: string }) {
  return (
    <div className="page-masthead">
      <p className="section-index">{index}</p>
      <div>
        <p className="eyebrow">{label}</p>
        <h1>{title}</h1>
      </div>
      <p className="masthead-detail">{detail}</p>
    </div>
  );
}

type ResearchState = "standby" | "fixture" | "completed" | "degraded" | "failed";

const researchStateFromSnapshot = (snapshot?: CampaignSnapshot): ResearchState => {
  if (!snapshot || snapshot.status === "idle" || snapshot.status === "awaiting_source_profile") return "standby";
  const calls = snapshot.agentRuns.find(({ role }) => role === "brand_market_analyst")?.toolCalls?.filter(({ provider }) => provider === "you") ?? [];
  if (!calls.length) return snapshot.mode === "fixture" ? "fixture" : snapshot.brief ? "degraded" : "standby";
  if (calls.every(({ status }) => status === "completed")) return "completed";
  if (calls.every(({ status }) => status === "failed")) return "failed";
  return "degraded";
};

function ProductionStatus({ profileApproved, conceptApproved, storyboardApproved, researchState }: { profileApproved: boolean; conceptApproved: boolean; storyboardApproved: boolean; researchState: ResearchState }) {
  const phase = !profileApproved
    ? { label: "Source Profile decision", detail: "Correct the extracted brand facts", progress: "01 / 04" }
    : !conceptApproved
      ? { label: "Concept decision", detail: "Choose one evidence-backed direction", progress: "02 / 04" }
      : !storyboardApproved
        ? { label: "Storyboard decision", detail: "Review the cut before production", progress: "03 / 04" }
        : { label: "Campaign complete", detail: "Critic checks passed", progress: "04 / 04" };
  const researchStep = !profileApproved ? "current" : researchState === "completed" || researchState === "fixture" ? "complete" : researchState === "standby" ? "queued" : "degraded";
  const steps = [
    { label: "Research", state: researchStep },
    { label: "Concept", state: conceptApproved ? "complete" : profileApproved ? "current" : "queued" },
    { label: "Storyboard", state: storyboardApproved ? "complete" : conceptApproved ? "current" : "queued" },
    { label: "Campaign", state: storyboardApproved ? "complete" : "queued" },
  ];

  return (
    <section className="production-status" aria-label="Campaign production status">
      <div className="current-decision">
        <span>Now on the desk</span>
        <strong>{phase.label}</strong>
        <small>{phase.detail}</small>
      </div>
      <ol className="production-steps">
        {steps.map((step, index) => (
          <li className={`step-${step.state}`} key={step.label} aria-current={step.state === "current" ? "step" : undefined}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{step.label}</strong>
            <i />
          </li>
        ))}
      </ol>
      <div className="production-progress"><span>Production progress</span><strong>{phase.progress}</strong></div>
    </section>
  );
}

function SponsorRail({ snapshot, events, roomUrl, retrying, onRetry }: {
  snapshot?: CampaignSnapshot;
  events: CampaignEvent[];
  roomUrl?: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const externalEvidence = snapshot?.brief?.evidenceBasis.items.filter(({ sourceKind }) => sourceKind === "external_research") ?? [];
  const websiteEvidence = snapshot?.brief?.evidenceBasis.items.filter(({ sourceKind }) => sourceKind === "source_website") ?? [];
  const board = snapshot ? deriveBandProductionBoard({ snapshot, events, bandRoomUrl: roomUrl }) : undefined;
  const youState = researchStateFromSnapshot(snapshot);

  return (
    <section className="sponsor-rail" aria-labelledby="sponsor-rail-title">
      <div className="sponsor-intro">
        <p className="eyebrow">Sponsor infrastructure</p>
        <h2 id="sponsor-rail-title">Research and collaboration, in the open.</h2>
      </div>
      <article className={`sponsor-card sponsor-${youState}`}>
        <div><ProviderMark provider="you" /><span className="provider-state">{youState}</span></div>
        <p>{externalEvidence.length ? "Cited market evidence is retained for the Analyst and each concept’s Evidence Basis." : "No external claims are substituted; the Evidence Basis is explicitly Source Website only."}</p>
        <footer><strong>{externalEvidence.length}</strong><span>cited findings retained · {websiteEvidence.length} Source Website facts</span></footer>
      </article>
      <article className={`band-production-board band-board-${board?.state ?? "configuring"}`} aria-labelledby="band-board-heading">
        <header className="band-board-header">
          <div><ProviderMark provider="band" compact /><p className="eyebrow">Wave 1 · Production board</p><h3 id="band-board-heading">The room is the rundown.</h3></div>
          <span className="provider-state" aria-live="polite">{board?.state ?? "configuring"}</span>
        </header>
        <div className="band-board-goal"><span>Room goal</span><strong>{board?.goal ?? "Waiting for a persisted Campaign goal."}</strong></div>
        <div className="band-board-tally" aria-label="Band task counts">
          <div><strong>{board?.counts.total ?? 0}</strong><span>tasks</span></div>
          <div><strong>{board?.counts.completed ?? 0}</strong><span>synced</span></div>
          <div><strong>{board?.counts.incomplete ?? 0}</strong><span>incomplete</span></div>
          {board?.room ? <a href={board.room.url} target="_blank" rel="noreferrer">Open validated room <Arrow /></a> : <small>Room URL not configured for display</small>}
        </div>
        <ol className="band-agent-call-sheet" aria-label="Four named Band agents">
          {board?.agents.map((agent, index) => <li key={agent.role}><span>{String(index + 1).padStart(2, "0")}</span><strong>{agent.name}</strong><small>{agent.role}</small></li>)}
        </ol>
        {board?.degradedDisclosure && <div className="band-warning" role="alert"><span>{board.degradedDisclosure}</span><button type="button" onClick={onRetry} disabled={retrying}>{retrying ? "Retrying incomplete operations…" : "Retry incomplete Band operations"}</button></div>}
        <ol className="band-task-ledger" aria-label="Band production tasks">
          {board?.tasks.length ? board.tasks.map((task, index) => (
            <li key={task.key}>
              <span className="band-task-number">{String(index + 1).padStart(2, "0")}</span>
              <div className="band-task-copy"><strong>{task.label}</strong><small>{task.owner}</small><em>{task.humanBoundary ? "Human approval boundary · unassigned" : "Named Remote Agent"}</em></div>
              <dl><div><dt>Local</dt><dd>{task.localState}</dd></div><div><dt>Band sync</dt><dd className={`band-sync-${task.syncState}`}>{task.syncState}</dd></div></dl>
            </li>
          )) : <li className="band-task-empty">No persisted Band tasks yet. No Band success is inferred.</li>}
        </ol>
      </article>
    </section>
  );
}

function ConfigureView({ campaignType, durationSeconds, audience, sourceWebsite, featureName, featureDescription, featurePageUrl, judgingPreset, judgingPresetError, busy, error, onCampaignTypeChange, onDurationChange, onAudienceChange, onSourceWebsiteChange, onFeatureNameChange, onFeatureDescriptionChange, onFeaturePageUrlChange, onApplyJudgingPreset, onStart }: {
  campaignType: CampaignType;
  durationSeconds: CampaignDurationSeconds;
  audience: string;
  sourceWebsite: string;
  featureName: string;
  featureDescription: string;
  featurePageUrl: string;
  judgingPreset?: JudgingPresetResponse;
  judgingPresetError: string;
  busy: boolean;
  error: string;
  onCampaignTypeChange: (value: CampaignType) => void;
  onDurationChange: (value: CampaignDurationSeconds) => void;
  onAudienceChange: (value: string) => void;
  onSourceWebsiteChange: (value: string) => void;
  onFeatureNameChange: (value: string) => void;
  onFeatureDescriptionChange: (value: string) => void;
  onFeaturePageUrlChange: (value: string) => void;
  onApplyJudgingPreset: () => void;
  onStart: () => void;
}) {
  const fixture = campaignFixture;
  const featureRequired = campaignType === "feature_announcement";
  const ready = Boolean(audience.trim() && sourceWebsite.trim() && (!featureRequired || featureName.trim() && featureDescription.trim() && featurePageUrl.trim()));
  const preset = judgingPreset?.preset;
  const presetConfiguration = judgingPreset?.configuration;
  const presetAvailable = Boolean(preset && presetConfiguration);
  return (
    <main id="main-content" className="view-shell configure-view">
      <PageMasthead
        index="01"
        label="Production order"
        title="Put a Campaign into production."
        detail="Define the commercial intent. LaunchReel’s fixture company takes it from evidence to packaged Campaign."
      />

      <div className="configure-grid">
        <section className="order-form" aria-labelledby="order-heading">
          <div className="section-heading">
            <p className="eyebrow" id="order-heading">Campaign brief</p>
            <span>Required fields</span>
          </div>
          <section className="judging-preset" aria-labelledby="judging-preset-heading" aria-live="polite">
            <div>
              <p className="eyebrow">Canonical demo preset</p>
              <h2 id="judging-preset-heading">{preset?.label ?? "Judging preset"}</h2>
            </div>
            {presetAvailable && preset && presetConfiguration ? (
              <>
                <dl>
                  <div><dt>Creative direction</dt><dd>{preset.creativeDirection}</dd></div>
                  <div><dt>CTA</dt><dd>{preset.callToAction}</dd></div>
                  <div><dt>Operator notes</dt><dd>{preset.operatorNotes}</dd></div>
                </dl>
                {presetConfiguration.ready ? (
                  <p className="preset-ready">Configured from {preset.sourceWebsiteEnvironmentVariable}{preset.campaignType === "feature_announcement" ? ` and ${preset.featurePageEnvironmentVariable}` : ""}. Only these URL values are supplied to the form.</p>
                ) : (
                  <div className="preset-configuration-warning" role="alert">
                    <strong>Judging preset configuration is incomplete.</strong>
                    <ul>{presetConfiguration.issues.map((issue) => <li key={issue.environmentVariable}><code>{issue.environmentVariable}</code> is {issue.reason === "missing" ? "not set" : "not a valid public HTTP(S) URL"}.</li>)}</ul>
                  </div>
                )}
                <button type="button" className="preset-action" onClick={onApplyJudgingPreset} disabled={!presetConfiguration.ready}>
                  Apply judging preset
                </button>
                <small>Fills editable fields only. It never opens production or starts a Campaign.</small>
              </>
            ) : judgingPresetError ? (
              <p className="preset-configuration-warning" role="alert"><strong>Judging preset is unavailable.</strong> {judgingPresetError}</p>
            ) : (
              <p>Checking judging preset configuration…</p>
            )}
          </section>
          <fieldset>
            <legend>Campaign type</legend>
            <label className={`choice-card ${campaignType === "product_launch" ? "selected-choice" : "muted-choice"}`}>
              <input type="radio" name="campaign-type" checked={campaignType === "product_launch"} onChange={() => onCampaignTypeChange("product_launch")} />
              <span>
                <strong>Product Launch</strong>
                <small>Introduce a SaaS product to its intended audience.</small>
              </span>
              <span className="choice-mark">{campaignType === "product_launch" ? "Selected" : "Select"}</span>
            </label>
            <label className={`choice-card ${campaignType === "feature_announcement" ? "selected-choice" : "muted-choice"}`}>
              <input type="radio" name="campaign-type" checked={campaignType === "feature_announcement"} onChange={() => onCampaignTypeChange("feature_announcement")} />
              <span>
                <strong>Feature Announcement</strong>
                <small>Introduce a factual capability from its public feature page.</small>
              </span>
              <span className="choice-mark">{campaignType === "feature_announcement" ? "Selected" : "Select"}</span>
            </label>
          </fieldset>
          <label className="field-label" htmlFor="source-website">Source Website</label>
          <input id="source-website" type="url" value={sourceWebsite} onChange={(event) => onSourceWebsiteChange(event.target.value)} required />
          <label className="field-label" htmlFor="audience">Target Audience</label>
          <textarea id="audience" value={audience} onChange={(event) => onAudienceChange(event.target.value)} rows={3} required />
          {featureRequired && (
            <>
              <label className="field-label" htmlFor="feature-name">Feature name</label>
              <input id="feature-name" value={featureName} onChange={(event) => onFeatureNameChange(event.target.value)} required />
              <label className="field-label" htmlFor="feature-description">Factual feature description</label>
              <textarea id="feature-description" value={featureDescription} onChange={(event) => onFeatureDescriptionChange(event.target.value)} rows={3} required />
              <label className="field-label" htmlFor="feature-page">Public feature-page URL</label>
              <input id="feature-page" type="url" value={featurePageUrl} onChange={(event) => onFeaturePageUrlChange(event.target.value)} required />
            </>
          )}
          <fieldset>
            <legend>Duration</legend>
            {[30, 60].map((duration) => (
              <label className={`choice-card ${durationSeconds === duration ? "selected-choice" : "muted-choice"}`} key={duration}>
                <input type="radio" name="duration" checked={durationSeconds === duration} onChange={() => onDurationChange(duration as CampaignDurationSeconds)} />
                <span><strong>{duration} seconds</strong><small>{duration === 30 ? "4–8 scenes" : "7–14 scenes"} · 30 FPS</small></span>
                <span className="choice-mark">{durationSeconds === duration ? "Selected" : "Select"}</span>
              </label>
            ))}
          </fieldset>
          <span className="field-label">Output</span>
          <div className="locked-field">9:16 vertical <span>TikTok / Reels</span></div>
          {error && <p className="studio-error" role="alert">{error}</p>}
          <button className="primary-action" onClick={onStart} disabled={busy || !ready}>
            {busy ? "Opening production…" : "Open production"} <Arrow />
          </button>
        </section>

        <aside className="production-note" aria-label="Fixture production note">
          <div className="note-topline">
            <span>Production note</span>
            <span>LR—001</span>
          </div>
          <h2>One source.<br />Four desks.<br /><em>One campaign.</em></h2>
          <p>{fixture.brief.promise}</p>
          <dl>
            <div><dt>Source Website</dt><dd>{sourceWebsite}</dd></div>
            {featureRequired && <div><dt>Feature page</dt><dd>{featurePageUrl}</dd></div>}
            <div><dt>Production mode</dt><dd><ProvenanceTag mode="fixture" /> Deterministic</dd></div>
            <div><dt>Output spec</dt><dd>1080 × 1920 · {durationSeconds} seconds · 30 FPS</dd></div>
          </dl>
          <div className="approval-map" aria-label="Approval boundaries">
            <span>Brief</span><i /><span>Concept Approval</span><i /><span>Storyboard Approval</span><i /><span>Campaign</span>
          </div>
        </aside>
      </div>
    </main>
  );
}

function AgentRundown({ conceptApproved, storyboardApproved, snapshot }: { conceptApproved: boolean; storyboardApproved: boolean; snapshot?: CampaignSnapshot }) {
  const totalFrames = (snapshot?.configuration?.durationSeconds ?? campaignFixture.duration) * 30;
  const roles = ["brand_market_analyst", "creative_director", "video_producer", "creative_critic"] as const;
  const getAgent = (agent: AgentRun, index: number): AgentRun => {
    let display = agent;
    if (index === 1 && conceptApproved) display = {
      ...agent,
      state: "approved",
      handoff: "Storyboard handed to human approver",
      artifact: "Storyboard · v1",
      toolCalls: agent.toolCalls.map((tool) => tool.status === "waiting" ? { ...tool, status: "complete", detail: "Approval recorded" } : tool),
    };
    if (index === 2 && storyboardApproved) display = {
      ...agent,
      state: "complete",
      handoff: "Render handed to Creative Critic",
      artifact: "RenderManifest · complete",
      toolCalls: agent.toolCalls.map((tool) => ({ ...tool, status: "complete", detail: tool.provider === "Remotion" ? `${totalFrames} frames rendered` : "Audio synchronized" })),
    };
    if (index === 3 && storyboardApproved) display = {
      ...agent,
      state: "complete",
      handoff: "Completed Campaign handed to creator",
      artifact: "CriticReport · passed",
      toolCalls: agent.toolCalls.map((tool) => ({ ...tool, status: "complete", detail: tool.provider === "Filesystem" ? "7 artifacts packaged" : "Checks passed" })),
    };
    const runs = snapshot?.agentRuns.filter(({ role }) => role === roles[index]);
    const run = runs?.at(-1);
    if (!run) return display;
    return {
      ...display,
      model: run.modelId ?? display.model,
      prompt: run.promptVersion ?? display.prompt,
      toolCalls: run.toolCalls?.map((tool) => ({
        provider: providerLabel(tool.provider),
        operation: tool.operation,
        status: tool.status === "completed" ? "complete" as const : tool.status,
        detail: tool.summary,
        resultCount: tool.resultCount,
        degradation: tool.degradation,
        searchId: tool.searchId,
        providerLatency: tool.providerLatency,
      })) ?? display.toolCalls,
    };
  };

  return (
    <section className="rundown" aria-labelledby="rundown-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Production timeline</p><h2 id="rundown-heading">Artifact Handoffs</h2></div>
        <span>Local orchestrator · authoritative</span>
      </div>
      <div className="rundown-list">
        {campaignFixture.agents.map((baseAgent, index) => {
          const agent = getAgent(baseAgent, index);
          const isCurrent = (!conceptApproved && index === 1) || (conceptApproved && !storyboardApproved && index === 2);
          const stateLabel = isCurrent ? "Current desk" : agent.state === "complete" || agent.state === "approved" ? "Passed" : "Queued";
          return (
            <article className={`agent-row agent-${agent.state} ${isCurrent ? "agent-current" : ""}`} key={agent.id}>
              <time>{agent.timecode}</time>
              <div className="timeline-node"><span /></div>
              <div className="agent-identity">
                <div><span>{agent.id}</span><b className="agent-state">{stateLabel}</b></div>
                <h3>{agent.agent}</h3>
                <p>{agent.role}</p>
              </div>
              <div className="artifact-ticket">
                <span>Campaign Artifact</span>
                <strong>{agent.artifact}</strong>
                <small>{agent.handoff}</small>
              </div>
              <div className="run-proof">
                <ProvenanceTag mode={snapshot?.mode ?? "fixture"} />
                <span>{agent.model}</span>
                <span>{agent.prompt}</span>
              </div>
              <details className="tool-ledger" open={isCurrent}>
                <summary><span>{isCurrent ? `${snapshot?.mode === "live" ? "Live" : snapshot?.mode === "cached" ? "Cached" : "Fixture"} tool calls` : "Inspect tool calls"}</span><b>{agent.toolCalls.filter(({ status }) => status === "complete").length}/{agent.toolCalls.length}</b></summary>
                <div>
                  {agent.toolCalls.map((tool) => (
                    <article className={`tool-call tool-${tool.status}`} key={`${agent.id}-${tool.provider}-${tool.operation}`}>
                      <i />
                      <span><ProviderMark provider={tool.provider} compact /><small>{tool.operation}</small></span>
                      <em>
                        <b>{tool.status}</b>
                        <span>{tool.resultCount !== undefined ? `${tool.resultCount} results · ` : ""}{tool.detail}</span>
                        {tool.degradation && <span>{tool.degradation}</span>}
                        {(tool.searchId || tool.providerLatency !== undefined) && <span>{tool.searchId ? `search ${tool.searchId}` : ""}{tool.searchId && tool.providerLatency !== undefined ? " · " : ""}{tool.providerLatency !== undefined ? `provider latency ${tool.providerLatency}` : ""}</span>}
                      </em>
                    </article>
                  ))}
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ApprovalPanel({ type, selectedTitle, busy, onApprove }: { type: Approval; selectedTitle: string; busy: boolean; onApprove: () => void }) {
  const isConcept = type === "concept";
  return (
    <section className="approval-panel" aria-labelledby={`${type}-approval-title`}>
      <div className="approval-stamp" aria-hidden="true">Human<br />boundary</div>
      <div>
        <p className="eyebrow">{isConcept ? "Concept Approval" : "Storyboard Approval"}</p>
        <h2 id={`${type}-approval-title`}>{isConcept ? `Approve “${selectedTitle}”` : "Authorize final production"}</h2>
        <p>{isConcept ? "Your selection and direction become a validated Handoff to the Creative Director." : "This locks the scene plan and hands it to the Video Producer. Fixture media will complete immediately."}</p>
        {isConcept && <textarea aria-label="Creative direction" rows={2} placeholder="Optional direction for the Creative Director" />}
      </div>
      <button className="primary-action coral-action" onClick={onApprove} disabled={busy}>
        {busy ? "Recording approval…" : isConcept ? "Give Concept Approval" : "Give Storyboard Approval"} <Arrow />
      </button>
    </section>
  );
}

type StudioConcept = (typeof campaignFixture.concepts)[number];

const conceptsFromSnapshot = (snapshot?: CampaignSnapshot): StudioConcept[] => snapshot?.conceptSet?.concepts.map((concept) => ({
  id: concept.id,
  title: concept.title,
  thesis: concept.message,
  hook: concept.hook,
  message: concept.message,
  emotion: concept.emotionalDirection,
  visualMetaphor: concept.visualMetaphor,
  cta: concept.cta,
  evidenceIds: concept.evidenceSourceIds,
})) ?? campaignFixture.concepts;

function Concepts({ concepts, selected, busy, onSelect, onApprove }: { concepts: StudioConcept[]; selected: string; busy: boolean; onSelect: (id: string) => void; onApprove: () => void }) {
  const selectedConcept = concepts.find((concept) => concept.id === selected) ?? concepts[0]!;
  return (
    <section className="concepts-section" aria-labelledby="concepts-heading">
      <div className="section-heading">
        <div><p className="eyebrow">CreativeConceptSet · v1</p><h2 id="concepts-heading">Three directions on the table</h2></div>
        <span>Evidence-backed · select one</span>
      </div>
      <div className="concept-grid">
        {concepts.map((concept, index) => {
          const active = selected === concept.id;
          return (
            <article className={`concept-card ${active ? "concept-selected" : ""}`} key={concept.id}>
              <button onClick={() => onSelect(concept.id)} aria-pressed={active} aria-label={`Select ${concept.title}`}>
                <span className="concept-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="concept-select">{active ? "On table" : "Review"}</span>
              </button>
              <h3>{concept.title}</h3>
              <p className="concept-thesis">{concept.thesis}</p>
              <dl>
                <div><dt>Hook</dt><dd>{concept.hook}</dd></div>
                <div><dt>Message</dt><dd>{concept.message}</dd></div>
                <div><dt>Feeling</dt><dd>{concept.emotion}</dd></div>
                <div><dt>Visual metaphor</dt><dd>{concept.visualMetaphor}</dd></div>
                <div><dt>CTA</dt><dd>{concept.cta}</dd></div>
              </dl>
              <div className="evidence-refs"><span>Evidence Basis</span>{concept.evidenceIds.map((id) => <b key={id}>{id}</b>)}</div>
            </article>
          );
        })}
      </div>
      <ApprovalPanel type="concept" selectedTitle={selectedConcept.title} busy={busy} onApprove={onApprove} />
    </section>
  );
}

function Storyboard({ scenes, assets, busy, onSceneChange, onAssetChange, onApprove }: { scenes: StoryboardScene[]; assets: CampaignAsset[]; busy: boolean; onSceneChange: (id: string, field: "narration" | "overlay", value: string) => void; onAssetChange: (id: string, assetId: string) => void; onApprove: () => void }) {
  const durationSeconds = scenes.reduce((total, scene) => total + scene.duration, 0);
  return (
    <section className="storyboard-section" aria-labelledby="storyboard-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Storyboard · v1</p><h2 id="storyboard-heading">{durationSeconds} seconds, on paper</h2></div>
        <span>{scenes.length} scenes · {durationSeconds} seconds exact</span>
      </div>
      <div className="storyboard-strip">
        {scenes.map((scene, index) => (
          <article className="scene-card" key={scene.id}>
            <div className="scene-time"><span>{scene.id}</span><time>{String(scene.start).padStart(2, "0")}:00—{String(scene.start + scene.duration).padStart(2, "0")}:00</time></div>
            <div className={`scene-frame frame-${index + 1}`}>
              <span>{scene.beat}</span>
              <strong>{scene.overlay}</strong>
              <div className="safe-frame" />
            </div>
            <div className="scene-copy">
              <label htmlFor={`${scene.id}-narration`}>Narration</label>
              <textarea id={`${scene.id}-narration`} value={scene.narration} rows={4} onChange={(event) => onSceneChange(scene.id, "narration", event.target.value)} />
              <label htmlFor={`${scene.id}-overlay`}>Overlay text</label>
              <input id={`${scene.id}-overlay`} value={scene.overlay} onChange={(event) => onSceneChange(scene.id, "overlay", event.target.value)} />
              <label htmlFor={`${scene.id}-asset`}>Scene image</label>
              <select id={`${scene.id}-asset`} aria-label={`Scene image ${scene.id}`} value={scene.assetId ?? ""} onChange={(event) => onAssetChange(scene.id, event.target.value)}>
                <option value="">Storyboard default · {scene.provenance}</option>
                {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.provenance}</option>)}
              </select>
            </div>
            <footer>
              <ProvenanceTag mode={scene.provenance} />
              <span>{scene.asset}</span>
            </footer>
          </article>
        ))}
      </div>
      <div className="storyboard-tools">
        <button disabled>Regenerate storyboard <span>1 remaining · fixture locked</span></button>
        <p>Timing, transitions, order, and scene count remain system-controlled.</p>
      </div>
      <ApprovalPanel type="storyboard" selectedTitle="" busy={busy} onApprove={onApprove} />
    </section>
  );
}

function EvidenceDrawer({ snapshot }: { snapshot?: CampaignSnapshot }) {
  const liveEvidence = snapshot?.brief?.evidenceBasis.items;
  const evidence = liveEvidence?.map((item) => ({
    id: item.id,
    claim: item.claim,
    source: item.title ?? new URL(item.sourceUrl).hostname,
    sourceUrl: item.sourceUrl,
    external: item.sourceKind === "external_research",
    researchIntents: item.researchIntents,
    searchId: item.searchId,
    providerLatency: item.providerLatency,
  })) ?? campaignFixture.evidence.map((item) => ({ ...item, sourceUrl: undefined, external: false, researchIntents: undefined, searchId: undefined, providerLatency: undefined }));
  const externalCount = evidence.filter(({ external }) => external).length;
  return (
    <details className="evidence-drawer">
      <summary><span>Evidence Basis</span><strong>{externalCount ? `${externalCount} You.com citations · ${evidence.length - externalCount} website facts` : `${evidence.length} Source Website facts · market claims prohibited`}</strong><span>Open citations +</span></summary>
      <div className="evidence-list">
        {evidence.map((item) => (
          <article key={item.id}>
            <div className="evidence-provider">{item.external ? <ProviderMark provider="you" compact /> : <ProvenanceTag mode="source" />}<b>{item.id}</b></div>
            {item.researchIntents?.length ? <span className="evidence-intent">{item.researchIntents.map((intent) => intent.replaceAll("_", " ")).join(" · ")}</span> : <span className="evidence-intent">Source Website</span>}
            <p>{item.claim}</p>
            {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.source} <span aria-hidden="true">↗</span></a> : <span>{item.source}</span>}
            {(item.searchId || item.providerLatency !== undefined) && <small>{item.searchId ? `Search ${item.searchId}` : ""}{item.searchId && item.providerLatency !== undefined ? " · " : ""}{item.providerLatency !== undefined ? `provider latency ${item.providerLatency}` : ""}</small>}
          </article>
        ))}
      </div>
    </details>
  );
}

function SourceProfilePanel({ snapshot, draft, busy, onChange, onApprove, onUpload }: {
  snapshot: CampaignSnapshot;
  draft: SourceProfileApproval;
  busy: boolean;
  onChange: (field: keyof SourceProfileApproval, value: string | string[]) => void;
  onApprove: () => void;
  onUpload: (file: File) => void;
}) {
  const profile = snapshot.sourceProfile!;
  const assets = [...profile.assets, ...snapshot.uploadedAssets];
  return (
    <section className="source-profile" aria-labelledby="source-profile-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Source Profile · extracted</p><h2 id="source-profile-heading">Approve the source before concepts.</h2></div>
        <span>{profile.pagesCrawled} pages retained · {assets.length} authentic assets</span>
      </div>
      {profile.warnings.length > 0 && (
        <div className="crawl-warnings" role="alert">
          <strong>Partial Source Website results retained</strong>
          <ul>{profile.warnings.map((warning) => <li key={`${warning.code}-${warning.url}`}><b>{warning.code.replaceAll("_", " ")}</b> {warning.message} · {warning.url}</li>)}</ul>
        </div>
      )}
      <div className="profile-grid">
        <div className="profile-fields">
          <label>SaaS Company<input value={draft.saasCompany} onChange={(event) => onChange("saasCompany", event.target.value)} /></label>
          <label>Product name<input value={draft.productName} onChange={(event) => onChange("productName", event.target.value)} /></label>
          <label>Positioning<textarea rows={3} value={draft.positioning} onChange={(event) => onChange("positioning", event.target.value)} /></label>
          <label>Description<textarea rows={3} value={draft.description} onChange={(event) => onChange("description", event.target.value)} /></label>
          <label>Brand colors<input value={draft.colors.join(", ")} onChange={(event) => onChange("colors", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} /></label>
          <label>Calls to action<input value={draft.callsToAction.join(", ")} onChange={(event) => onChange("callsToAction", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} /></label>
        </div>
        <aside className="profile-assets">
          <div><strong>Authentic asset catalog</strong><ProvenanceTag mode="source" /></div>
          <ul>{assets.map((asset) => <li key={asset.id}><ProvenanceTag mode={asset.provenance} /><span>{asset.name}</span><small>{asset.sourcePageUrl ?? asset.fileName}</small></li>)}</ul>
          <label className="upload-control">Upload PNG, JPEG, or WebP<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} /></label>
          <small>10MB maximum. SVG, MIME mismatch, remote URLs, and invalid bytes are rejected.</small>
        </aside>
      </div>
      <button className="primary-action coral-action" onClick={onApprove} disabled={busy}>Approve Source Profile and generate concepts <Arrow /></button>
    </section>
  );
}

function StudioView({ profileApproved, conceptApproved, storyboardApproved, concepts, selectedConcept, scenes, snapshot, events, bandRoomUrl, bandRetrying, busy, profileDraft, onProfileChange, onProfileApprove, onUpload, onSelectConcept, onConceptApprove, onSceneChange, onSceneAssetChange, onStoryboardApprove, onBandRetry }: {
  profileApproved: boolean;
  conceptApproved: boolean;
  storyboardApproved: boolean;
  concepts: StudioConcept[];
  snapshot?: CampaignSnapshot;
  events: CampaignEvent[];
  bandRoomUrl?: string;
  bandRetrying: boolean;
  busy: boolean;
  selectedConcept: string;
  scenes: StoryboardScene[];
  profileDraft: SourceProfileApproval;
  onProfileChange: (field: keyof SourceProfileApproval, value: string | string[]) => void;
  onProfileApprove: () => void;
  onUpload: (file: File) => void;
  onSelectConcept: (id: string) => void;
  onConceptApprove: () => void;
  onSceneChange: (id: string, field: "narration" | "overlay", value: string) => void;
  onSceneAssetChange: (id: string, assetId: string) => void;
  onStoryboardApprove: () => void;
  onBandRetry: () => void;
}) {
  const campaignType = snapshot?.configuration?.type === "feature_announcement" ? "Feature Announcement" : "Product Launch";
  const durationSeconds = snapshot?.configuration?.durationSeconds ?? campaignFixture.duration;
  return (
    <main id="main-content" className="view-shell studio-view">
      <PageMasthead index="02" label="Production studio" title="The work, in sequence." detail="Validated Campaign Artifacts move between specialized desks. Human approval marks the consequential cuts." />
      <div className="campaign-running-line">
        <span>{snapshot?.id ?? campaignFixture.id}</span><strong>{snapshot?.sourceProfile?.productName ?? campaignFixture.name}</strong><span>{durationSeconds}s · {campaignType}</span><ProvenanceTag mode={snapshot?.mode ?? "fixture"} />
      </div>
      <ProductionStatus profileApproved={profileApproved} conceptApproved={conceptApproved} storyboardApproved={storyboardApproved} researchState={researchStateFromSnapshot(snapshot)} />
      <SponsorRail snapshot={snapshot} events={events} roomUrl={bandRoomUrl} retrying={bandRetrying} onRetry={onBandRetry} />
      {!profileApproved && snapshot?.sourceProfile ? (
        <SourceProfilePanel snapshot={snapshot} draft={profileDraft} busy={busy} onChange={onProfileChange} onApprove={onProfileApprove} onUpload={onUpload} />
      ) : (
        <>
          <AgentRundown conceptApproved={conceptApproved} storyboardApproved={storyboardApproved} snapshot={snapshot} />
          <EvidenceDrawer snapshot={snapshot} />
          {!conceptApproved ? (
            <Concepts concepts={concepts} selected={selectedConcept} busy={busy} onSelect={onSelectConcept} onApprove={onConceptApprove} />
          ) : (
            <Storyboard scenes={scenes} assets={[...(snapshot?.sourceProfile?.assets ?? []), ...(snapshot?.uploadedAssets ?? [])]} busy={busy} onSceneChange={onSceneChange} onAssetChange={onSceneAssetChange} onApprove={onStoryboardApprove} />
          )}
        </>
      )}
    </main>
  );
}

function PreviewFrame({ scenes, durationSeconds }: { scenes: StoryboardScene[]; durationSeconds: CampaignDurationSeconds }) {
  return (
    <div className="video-preview" aria-label="Fixture promotional video preview">
      <div className="preview-status"><span>Cached preview</span><time>{durationTimecode(durationSeconds)}</time></div>
      <div className="preview-title"><span>LAUNCH</span><span>REEL</span></div>
      <div className="preview-caption">{scenes.at(-1)?.overlay}</div>
      <div className="preview-play" aria-hidden="true">▶</div>
      <div className="preview-safe">1080 × 1920</div>
    </div>
  );
}

function HistoryDrawer({ open, campaigns, onClose, onOpenCampaign, onDelete }: {
  open: boolean;
  campaigns: CampaignHistoryEntry[];
  onClose: () => void;
  onOpenCampaign: (campaignId: string) => void;
  onDelete: (campaignId: string) => void;
}) {
  if (!open) return null;
  return (
    <aside className="history-drawer" aria-label="Completed Campaign history">
      <header><div><p className="eyebrow">Retained locally</p><h2>Campaign history</h2></div><button onClick={onClose} aria-label="Close Campaign history">Close</button></header>
      <p>Up to five most recent completed Campaigns retain their full review and package.</p>
      {campaigns.length ? <ol>{campaigns.map((campaign) => (
        <li key={campaign.campaignId}>
          <button onClick={() => onOpenCampaign(campaign.campaignId)}><strong>{campaign.title}</strong><span>{campaign.campaignType.replaceAll("_", " ")} · {campaign.durationSeconds}s</span><time>{new Date(campaign.completedAt).toLocaleString()}</time></button>
          <button className="history-delete" onClick={() => onDelete(campaign.campaignId)} aria-label={`Delete ${campaign.title}`}>Delete</button>
        </li>
      ))}</ol> : <p className="history-empty">No completed Campaigns yet.</p>}
    </aside>
  );
}

const failureLabels = {
  source_website_ingestion: "Source Website ingestion",
  you_research: "You.com research",
  token_router_generation: "Token Router Agent generation",
  band_synchronization: "Band synchronization",
  deepgram_narration: "Deepgram narration",
  remotion_rendering: "Remotion rendering",
  critic_validation: "Critic validation",
  package_generation: "Package generation",
} as const;

function CampaignFailurePanel({ snapshot, busy, onRetry, onDelete }: { snapshot?: CampaignSnapshot; busy: boolean; onRetry: () => void; onDelete: () => void }) {
  const failure = snapshot?.failure ?? snapshot?.productionFailure;
  if (!failure?.stage) return null;
  return (
    <section className="campaign-failure" role="alert">
      <div><p className="eyebrow">{failureLabels[failure.stage]} failed</p><strong>{failure.message}</strong><span>{failure.resolution}</span></div>
      {failure.retryable
        ? <button className="primary-action" disabled={busy} onClick={onRetry}>Retry {failureLabels[failure.stage]} <Arrow /></button>
        : <button className="destructive-action" disabled={busy} onClick={onDelete}>Delete and reconfigure</button>}
    </section>
  );
}

function CampaignView({ snapshot, scenes, packageHref, historical, busy, events, bandRoomUrl, judging, onStartAnother, onDelete, onRequestCorrection, onAuthorizeCorrection }: {
  snapshot?: CampaignSnapshot;
  scenes: StoryboardScene[];
  packageHref: string;
  historical: boolean;
  busy: boolean;
  events: CampaignEvent[];
  bandRoomUrl?: string;
  judging: boolean;
  onStartAnother: () => void;
  onDelete: () => void;
  onRequestCorrection: (request: { target: { scope: "campaign" } | { scope: "scene"; sceneId: string }; requestedChange: string; reason: string }) => void;
  onAuthorizeCorrection: () => void;
}) {
  const [correctionTarget, setCorrectionTarget] = useState("campaign");
  const [requestedChange, setRequestedChange] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  if (judging && snapshot?.status === "completed" && snapshot.configuration && snapshot.packageManifest) {
    return <ProductionProof snapshot={snapshot} events={events} bandRoomUrl={bandRoomUrl} judging />;
  }
  if (!snapshot || !["completed", "correction_requested"].includes(snapshot.status) || !snapshot.packageManifest || !snapshot.criticReport) {
    return (
      <main id="main-content" className="view-shell campaign-view empty-campaign">
        <PageMasthead index="03" label="Campaign delivery" title="The package is not on the desk yet." detail="Give Concept Approval and Storyboard Approval in the Studio to authorize production before opening Run Proof." />
      </main>
    );
  }

  const durationSeconds = snapshot.configuration!.durationSeconds;
  const campaignType = snapshot.configuration!.type === "feature_announcement" ? "Feature Announcement" : "Product Launch";
  const campaignTitle = snapshot.configuration!.type === "feature_announcement" ? snapshot.configuration!.featureName : snapshot.brief?.productName ?? "Product launch";
  const correctionState = snapshot.correction?.state ?? "available";
  const correctionLabel = correctionState === "available" ? "Correction available" : correctionState === "requested" ? "Correction requested" : correctionState === "rerendering" ? "Rerendering" : "Corrected Campaign complete";
  const packageMode = snapshot.packageManifest.mode;
  const packageModeLabel = packageMode === "live" ? "Rendered Campaign" : packageMode === "cached" ? "Cached disclosure" : "Fixture disclosure";
  const advisory = snapshot.criticReport.advisory;
  const criticNotes = snapshot.criticReport.advisoryNotes;
  const scoreRows = [
    ["Hook", advisory.hook],
    ["Pacing", advisory.pacing],
    ["Visual coherence", advisory.visualCoherence],
    ["Product visibility", advisory.productVisibility],
    ["CTA", advisory.cta],
  ] as const;
  return (
    <main id="main-content" className="view-shell campaign-view">
      <PageMasthead index="03" label={historical ? "Campaign history" : "Campaign delivery"} title={correctionState === "corrected_complete" ? "A corrected Campaign, packaged." : "A complete Campaign, packaged."} detail="The critic passed every objective check. Advisory notes, citations, and production provenance remain available; no automatic rerender was started." />
      <div className="campaign-actions">
        <button className="primary-action" onClick={onStartAnother}>Start another Campaign <Arrow /></button>
        {!historical && <a className="proof-report-link" href="/judging">Open Run Proof <Arrow /></a>}
        <button className="destructive-action" onClick={onDelete}>Delete Campaign</button>
      </div>
      <div className="delivery-grid">
        <section className="screening-room" aria-labelledby="screening-title">
          <div className="section-heading"><div><p className="eyebrow">{campaignType} · Promotional Video</p><h2 id="screening-title">{campaignTitle}</h2></div><ProvenanceTag mode={packageMode} /></div>
          {packageMode === "live" ? (
            <video className="campaign-video" controls playsInline poster={`/campaigns/${snapshot.id}/thumbnail.jpg`}>
              <source src={`/campaigns/${snapshot.id}/campaign.mp4`} type="video/mp4" />
            </video>
          ) : <PreviewFrame scenes={scenes} durationSeconds={durationSeconds} />}
          <p className="preview-disclosure"><strong>{packageModeLabel}:</strong> {packageMode === "live" ? "this preview is the approved Remotion output packaged by the workflow." : `this is a designed preview of a ${packageMode} artifact.`}</p>
        </section>
        <aside className="delivery-docket">
          <div className="docket-mark">Passed<br /><span>04 / 04</span></div>
          <p className="eyebrow">Creative Critic · report</p>
          <h2>Cleared for Campaign</h2>
          <ul className="quality-list">
            <li><span>Format</span><strong>{snapshot.renderManifest?.width ?? 1080} × {snapshot.renderManifest?.height ?? 1920} · {snapshot.renderManifest?.fps ?? 30} FPS</strong><b>Pass</b></li>
            <li><span>Duration</span><strong>{durationTimecode(durationSeconds)} exact</strong><b>Pass</b></li>
            <li><span>Narration</span><strong>{snapshot.renderManifest?.media.narration.provider ?? "Fixture"} track present</strong><b>Pass</b></li>
            <li><span>Package</span><strong>{snapshot.packageManifest.files.length} required artifacts</strong><b>Pass</b></li>
          </ul>
          <div className="critic-scores">{scoreRows.map(([label, score]) => <div key={label}><span>{label}</span><strong>{score.toFixed(1)} / 5</strong></div>)}</div>
          <div className="advisory-note"><span>Advisory creative feedback</span>{criticNotes.length ? criticNotes.map((note) => <p key={note}>{note}</p>) : <p>No advisory notes were recorded.</p>}</div>
          {packageMode === "live" ? (
            <a className="primary-action" href={packageHref} download={`launchreel-${snapshot.id}.zip`}>Download Campaign ZIP <Arrow /></a>
          ) : (
            <button className="primary-action" disabled>Campaign ZIP unavailable in {packageMode} mode</button>
          )}
          <small className="download-note">{packageMode === "live" ? "Validated package" : packageMode === "cached" ? "Cached manifest" : "Fixture manifest"} · {snapshot.packageManifest.files.length} production artifacts</small>
        </aside>
      </div>
      <div className="campaign-record-grid">
        <details open><summary>Critic review</summary><ul>{criticNotes.map((note) => <li key={note}>{note}</li>)}</ul></details>
        <details><summary>Citations · {snapshot.brief?.evidenceBasis.items.length ?? 0}</summary><ul>{snapshot.brief?.evidenceBasis.items.map((item) => <li key={item.id}><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title ?? item.claim}</a><span>{item.claim}</span></li>)}</ul></details>
        <details><summary>Provenance</summary><dl><div><dt>Campaign ID</dt><dd>{snapshot.id}</dd></div><div><dt>Mode</dt><dd>{snapshot.mode}</dd></div><div><dt>Narration</dt><dd>{snapshot.renderManifest?.media.narration.provider ?? "fixture"}</dd></div><div><dt>Music</dt><dd>{snapshot.renderManifest?.media.music.origin ?? "fixture"}</dd></div></dl></details>
      </div>
      {!historical && <section className="correction-panel" aria-labelledby="correction-heading">
        <div className="section-heading"><div><p className="eyebrow">Targeted final correction</p><h2 id="correction-heading">{correctionLabel}</h2></div><span>{snapshot.correction?.limitReached ? "Correction limit reached" : "One request remaining"}</span></div>
        {correctionState === "available" && <form onSubmit={(event) => {
          event.preventDefault();
          const target = correctionTarget === "campaign" ? { scope: "campaign" as const } : { scope: "scene" as const, sceneId: correctionTarget };
          onRequestCorrection({ target, requestedChange, reason: correctionReason });
        }}>
          <label><span>Target</span><select value={correctionTarget} onChange={(event) => setCorrectionTarget(event.target.value)}><option value="campaign">Campaign-level CTA</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.id}</option>)}</select></label>
          <label><span>Requested change</span><input required maxLength={120} value={requestedChange} onChange={(event) => setRequestedChange(event.target.value)} /></label>
          <label><span>Reason</span><textarea required maxLength={1000} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
          <button className="primary-action" disabled={busy}>Request one correction <Arrow /></button>
        </form>}
        {correctionState === "requested" && <div className="correction-request"><p><strong>{snapshot.correction?.request?.requestedChange}</strong></p><p>{snapshot.correction?.request?.reason}</p><button className="primary-action" disabled={busy} onClick={onAuthorizeCorrection}>{busy ? "Rerendering…" : "Authorize targeted rerender"} <Arrow /></button></div>}
        {correctionState === "rerendering" && <p aria-live="polite">Rerendering the authorized target while retaining approved narration and caption timing.</p>}
        {correctionState === "corrected_complete" && <p>Corrected Campaign complete. The single correction has been recorded in events and package provenance.</p>}
      </section>}
      <section className="package-manifest" aria-labelledby="manifest-heading">
        <div className="section-heading"><div><p className="eyebrow">Campaign package</p><h2 id="manifest-heading">What leaves the studio</h2></div><span>Provenance included</span></div>
        <div className="manifest-grid">
          {snapshot.packageManifest.files.map((file, index) => <div key={file}><span>{String(index + 1).padStart(2, "0")}</span><strong>{file}</strong><ProvenanceTag mode={packageMode} /></div>)}
        </div>
      </section>
    </main>
  );
}

const campaignRequest = async (url: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: unknown) => {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Campaign request failed");
  return value as CampaignSnapshot;
};

const storyboardScenes = (snapshot: CampaignSnapshot): StoryboardScene[] | undefined => {
  if (!snapshot.storyboard) return undefined;
  let start = 0;
  return snapshot.storyboard.scenes.map((scene, index) => {
    const mapped: StoryboardScene = {
      id: scene.id,
      start,
      duration: scene.durationSeconds,
      beat: ["Cold open", "Source in", "Company at work", "Human boundary", "Campaign out"][index] ?? `Scene ${index + 1}`,
      narration: scene.narration,
      overlay: scene.overlayText,
      visual: scene.visual.uri,
      asset: scene.visual.uri,
      assetId: scene.visual.assetId,
      provenance: scene.visual.kind,
    };
    start += scene.durationSeconds;
    return mapped;
  });
};

const emptyProfileDraft: SourceProfileApproval = {
  saasCompany: "",
  productName: "",
  positioning: "",
  description: "",
  colors: [],
  callsToAction: [],
};

export function ProductionStudio({ judging = false }: { judging?: boolean }) {
  const [view, setView] = useState<View>(judging ? "campaign" : "configure");
  const [selectedConcept, setSelectedConcept] = useState(campaignFixture.concepts[0].id);
  const [profileApproved, setProfileApproved] = useState(false);
  const [profileDraft, setProfileDraft] = useState<SourceProfileApproval>(emptyProfileDraft);
  const [conceptApproved, setConceptApproved] = useState(false);
  const [storyboardApproved, setStoryboardApproved] = useState(false);
  const [scenes, setScenes] = useState(campaignFixture.storyboard);
  const [campaignType, setCampaignType] = useState<CampaignType>("product_launch");
  const [durationSeconds, setDurationSeconds] = useState<CampaignDurationSeconds>(30);
  const [audience, setAudience] = useState(campaignFixture.targetAudience);
  const [sourceWebsite, setSourceWebsite] = useState("https://launchreel.local");
  const [featureName, setFeatureName] = useState("");
  const [featureDescription, setFeatureDescription] = useState("");
  const [featurePageUrl, setFeaturePageUrl] = useState("");
  const [judgingPreset, setJudgingPreset] = useState<JudgingPresetResponse>();
  const [judgingPresetError, setJudgingPresetError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<CampaignSnapshot>();
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [bandRoomUrl, setBandRoomUrl] = useState<string>();
  const [bandRetrying, setBandRetrying] = useState(false);
  const [history, setHistory] = useState<CampaignHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historicalSnapshot, setHistoricalSnapshot] = useState<CampaignSnapshot>();

  const applySnapshot = (next: CampaignSnapshot) => {
    setHistoricalSnapshot(undefined);
    setSnapshot(next);
    setProfileApproved(next.status !== "idle" && next.status !== "awaiting_source_profile");
    if (next.sourceProfile) setProfileDraft((current) => current.saasCompany ? current : {
      saasCompany: next.sourceProfile!.saasCompany,
      productName: next.sourceProfile!.productName,
      positioning: next.sourceProfile!.positioning,
      description: next.sourceProfile!.description,
      colors: next.sourceProfile!.colors,
      callsToAction: next.sourceProfile!.callsToAction,
    });
    setConceptApproved(["awaiting_storyboard_approval", "production_failed", "correction_requested", "rerendering", "completed"].includes(next.status));
    setStoryboardApproved(["correction_requested", "rerendering", "completed"].includes(next.status));
    const recoveredScenes = storyboardScenes(next);
    if (recoveredScenes) setScenes(recoveredScenes);
    if (next.conceptApproval?.conceptId) setSelectedConcept(next.conceptApproval.conceptId);
    else if (next.conceptSet?.concepts[0]) setSelectedConcept(next.conceptSet.concepts[0].id);
    if (next.configuration) {
      setCampaignType(next.configuration.type);
      setDurationSeconds(next.configuration.durationSeconds);
      setAudience(next.configuration.targetAudience);
      setSourceWebsite(next.configuration.sourceWebsite);
      if (next.configuration.type === "feature_announcement") {
        setFeatureName(next.configuration.featureName);
        setFeatureDescription(next.configuration.featureDescription);
        setFeaturePageUrl(next.configuration.featurePageUrl);
      }
    }
  };
  const refreshHistory = async () => {
    const response = await fetch("/api/campaigns/history");
    if (response.ok) setHistory(await response.json() as CampaignHistoryEntry[]);
  };

  useEffect(() => {
    void campaignRequest("/api/campaigns/current", "GET").then(applySnapshot).catch(() => undefined);
    void fetch("/api/campaigns/current/collaboration")
      .then(async (response): Promise<{ roomUrl?: string }> => response.ok ? response.json() : {})
      .then(({ roomUrl }) => setBandRoomUrl(roomUrl))
      .catch(() => undefined);
    void fetch("/api/campaigns/history")
      .then(async (response): Promise<CampaignHistoryEntry[]> => response.ok ? response.json() : [])
      .then(setHistory)
      .catch(() => undefined);
    void fetch("/api/judging-preset", { cache: "no-store" })
      .then(async (response): Promise<JudgingPresetResponse> => {
        if (!response.ok) throw new Error("Preset metadata could not be loaded.");
        return response.json();
      })
      .then(setJudgingPreset)
      .catch((cause) => setJudgingPresetError(cause instanceof Error ? cause.message : "Preset metadata could not be loaded."));
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/campaigns/current/events?after=0");
    const receive = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as CampaignEvent;
      setEvents((current) => current.some(({ sequence }) => sequence === event.sequence) ? current : [...current, event]);
    };
    ["collaboration_sync", "provider_completed", "provider_degraded", "handoff_recorded", "campaign_completed", "campaign_failed", "correction_requested", "correction_rerendering", "correction_completed"].forEach((type) => source.addEventListener(type, receive as EventListener));
    return () => source.close();
  }, []);

  const navigate = (nextView: View) => setView(nextView);
  const applyJudgingPreset = () => {
    const sourceWebsite = judgingPreset?.formInputs.sourceWebsite;
    if (!judgingPreset?.configuration.ready || !sourceWebsite) return;
    const { preset, formInputs } = judgingPreset;
    setCampaignType(preset.campaignType);
    setDurationSeconds(preset.durationSeconds);
    setAudience(preset.targetAudience);
    setSourceWebsite(sourceWebsite);
    if (preset.campaignType === "feature_announcement") {
      setFeatureName(preset.featureName ?? "");
      setFeatureDescription(preset.factualFeatureDescription ?? "");
      setFeaturePageUrl(formInputs.featurePageUrl ?? "");
    } else {
      setFeatureName("");
      setFeatureDescription("");
      setFeaturePageUrl("");
    }
  };
  const startCampaign = async () => {
    setError("");
    setBusy(true);
    setEvents([]);
    setProfileDraft(emptyProfileDraft);
    try {
      const next = await campaignRequest("/api/campaigns/current", "POST", {
        type: campaignType,
        targetAudience: audience,
        durationSeconds,
        sourceWebsite,
        ...(campaignType === "feature_announcement" ? { featureName, featureDescription, featurePageUrl } : {}),
      });
      applySnapshot(next);
      setView("studio");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign request failed");
    } finally {
      setBusy(false);
    }
  };
  const approveSourceProfile = async () => {
    setError("");
    setBusy(true);
    try {
      applySnapshot(await campaignRequest("/api/campaigns/current/source-profile-approval", "POST", profileDraft));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Source Profile approval failed");
    } finally {
      setBusy(false);
    }
  };
  const uploadAsset = async (file: File) => {
    setError("");
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/campaigns/current/assets", { method: "POST", body });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Image upload failed");
      applySnapshot(value as CampaignSnapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Image upload failed");
    } finally {
      setBusy(false);
    }
  };
  const approveConcept = async () => {
    setError("");
    setBusy(true);
    try {
      applySnapshot(await campaignRequest("/api/campaigns/current/concept-approval", "POST", { conceptId: selectedConcept }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Concept Approval failed");
    } finally {
      setBusy(false);
    }
  };
  const approveStoryboard = async () => {
    if (!snapshot?.storyboard) return;
    setError("");
    setBusy(true);
    const editedStoryboard = {
      ...snapshot.storyboard,
      scenes: snapshot.storyboard.scenes.map((scene) => {
        const edited = scenes.find(({ id }) => id === scene.id);
        return edited ? {
          ...scene,
          narration: edited.narration,
          overlayText: edited.overlay,
          visual: { ...scene.visual, kind: edited.provenance, uri: edited.asset, ...(edited.assetId ? { assetId: edited.assetId } : {}) },
        } : scene;
      }),
    };
    try {
      const next = await campaignRequest("/api/campaigns/current/storyboard-approval", "POST", { approved: true, storyboard: editedStoryboard });
      applySnapshot(next);
      await refreshHistory();
      setView("campaign");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Storyboard Approval failed");
    } finally {
      setBusy(false);
    }
  };
  const requestCorrection = async (request: { target: { scope: "campaign" } | { scope: "scene"; sceneId: string }; requestedChange: string; reason: string }) => {
    setError("");
    setBusy(true);
    try {
      applySnapshot(await campaignRequest("/api/campaigns/current/correction", "POST", request));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign correction request failed");
    } finally {
      setBusy(false);
    }
  };
  const authorizeCorrection = async () => {
    setError("");
    setBusy(true);
    try {
      applySnapshot(await campaignRequest("/api/campaigns/current/correction", "PUT"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign correction failed");
    } finally {
      setBusy(false);
    }
  };
  const retryBand = async () => {
    setBandRetrying(true);
    try {
      const response = await fetch("/api/campaigns/current/collaboration", { method: "POST" });
      if (!response.ok) throw new Error("Band retry request failed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Band retry request failed");
    } finally {
      setBandRetrying(false);
    }
  };
  const retryStage = async () => {
    setError("");
    setBusy(true);
    try {
      const next = await campaignRequest("/api/campaigns/current/retry", "POST");
      applySnapshot(next);
      if (next.status === "completed") {
        await refreshHistory();
        setView("campaign");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign retry failed");
      void campaignRequest("/api/campaigns/current", "GET").then(applySnapshot).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  const openHistoricalCampaign = async (campaignId: string) => {
    setError("");
    try {
      const campaign = await campaignRequest(`/api/campaigns/history/${encodeURIComponent(campaignId)}`, "GET");
      setHistoricalSnapshot(campaign);
      setHistoryOpen(false);
      setView("campaign");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Completed Campaign could not be opened");
    }
  };
  const deleteCampaign = async (campaignId: string, historical = true) => {
    if (!window.confirm(`Permanently delete Campaign ${campaignId} and all of its state, events, intermediate media, render files, and ZIP?`)) return;
    setError("");
    setBusy(true);
    try {
      const url = historical ? `/api/campaigns/history/${encodeURIComponent(campaignId)}` : "/api/campaigns/current";
      const response = await fetch(url, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmCampaignId: campaignId }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Campaign deletion failed");
      if (snapshot?.id === campaignId) applySnapshot(await campaignRequest("/api/campaigns/current", "GET"));
      if (historicalSnapshot?.id === campaignId) setHistoricalSnapshot(undefined);
      await refreshHistory();
      setView("configure");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign deletion failed");
    } finally {
      setBusy(false);
    }
  };
  const startAnother = () => {
    setHistoricalSnapshot(undefined);
    setProfileDraft(emptyProfileDraft);
    setView("configure");
  };
  const updateScene = (id: string, field: "narration" | "overlay", value: string) => {
    setScenes((current) => current.map((scene) => scene.id === id ? { ...scene, [field]: value } : scene));
  };
  const updateSceneAsset = (id: string, assetId: string) => {
    const asset = [...(snapshot?.sourceProfile?.assets ?? []), ...(snapshot?.uploadedAssets ?? [])].find((candidate) => candidate.id === assetId);
    const original = snapshot?.storyboard?.scenes.find((scene) => scene.id === id);
    setScenes((current) => current.map((scene) => scene.id !== id ? scene : asset
      ? { ...scene, assetId: asset.id, asset: asset.uri, visual: asset.name, provenance: asset.provenance }
      : original ? { ...scene, assetId: original.visual.assetId, asset: original.visual.uri, visual: original.visual.uri, provenance: original.visual.kind } : scene));
  };
  const updateProfile = (field: keyof SourceProfileApproval, value: string | string[]) => {
    setProfileDraft((current) => ({ ...current, [field]: value }));
  };
  const displayedSnapshot = historicalSnapshot ?? snapshot;
  const displayedScenes = historicalSnapshot ? storyboardScenes(historicalSnapshot) ?? scenes : scenes;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <StudioHeader view={view} mode={snapshot?.mode ?? "fixture"} judging={judging} onNavigate={navigate} onHistory={() => setHistoryOpen(true)} />
      {!judging && <HistoryDrawer open={historyOpen} campaigns={history} onClose={() => setHistoryOpen(false)} onOpenCampaign={openHistoricalCampaign} onDelete={(campaignId) => deleteCampaign(campaignId)} />}
      {!judging && <CampaignFailurePanel snapshot={snapshot} busy={busy} onRetry={retryStage} onDelete={() => snapshot && deleteCampaign(snapshot.id, false)} />}
      {view === "configure" && (
        <ConfigureView
          campaignType={campaignType}
          durationSeconds={durationSeconds}
          audience={audience}
          sourceWebsite={sourceWebsite}
          featureName={featureName}
          featureDescription={featureDescription}
          featurePageUrl={featurePageUrl}
          judgingPreset={judgingPreset}
          judgingPresetError={judgingPresetError}
          busy={busy}
          error={error}
          onCampaignTypeChange={setCampaignType}
          onDurationChange={setDurationSeconds}
          onAudienceChange={setAudience}
          onSourceWebsiteChange={setSourceWebsite}
          onFeatureNameChange={setFeatureName}
          onFeatureDescriptionChange={setFeatureDescription}
          onFeaturePageUrlChange={setFeaturePageUrl}
          onApplyJudgingPreset={applyJudgingPreset}
          onStart={startCampaign}
        />
      )}
      {view === "studio" && (
        <StudioView
          profileApproved={profileApproved}
          conceptApproved={conceptApproved}
          storyboardApproved={storyboardApproved}
          concepts={conceptsFromSnapshot(snapshot)}
          snapshot={snapshot}
          events={events}
          bandRoomUrl={bandRoomUrl}
          bandRetrying={bandRetrying}
          busy={busy}
          selectedConcept={selectedConcept}
          scenes={scenes}
          profileDraft={profileDraft}
          onProfileChange={updateProfile}
          onProfileApprove={approveSourceProfile}
          onUpload={uploadAsset}
          onSelectConcept={setSelectedConcept}
          onConceptApprove={approveConcept}
          onSceneChange={updateScene}
          onSceneAssetChange={updateSceneAsset}
          onStoryboardApprove={approveStoryboard}
          onBandRetry={retryBand}
        />
      )}
      {view === "campaign" && <CampaignView
        snapshot={displayedSnapshot}
        scenes={displayedScenes}
        packageHref={historicalSnapshot ? `/api/campaigns/history/${encodeURIComponent(historicalSnapshot.id)}/package` : "/api/campaigns/current/package"}
        historical={Boolean(historicalSnapshot)}
        busy={busy}
        events={events}
        bandRoomUrl={bandRoomUrl}
        judging={judging}
        onStartAnother={startAnother}
        onDelete={() => displayedSnapshot && deleteCampaign(displayedSnapshot.id, Boolean(historicalSnapshot))}
        onRequestCorrection={requestCorrection}
        onAuthorizeCorrection={authorizeCorrection}
      />}
      {view !== "configure" && error && <div className="studio-sync-error" role="alert"><strong>Local sync needs attention</strong><span>{error}</span></div>}
      <footer className="global-footer">
        <span>LaunchReel / editorial production system</span>
        <span><i className="status-light" /> {snapshot?.mode ?? "fixture"} provenance is always visible</span>
        <span>{snapshot?.id ?? campaignFixture.id} · local prototype</span>
      </footer>
    </div>
  );
}
