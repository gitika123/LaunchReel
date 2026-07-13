export type AgentState = "complete" | "waiting" | "approved";
export type ProvenanceMode = "fixture" | "source" | "uploaded" | "generated" | "cached";

export interface EvidenceItem {
  id: string;
  claim: string;
  source: string;
  mode: ProvenanceMode;
}

export interface Concept {
  id: string;
  title: string;
  thesis: string;
  hook: string;
  message: string;
  emotion: string;
  visualMetaphor: string;
  cta: string;
  evidenceIds: string[];
}

export interface StoryboardScene {
  id: string;
  start: number;
  duration: number;
  beat: string;
  narration: string;
  overlay: string;
  visual: string;
  asset: string;
  assetId?: string;
  provenance: ProvenanceMode;
}

export interface AgentToolCall {
  provider: string;
  operation: string;
  status: "complete" | "waiting" | "degraded" | "failed";
  detail: string;
  resultCount?: number;
  degradation?: string;
  searchId?: string;
  providerLatency?: number;
}

export interface AgentRun {
  id: string;
  agent: string;
  role: string;
  state: AgentState;
  timecode: string;
  artifact: string;
  handoff: string;
  model: string;
  prompt: string;
  toolCalls: AgentToolCall[];
}

export interface CampaignFixture {
  id: string;
  name: string;
  type: "Product Launch";
  targetAudience: string;
  duration: 30;
  format: string;
  sourceWebsite: string;
  mode: "fixture";
  brief: {
    product: string;
    promise: string;
    voice: string;
    requiredTruths: string[];
  };
  evidence: EvidenceItem[];
  concepts: Concept[];
  storyboard: StoryboardScene[];
  agents: AgentRun[];
  packageFiles: string[];
}

export const campaignFixture: CampaignFixture = {
  id: "LR-PL-001",
  name: "LaunchReel product launch",
  type: "Product Launch",
  targetAudience: "SaaS founders and marketers preparing a product launch without a full creative team",
  duration: 30,
  format: "1080 × 1920 · 30 FPS · TikTok / Reels",
  sourceWebsite: "launchreel.local",
  mode: "fixture",
  brief: {
    product: "LaunchReel",
    promise: "Turn a public SaaS product website into one evidence-backed promotional Campaign.",
    voice: "Exacting, creative, and transparent — never magical or vague.",
    requiredTruths: [
      "One Product Launch Campaign contains one vertical Promotional Video and supporting material.",
      "Concept Approval happens before storyboarding; Storyboard Approval happens before final media generation.",
      "Website facts, research, generated media, and cached assets retain visible provenance.",
    ],
  },
  evidence: [
    {
      id: "E-01",
      claim: "LaunchReel turns a public SaaS Source Website into one TikTok/Reels-ready Campaign.",
      source: "SPEC.md · Solution",
      mode: "source",
    },
    {
      id: "E-02",
      claim: "Four role-isolated Agents create and hand off validated Campaign Artifacts.",
      source: "SPEC.md · Solution",
      mode: "source",
    },
    {
      id: "E-03",
      claim: "Human Concept Approval and Storyboard Approval protect the two consequential production boundaries.",
      source: "SPEC.md · Implementation decisions",
      mode: "source",
    },
    {
      id: "E-04",
      claim: "The final Campaign packages video, thumbnail, caption, CTA variants, citations, critic report, and provenance.",
      source: "SPEC.md · User story 47",
      mode: "source",
    },
  ],
  concepts: [
    {
      id: "C-01",
      title: "The evidence cut",
      thesis: "A launch film should show its receipts.",
      hook: "What if your launch campaign could cite its sources?",
      message: "LaunchReel carries source truth through every creative decision.",
      emotion: "Assured, lucid, credible",
      visualMetaphor: "Claims move through a film editor’s proofing marks into finished frames.",
      cta: "Bring your source. Leave with the campaign.",
      evidenceIds: ["E-01", "E-03", "E-04"],
    },
    {
      id: "C-02",
      title: "Four chairs, one cut",
      thesis: "A complete creative company, arranged around one production table.",
      hook: "Your next launch team is already in session.",
      message: "Four specialized Agents hand validated work forward without collapsing into one generic assistant.",
      emotion: "Energetic, coordinated, exact",
      visualMetaphor: "A production rundown passes across four illuminated workstations.",
      cta: "Put your launch into production.",
      evidenceIds: ["E-02", "E-03"],
    },
    {
      id: "C-03",
      title: "From tab sprawl to premiere",
      thesis: "Replace a scattered toolchain with one visible production line.",
      hook: "A campaign shouldn’t take twelve tabs to become real.",
      message: "Research, direction, storyboarding, production, critique, and packaging stay in one Campaign.",
      emotion: "Relief, momentum, control",
      visualMetaphor: "Browser tabs compress into a vertical film strip and resolve as a finished Campaign package.",
      cta: "Launch the work, not the workflow.",
      evidenceIds: ["E-01", "E-04"],
    },
  ],
  storyboard: [
    {
      id: "S-01",
      start: 0,
      duration: 5,
      beat: "Cold open",
      narration: "Your product is ready. Your launch campaign is still scattered across a dozen tools.",
      overlay: "A launch should not need 12 tabs",
      visual: "Overlapping production tabs collapse into a single vertical frame.",
      asset: "Fixture browser-tab composition",
      provenance: "fixture",
    },
    {
      id: "S-02",
      start: 5,
      duration: 6,
      beat: "Source in",
      narration: "LaunchReel starts with your public SaaS website — the factual source for the work.",
      overlay: "Source Website → Evidence Basis",
      visual: "A source page enters the proofing desk; cited claims lock to the margin.",
      asset: "LaunchReel source-page fixture",
      provenance: "source",
    },
    {
      id: "S-03",
      start: 11,
      duration: 7,
      beat: "Company at work",
      narration: "Four role-isolated Agents research, direct, produce, and critique validated Campaign Artifacts.",
      overlay: "4 Agents · visible Handoffs",
      visual: "The production rundown advances through four distinct Agent desks.",
      asset: "Fixture Agent rundown",
      provenance: "fixture",
    },
    {
      id: "S-04",
      start: 18,
      duration: 6,
      beat: "Human boundary",
      narration: "You approve the concept and storyboard before costly production begins.",
      overlay: "Direction stays human",
      visual: "Two approval stamps interrupt the automated timeline at exact boundaries.",
      asset: "Fixture approval marks",
      provenance: "fixture",
    },
    {
      id: "S-05",
      start: 24,
      duration: 6,
      beat: "Campaign out",
      narration: "Then download one complete, provenance-rich Campaign, ready for TikTok and Reels.",
      overlay: "Bring your source. Leave with the Campaign.",
      visual: "The film strip folds into a labeled Campaign package.",
      asset: "Cached render preview from fixture workflow",
      provenance: "cached",
    },
  ],
  agents: [
    {
      id: "A-01",
      agent: "Brand and Market Analyst",
      role: "Evidence and positioning",
      state: "complete",
      timecode: "00:02",
      artifact: "BrandMarketBrief · v1",
      handoff: "Handed to Creative Director",
      model: "google/gemini-3.5-flash",
      prompt: "analyst.campaign.v2",
      toolCalls: [
        { provider: "Source Website", operation: "crawl", status: "complete", detail: "5 attributed pages" },
        { provider: "You.com", operation: "search", status: "complete", detail: "4 cited findings" },
        { provider: "Token Router", operation: "chat.completions", status: "complete", detail: "Artifact validated" },
        { provider: "Band", operation: "handoff", status: "complete", detail: "Director notified" },
      ],
    },
    {
      id: "A-02",
      agent: "Creative Director",
      role: "Concepts and storyboard",
      state: "waiting",
      timecode: "00:08",
      artifact: "CreativeConceptSet · v1",
      handoff: "Waiting for Concept Approval",
      model: "google/gemini-3.1-pro-preview",
      prompt: "director.concepts.v1",
      toolCalls: [
        { provider: "Token Router", operation: "chat.completions", status: "complete", detail: "3 concepts validated" },
        { provider: "Evidence Basis", operation: "claim check", status: "complete", detail: "8 references linked" },
        { provider: "Band", operation: "approval request", status: "waiting", detail: "Human boundary" },
      ],
    },
    {
      id: "A-03",
      agent: "Video Producer",
      role: "Media and composition",
      state: "waiting",
      timecode: "00:18",
      artifact: "RenderManifest · queued",
      handoff: "Waiting for Storyboard Approval",
      model: "google/gemini-3.5-flash",
      prompt: "producer.vertical-video.v1",
      toolCalls: [
        { provider: "Deepgram", operation: "speak", status: "waiting", detail: "Narration queued" },
        { provider: "Deepgram", operation: "listen", status: "waiting", detail: "Caption timing queued" },
        { provider: "Remotion", operation: "render", status: "waiting", detail: "900 frames" },
      ],
    },
    {
      id: "A-04",
      agent: "Creative Critic",
      role: "Quality gate and packaging",
      state: "waiting",
      timecode: "00:27",
      artifact: "CriticReport · queued",
      handoff: "Waiting for render artifact",
      model: "google/gemini-3.5-flash",
      prompt: "critic.campaign.v1",
      toolCalls: [
        { provider: "FFprobe", operation: "media verify", status: "waiting", detail: "Format + duration" },
        { provider: "Token Router", operation: "creative review", status: "waiting", detail: "5 advisory scores" },
        { provider: "Filesystem", operation: "package", status: "waiting", detail: "7 required artifacts" },
      ],
    },
  ],
  packageFiles: [
    "launchreel-campaign.mp4",
    "thumbnail.png",
    "caption.txt",
    "cta-variants.txt",
    "citations.json",
    "critic-report.json",
    "provenance.json",
  ],
};
