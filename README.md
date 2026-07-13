# LaunchReel

**An AI creative company for SaaS launch video.**

Give LaunchReel a product website and a target audience. Four specialist Agents research the market, choose the idea, produce a vertical Campaign film, and prove every claim before anything ships.

Not a chatbot. Not a black box. A visible studio with human approval gates, citations, and provenance.

## Output

A reviewable go-to-market Campaign:

- Vertical short-form video — **1080×1920**, **30 FPS**
- Synchronized captions, CTA, and production motion
- Critic-validated package with citations and provenance
- Operator-controlled approvals at source profile, concept, and storyboard

## The company desk

| Agent | Role |
| --- | --- |
| **Brand & Market** | Find product truth and audience signal |
| **Creative Director** | Choose the concept and creative plan |
| **Video Producer** | Turn an approved storyboard into the cut |
| **Creative Critic** | Enforce objective quality before packaging |

Evidence in. Campaign out.

## Surfaces

| Route | Purpose |
| --- | --- |
| `/` | Product landing |
| `/studio` | Configure, approve, and produce a Campaign |
| `/demo` | Present a live or disclosed Campaign with proof |
| `/judging` | Canonical reviewing path for evaluation |

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter the studio.

Optional demo preset (fills Configure only; does not start production):

```bash
export LAUNCHREEL_DEMO_SOURCE_URL="https://your-product.com"
export LAUNCHREEL_DEMO_FEATURE_URL="https://your-product.com/features/your-feature"
```

Then apply the judging preset in `/studio` or `/judging`.

## Fixture proof

To render the deterministic local Campaign without paid providers:

```bash
npm run render:verify
```

This produces a verified Pulseboard fixture MP4 under `output/`.

## Stack

Next.js · React · Remotion · Zod · opt-in live providers for research, speech, and collaboration
