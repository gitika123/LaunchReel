# LaunchReel video render proof

This package implements the video seam of the fixture Product Launch Campaign as one local Remotion composition. It renders a deterministic 30-second, 1080×1920, 30 FPS H.264/AAC MP4 with fixture SaaS visuals, synthetic fixture narration, synchronized captions, motion graphics, and a CTA.

## Commands

```bash
npm install
npm run check
npm run render:verify
```

`npm run render:verify` generates the fixture narration, renders `output/product-launch-fixture.mp4`, and writes validated metadata to `output/product-launch-fixture.metadata.json`. `npm run studio` opens the same composition in Remotion Studio.

For the deterministic 60-second Feature Announcement fixture, run `npm run validate:fixture-60` for manifest-only checks, `npm run render:fixture-60` for the local 1,800-frame render, then `npm run verify:fixture-60` for MP4 metadata verification. The render and generated metadata stay in ignored `output/` storage; generated 60-second fixture audio is also ignored. None of these commands calls a provider.

## Canonical judging preset

The Configure view can apply the runtime-validated canonical demo preset from `src/judging-preset.ts`. The checked-in example contains only environment-variable references—never private URL values:

```text
LAUNCHREEL_DEMO_SOURCE_URL=<public source website URL>
LAUNCHREEL_DEMO_FEATURE_URL=<public feature-page URL>
```

Both values are required by the included Feature Announcement preset. `/api/judging-preset` reports missing or invalid configuration and returns only preset metadata plus these two URL values for their intended editable form inputs. It never exposes other environment values. Applying the preset fills the Configure form for operator review; it does not start a Campaign.

For judging, configure one public, judge-accessible SaaS product page and one public feature-announcement page for that same product. Treat those two environment values as the canonical pair for the entire presentation, verify them before opening the room, and do not commit private or provisional URLs. The repository does not invent a canonical public URL.

The read-only Demo Launchpad can expose a retained fixture fallback only when explicitly enabled server-side:

```text
LAUNCHREEL_ENABLE_FIXTURE_DEMO=false
```

The default is disabled. With any value other than the exact string `true`, no fixture control is rendered and `?mode=fixture` cannot select fixture persistence. With `LAUNCHREEL_ENABLE_FIXTURE_DEMO=true`, `/demo` remains on the configured runtime until the operator explicitly chooses **Load disclosed fixture Campaign**. Only `/demo?mode=fixture` reads the latest completed Campaign from the isolated `fixture` repository; it never reads an active fixture, mutates either repository, calls a provider, or silently falls back to invented data. The fixture page keeps `Fixture — not live` fixed on screen and links back to `/demo`, which restores the configured runtime.

To prepare retained fixture evidence without provider calls while the configured live app remains on port 3000, use this exact safe procedure from the same repository and with the same `LAUNCHREEL_DATA_DIR` value, if one is configured:

1. In a separate PowerShell terminal, start an isolated fixture-mode app on port 3001:
   ```powershell
   $env:LAUNCHREEL_MODE="fixture"; $env:LAUNCHREEL_ENABLE_FIXTURE_DEMO="false"; npm run dev -- --port 3001
   ```
2. In another terminal, run the local fixture workflow against that fixture-only process:
   ```powershell
   npm run rehearse:fixture -- -- --server-url http://localhost:3001
   ```
3. Stop the port-3001 process. In the live app, open `/demo`, explicitly choose **Load disclosed fixture Campaign**, and verify the permanent disclosure before presenting.
4. Choose **Return to configured live mode** to navigate back to `/demo`.

The fixture repository is rooted separately from `live`, fixture runtime collaboration is disabled, and fixture cleanup is not allowed to remove live Campaign assets. The retained record may contain fixture manifests and artifact-name inventory, but this procedure creates no rendered video and no downloadable Campaign package. If no completed fixture record exists, `/demo?mode=fixture` shows the exact rehearsal command and claims neither output.

System `ffmpeg` and `ffprobe` are not prerequisites. Rendering uses Remotion CLI's managed media pipeline. Verification uses `getVideoMetadata` from `@remotion/renderer`, which invokes Remotion's managed `ffprobe` binary and asserts the MP4 header, minimum file size, dimensions, duration, frame rate, H.264 codec, AAC audio, and 4:2:0 pixel format (`yuv420p` or the JPEG-range `yuvj420p` reported by Remotion's probe). There is no alternate compositor.

## Manifest integration seam

`FixtureRenderManifest` is inferred from the runtime Zod schema in `src/video/manifest.ts`. The compact contract contains:

- schema/campaign identity and an explicit `fixture` mode;
- fixed output settings (`1080×1920`, 30 FPS, 30 seconds);
- brand identity, palette, Target Audience, and fixture asset provenance;
- required narration audio path and fixture voice provenance;
- frame-synchronized caption cues;
- 4–8 contiguous scenes whose durations must total exactly 900 frames;
- one CTA label and valid URL.

The orchestrator can hand the Video Producer's approved storyboard across this seam by mapping it to this manifest and calling the same Remotion composition. Invalid timelines, captions, dimensions, missing fields, and non-fixture provenance are rejected before rendering. Future live/cached manifest variants should be added as explicit discriminated schemas rather than weakening this fixture contract.

Fixture media lives under `public/fixtures`. `scripts/generate-fixture-audio.ts` deterministically creates a 30-second WAV from each scene's approved narration using the local `sam-js` fixture voice. Production narration can replace `narration.audioPath` after satisfying the same manifest timing and provenance boundary.

## Campaign rehearsal and QA

Start the app separately, then drive a fixture Campaign through its HTTP approval boundaries without paid provider calls:

```bash
npm run dev
npm run rehearse:fixture -- -- --server-url http://localhost:3000
```

The second `--` shown after each npm script keeps option flags intact with npm 11. The runner uses a built-in fixture configuration or accepts `--config path/to/campaign.json`, `--concept-id`, `--direction`, and `--storyboard-edits path/to/edits.json`. Storyboard edits use `{ "scenes": { "scene-id": { "narration": "...", "overlayText": "..." } } }`. Use `--archive path/to/campaign.zip` when a fixture API does not expose a physical package.

Live mode is opt-in twice: the live npm script does not authorize provider use, and the CLI refuses to start until the explicit paid-call flag and Campaign configuration are supplied:

```bash
npm run rehearse:live -- -- --allow-paid-calls --config path/to/campaign.json --server-url http://localhost:3000
```

The app must also have been started in live mode. The runner verifies the returned Campaign mode before crossing an approval boundary. Normal tests never invoke live mode.

## Opt-in Band Wave 1 verification

The isolated verifier defaults to a config-only check. It reports only the expected variable names and whether each is present, prints no values, and makes zero network calls:

```bash
npm run verify:band-wave1
```

Live requests require the explicit flag below. Do not use it casually:

```bash
npm run verify:band-wave1 -- --live
```

Live mode requires `BAND_CHAT_ID`, `BAND_ANALYST_AGENT_ID`, `BAND_ANALYST_AGENT_API_KEY`, `BAND_DIRECTOR_AGENT_ID`, and `BAND_DIRECTOR_AGENT_API_KEY`; `BAND_REST_URL` is optional and defaults to `https://app.band.ai`. It uses the documented Agent API and beta Chat Tasks API in one deterministic namespace, recovers matching work before creating anything, and sends at most one rich Analyst-to-Director handoff. Only after Band exposes that original message to the Director does the verifier complete the processing lifecycle and send or recover one explicit Director-to-Analyst message labeled `LaunchReel orchestration receipt`; both message receipt IDs are captured. It archives rather than deletes its task and never deletes room history. Every request has a timeout and the run has a fixed request budget. Redacted JSON and Markdown reports are written under ignored `output/band-wave1-verification/` with endpoint paths, HTTP outcomes, timestamps, and nonsecret returned IDs only.

Run package/media QA independently using Remotion's installed managed `ffmpeg` and `ffprobe` binaries:

```bash
npm run qa:campaign -- -- --archive path/to/campaign.zip --snapshot path/to/campaign-snapshot.json
```

JSON reports, Markdown summaries, extracted opening/scene-midpoint/final-CTA frames, and contact sheets are written under ignored `output/campaign-qa/`. Without `--snapshot`, ZIP inventory, codecs, audio presence, coarse frame checks, and package provenance still run, while scene-specific narration/caption checks are explicitly reported as skipped.
