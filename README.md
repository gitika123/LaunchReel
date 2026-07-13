# LaunchReel

LaunchReel is an AI creative studio for SaaS go-to-market video. Point it at a product website and a target audience; four specialist Agents research the market, choose a creative direction, produce a vertical launch film, and validate the result before packaging.

The output is a reviewable Campaign: a 1080×1920, 30 FPS short-form video with captions, CTA, citations, critic checks, and provenance—not a one-shot chatbot montage.

## What you get

- **Production Studio** (`/studio`) — configure a Campaign, approve the source profile / concept / storyboard, and follow agents through to a downloadable package
- **Demo Launchpad** (`/demo`) — present a live or disclosed fixture Campaign with production proof
- **Judging surface** (`/judging`) — apply the canonical demo preset and walk the review path
- **Local Remotion render** — deterministic vertical video from an approved storyboard manifest

## The company desk

| Agent | Role | Artifact |
| --- | --- | --- |
| Brand & Market | Research product truth and audience | Brand / market brief |
| Creative Director | Choose concept and creative plan | Creative plan |
| Video Producer | Produce the cut from approved storyboard | Rendered Campaign video |
| Creative Critic | Enforce objective quality gates | Critic report + package |

Human approval gates stay explicit. LaunchReel does not silently invent claims, skip review, or hide where assets came from.

## Quick start

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then enter the studio at `/studio`.

Useful companion commands:

```bash
npm run studio          # Remotion Studio for the composition
npm run render:verify   # Render + verify the 30s fixture Campaign
npm run typecheck
npm run lint
```

## Campaign configuration

Create a Campaign from a public product URL, audience, duration, creative direction, and CTA. For Feature Announcement Campaigns, also provide a public feature page.

Optional demo preset (fills Configure; does not start production):

```bash
export LAUNCHREEL_DEMO_SOURCE_URL="https://example.com"
export LAUNCHREEL_DEMO_FEATURE_URL="https://example.com/features/example"
```

Then use **Apply judging preset** in the studio, or call `/api/judging-preset`.

Runtime tips:

| Variable | Purpose |
| --- | --- |
| `LAUNCHREEL_MODE` | `fixture` or live-configured runtime |
| `LAUNCHREEL_DATA_DIR` | Optional persistence root for Campaign data |
| `LAUNCHREEL_ENABLE_FIXTURE_DEMO` | Set to `true` to allow loading a disclosed fixture Campaign on `/demo` |

Live provider calls are opt-in and never implied by fixture rehearsal.

## Fixture render

The checked-in Pulseboard fixture proves the video seam without calling paid providers:

```bash
npm run render:verify
```

This generates fixture narration, renders `output/product-launch-fixture.mp4`, and writes validated metadata beside it. For the 60-second Feature Announcement fixture:

```bash
npm run validate:fixture-60
npm run render:fixture-60
npm run verify:fixture-60
```

Fixture assets live under `public/fixtures/`. Rendering uses Remotion’s managed media pipeline (no separately installed system `ffmpeg` required for the standard path).

## Rehearsal and QA

Drive a full fixture Campaign through HTTP approval boundaries:

```bash
npm run dev
npm run rehearse:fixture -- -- --server-url http://localhost:3000
```

Live rehearsal requires an explicit paid-call flag and Campaign config:

```bash
npm run rehearse:live -- -- --allow-paid-calls --config path/to/campaign.json --server-url http://localhost:3000
```

Package / media QA against a Campaign archive:

```bash
npm run qa:campaign -- -- --archive path/to/campaign.zip --snapshot path/to/campaign-snapshot.json
```

Optional Band collaboration verification (config-only by default; live network only with `--live`):

```bash
npm run verify:band-wave1
```

## Project layout

```text
app/           Next.js routes, pages, and API
components/    Studio, demo, landing, and proof UI
src/           Campaign runtime, agents, providers, Remotion composition
public/fixtures/  Deterministic fixture manifests and media
scripts/       Render, rehearsal, preflight, and QA CLIs
lib/           Shared fixture presentation helpers
```

## Stack

Next.js, React, Remotion, Zod, and optional provider integrations (research, speech, collaboration) behind explicit live mode.

## License

Private project for LaunchReel.
