# LaunchReel

**An AI creative company for SaaS launch video.**

Give LaunchReel a product website and a target audience. Specialist Agents ingest the source, research the market, choose the concept, render the film, review the cut, and deliver a proven Campaign package.

Not a chatbot. Not a black box. A visible studio with human approval gates, citations, and provenance.

## Demo

Watch the full product walkthrough:

[LaunchReel demo video](https://drive.google.com/file/d/1glMCnJk_5XBviBn6COi-o-0-cVrSgh-A/view?usp=sharing)

## Output

A reviewable go-to-market Campaign:

- Vertical short-form video — **1080×1920**, **30 FPS**
- Synchronized captions, CTA, and production motion
- Critic-validated package with citations and provenance
- Operator-controlled approvals at source profile, concept, and storyboard

## The company desk

The production line every Campaign runs through:

| Desk | Stage | Role |
| --- | --- | --- |
| **Source** | Ingest | Read the Source Website and lock first-party product truth |
| **Analyst** | Research | Research the market and retain cited evidence |
| **Director** | Concept | Choose the concept and creative plan |
| **Producer** | Render | Produce narration, captions, motion, and the vertical cut |
| **Critic** | Review | Enforce objective quality before anything ships |
| **Package** | Deliver | Deliver the complete Campaign with provenance |

Human approvals gate the consequential cuts. Evidence stays separate from Source Website facts.

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

Next.js · React · Remotion · Zod · You.com · Deepgram · Band · Token Router
