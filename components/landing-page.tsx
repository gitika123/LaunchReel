import React from "react";
import Link from "next/link";

const agents = [
  { code: "A01", name: "Brand & Market", verb: "Find the truth", artifact: "BrandMarketBrief", accent: "blue" },
  { code: "A02", name: "Creative Director", verb: "Choose the idea", artifact: "CreativePlan", accent: "coral" },
  { code: "A03", name: "Video Producer", verb: "Make the cut", artifact: "RenderedCampaign", accent: "amber" },
  { code: "A04", name: "Creative Critic", verb: "Prove it works", artifact: "CampaignPackage", accent: "green" },
];

const proofFrames = [
  { time: "00:00", label: "SOURCE", copy: "Your product truth", mode: "source" },
  { time: "00:06", label: "EVIDENCE", copy: "A reason to care", mode: "research" },
  { time: "00:18", label: "PRODUCTION", copy: "Four desks, one cut", mode: "agents" },
  { time: "00:30", label: "CAMPAIGN", copy: "Ready to launch", mode: "campaign" },
];

export function LandingPage() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Primary navigation">
        <Link className="landing-wordmark" href="/" aria-label="LaunchReel home">
          Launch<span>Reel</span>
        </Link>
        <div className="landing-nav-center">
          <a href="#company">The company</a>
          <a href="#proof">How it works</a>
          <a href="#stack">Production stack</a>
        </div>
        <Link className="nav-launch" href="/studio">Enter the studio <span aria-hidden="true">↗</span></Link>
      </nav>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="hero-copy">
          <div className="live-kicker"><span /> AI creative company · on air</div>
          <h1 id="landing-title">Your next launch<br />deserves a <em>company.</em></h1>
          <p>Give LaunchReel a SaaS website and an audience. Four AI Agents research the market, pitch the idea, produce the film, and prove every claim before your Campaign leaves the studio.</p>
          <div className="hero-actions">
            <Link className="hero-primary" href="/studio">Build a Campaign <span aria-hidden="true">→</span></Link>
            <a className="hero-secondary" href="#proof">Watch the workflow</a>
          </div>
          <dl className="hero-specs">
            <div><dt>Output</dt><dd>1080 × 1920</dd></div>
            <div><dt>Runtime</dt><dd>30 seconds</dd></div>
            <div><dt>Control</dt><dd>2 human approvals</dd></div>
          </dl>
        </div>

        <div className="proof-reel" aria-label="LaunchReel Campaign proof reel">
          <div className="reel-hardware"><span>LR—PL/001</span><span>30 FPS</span><span>FIXTURE PROOF</span></div>
          <div className="reel-track" aria-hidden="true"><i /></div>
          <div className="reel-frames">
            {proofFrames.map((frame, index) => (
              <article className={`reel-frame reel-${frame.mode}`} key={frame.time}>
                <time>{frame.time}</time>
                <div className="frame-number">{String(index + 1).padStart(2, "0")}</div>
                <div className="frame-art">
                  {frame.mode === "source" && <><b>https://yourproduct.com</b><i /><i /><i /></>}
                  {frame.mode === "research" && <><span>“</span><b>Evidence changes the hook.</b><small>you.com · cited</small></>}
                  {frame.mode === "agents" && <div className="mini-agents">{agents.map((agent) => <i className={`mini-${agent.accent}`} key={agent.code}>{agent.code}</i>)}</div>}
                  {frame.mode === "campaign" && <><strong>LAUNCH<br /><em>REEL</em></strong><span>PLAY</span></>}
                </div>
                <div className="frame-caption"><span>{frame.label}</span><strong>{frame.copy}</strong></div>
              </article>
            ))}
          </div>
          <div className="reel-footer"><span>Evidence in</span><i /><span>Campaign out</span></div>
        </div>
      </section>

      <section className="truth-band" aria-label="LaunchReel principles">
        <span>Not a chatbot</span><i />
        <span>Not a black box</span><i />
        <span>Not a random montage</span><i />
        <strong>A visible creative company</strong>
      </section>

      <section className="company-section" id="company" aria-labelledby="company-title">
        <div className="landing-section-head">
          <p>Four role-isolated Agents</p>
          <h2 id="company-title">A real production<br />rundown, not <em>four avatars.</em></h2>
          <span>Every Agent owns a prompt, a model, a validated Campaign Artifact, and a visible Handoff.</span>
        </div>
        <div className="agent-marquee">
          {agents.map((agent, index) => (
            <article className={`landing-agent agent-accent-${agent.accent}`} key={agent.code}>
              <div className="agent-card-top"><span>{agent.code}</span><i /><small>{index === 0 ? "WORKING" : "STANDING BY"}</small></div>
              <p>{agent.verb}</p>
              <h3>{agent.name}</h3>
              <div className="agent-artifact"><span>Campaign Artifact</span><strong>{agent.artifact}</strong></div>
              <div className="agent-signal"><i /><span>Token Router</span><span>Band Handoff</span></div>
            </article>
          ))}
        </div>
      </section>

      <section className="workflow-section" id="proof" aria-labelledby="workflow-title">
        <div className="workflow-title-block">
          <p>From source to screen</p>
          <h2 id="workflow-title">The work stays visible.</h2>
          <span>Every consequential decision produces something you can inspect, edit, approve, or trace back to evidence.</span>
        </div>
        <ol className="workflow-list">
          <li><span>01</span><div><small>GROUND</small><h3>Read the product. Research the market.</h3><p>Source Website facts remain separate from cited audience and competitor evidence.</p></div><b>BrandMarketBrief</b></li>
          <li><span>02</span><div><small>DIRECT</small><h3>Put three real ideas on the table.</h3><p>Compare hooks, emotional directions, visual metaphors, and the evidence behind each choice.</p></div><b>Concept Approval</b></li>
          <li><span>03</span><div><small>PLAN</small><h3>Approve the film before production.</h3><p>Edit narration and overlays in a timed storyboard before media credits or rendering begin.</p></div><b>Storyboard Approval</b></li>
          <li><span>04</span><div><small>PRODUCE</small><h3>Render one coherent Campaign.</h3><p>Deepgram narration, synchronized captions, authentic product assets, and deterministic Remotion composition.</p></div><b>CampaignPackage.zip</b></li>
        </ol>
      </section>

      <section className="stack-section" id="stack" aria-labelledby="stack-title">
        <div>
          <p>Production stack</p>
          <h2 id="stack-title">Cloud intelligence.<br />Local control.</h2>
        </div>
        <div className="stack-map">
          <div className="stack-source"><span>INPUT</span><strong>Source Website</strong><small>First-party truth</small></div>
          <i className="stack-line" />
          <div className="stack-core">
            <span>LOCAL ORCHESTRATOR</span>
            <strong>LaunchReel</strong>
            <small>State · approvals · rendering · provenance</small>
          </div>
          <i className="stack-line" />
          <div className="stack-output"><span>DELIVERY</span><strong>Campaign ZIP</strong><small>Video + proof</small></div>
          <div className="stack-satellites">
            <span>You.com <small>research</small></span>
            <span>Band <small>collaboration</small></span>
            <span>Deepgram <small>voice</small></span>
            <span>Remotion <small>film</small></span>
          </div>
        </div>
      </section>

      <section className="landing-cta">
        <p>Production order LR—001</p>
        <h2>Bring the source.<br /><em>Leave with the Campaign.</em></h2>
        <Link href="/studio">Open LaunchReel Studio <span aria-hidden="true">↗</span></Link>
      </section>

      <footer className="landing-footer">
        <Link className="landing-wordmark" href="/">Launch<span>Reel</span></Link>
        <p>An autonomous creative company for SaaS launches.</p>
        <span>Local prototype · visible provenance · 2026</span>
      </footer>
    </main>
  );
}
