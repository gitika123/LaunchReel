import type {CSSProperties, ReactNode} from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {FixtureRenderManifest} from './manifest';
import {parseFixtureRenderManifest} from './manifest';

const font = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const Background = ({accent}: {accent: string}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#090817', overflow: 'hidden'}}>
      <div style={{position: 'absolute', inset: -280, background: `radial-gradient(circle at ${30 + Math.sin(frame / 70) * 8}% ${25 + Math.cos(frame / 90) * 7}%, ${accent}35, transparent 34%), radial-gradient(circle at 80% 76%, #7557ff28, transparent 38%)`}} />
      <div style={{position: 'absolute', inset: 0, opacity: 0.12, backgroundImage: 'linear-gradient(#ffffff18 1px, transparent 1px), linear-gradient(90deg, #ffffff18 1px, transparent 1px)', backgroundSize: '72px 72px', transform: `translateY(${frame % 72}px)`}} />
      <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 60%, #090817 92%)'}} />
    </AbsoluteFill>
  );
};

const BrandHeader = ({manifest}: {manifest: FixtureRenderManifest}) => (
  <div style={{position: 'absolute', top: 74, left: 72, right: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 20}}>
    <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
      <Img src={staticFile(manifest.assets.find(({kind}) => kind === 'logo')?.path ?? 'fixtures/pulseboard-logo.svg')} style={{width: 54, height: 54}} />
      <span style={{fontFamily: font, color: '#f8f7ff', fontSize: 29, fontWeight: 750, letterSpacing: -1}}>{manifest.brand.product}</span>
    </div>
    <div style={{fontFamily: font, color: '#a7a2c7', fontSize: 17, letterSpacing: 3.2, fontWeight: 700}}>{manifest.mode.toUpperCase()} · {manifest.campaignType.replace('-', ' ').toUpperCase()}</div>
  </div>
);

const Copy = ({eyebrow, headline, body, accent, delay = 0}: {eyebrow: string; headline: string; body: string; accent: string; delay?: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({fps, frame: frame - delay, config: {damping: 18, stiffness: 110}});
  return (
    <div style={{transform: `translateY(${interpolate(enter, [0, 1], [70, 0])}px)`, opacity: enter}}>
      <div style={{fontFamily: font, color: accent, fontWeight: 800, fontSize: 22, letterSpacing: 5, marginBottom: 26}}>{eyebrow}</div>
      <div style={{fontFamily: font, color: '#f8f7ff', fontWeight: 820, fontSize: 92, lineHeight: 0.95, letterSpacing: -6, maxWidth: 900}}>{headline}</div>
      <div style={{fontFamily: font, color: '#b8b3d2', fontWeight: 480, fontSize: 34, lineHeight: 1.32, letterSpacing: -0.8, maxWidth: 820, marginTop: 34}}>{body}</div>
    </div>
  );
};

const SignalVisual = ({accent}: {accent: string}) => {
  const frame = useCurrentFrame();
  const labels = ['Support', 'Sales calls', 'Requests', 'Churn notes'];
  return (
    <div style={{position: 'relative', height: 560, marginTop: 76}}>
      {[0, 1, 2].map((ring) => <div key={ring} style={{position: 'absolute', width: 170 + ring * 150, height: 170 + ring * 150, borderRadius: '50%', border: `2px solid ${accent}${ring === 0 ? '80' : '35'}`, left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${1 + Math.sin((frame - ring * 9) / 18) * 0.025})`}} />)}
      <div style={{position: 'absolute', width: 116, height: 116, borderRadius: 34, background: accent, boxShadow: `0 0 80px ${accent}80`, left: '50%', top: '50%', transform: `translate(-50%, -50%) rotate(${frame * 0.5}deg)`, display: 'grid', placeItems: 'center'}}><div style={{width: 30, height: 30, background: '#090817', borderRadius: 9}} /></div>
      {labels.map((label, index) => {
        const angle = index * Math.PI / 2 + frame / 150;
        const x = Math.cos(angle) * 310;
        const y = Math.sin(angle) * 210;
        return <div key={label} style={{position: 'absolute', left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`, transform: 'translate(-50%, -50%)', padding: '18px 24px', borderRadius: 18, background: '#1b1938dd', border: '1px solid #4a466f', color: '#ddd9f2', fontFamily: font, fontSize: 20, fontWeight: 650, whiteSpace: 'nowrap'}}>{label}</div>;
      })}
    </div>
  );
};

const DashboardVisual = ({accent}: {accent: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({fps, frame: frame - 12, config: {damping: 17, mass: 0.8}});
  return (
    <div style={{height: 760, marginTop: 58, perspective: 1200, position: 'relative'}}>
      <div style={{position: 'absolute', inset: '80px 60px -20px', background: `${accent}55`, filter: 'blur(90px)', borderRadius: '50%'}} />
      <Img src={staticFile('fixtures/pulseboard-dashboard.svg')} style={{position: 'absolute', width: 730, left: 100, top: 0, borderRadius: 42, boxShadow: '0 45px 90px #0009', transform: `rotateX(7deg) rotateY(-5deg) translateY(${interpolate(enter, [0, 1], [140, 0])}px) scale(${interpolate(enter, [0, 1], [0.88, 1])})`}} />
      <div style={{position: 'absolute', right: 40, top: 152, padding: '24px 28px', borderRadius: 24, background: '#f8f7ff', color: '#15132d', fontFamily: font, fontWeight: 800, fontSize: 22, transform: `translateX(${interpolate(enter, [0, 1], [200, 0])}px)`}}>86 SIGNAL SCORE</div>
    </div>
  );
};

const CollaborationVisual = ({accent}: {accent: string}) => {
  const frame = useCurrentFrame();
  const cards = [
    ['SUPPORT', 'Analytics export is a must-have'],
    ['SALES', '38 accounts asked for team views'],
    ['RESEARCH', 'Collaboration friction surfaced'],
  ];
  return <div style={{marginTop: 76, display: 'grid', gap: 22}}>{cards.map(([source, text], index) => {
    const progress = interpolate(frame, [12 + index * 10, 34 + index * 10], [0, 1], clamp);
    return <div key={source} style={{display: 'flex', alignItems: 'center', gap: 24, background: '#17152fdd', border: '1px solid #3d395f', borderRadius: 30, padding: '30px 34px', opacity: progress, transform: `translateX(${interpolate(progress, [0, 1], [index % 2 ? 120 : -120, 0])}px)`}}><div style={{width: 74, height: 74, borderRadius: 24, flexShrink: 0, display: 'grid', placeItems: 'center', background: `${accent}22`, border: `2px solid ${accent}`, color: accent, fontFamily: font, fontSize: 18, fontWeight: 850}}>{index + 1}</div><div><div style={{color: accent, fontFamily: font, fontSize: 17, letterSpacing: 3, fontWeight: 800, marginBottom: 10}}>{source}</div><div style={{color: '#eeeafd', fontFamily: font, fontSize: 27, fontWeight: 650}}>{text}</div></div></div>;
  })}<div style={{height: 6, margin: '12px 70px 0', borderRadius: 3, background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, boxShadow: `0 0 26px ${accent}`}} /></div>;
};

const InsightVisual = ({accent}: {accent: string}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [8, 78], [0, 1], clamp);
  const points = [72, 66, 55, 48, 31, 18];
  return (
    <div style={{height: 550, marginTop: 70, padding: '54px 46px', background: '#16142ed9', border: '1px solid #413d66', borderRadius: 38, position: 'relative', overflow: 'hidden'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'end'}}><div><div style={{fontFamily: font, color: '#9994b9', fontSize: 18, letterSpacing: 3}}>REVENUE IMPACT</div><div style={{fontFamily: font, color: '#fff', fontSize: 62, fontWeight: 820, marginTop: 12}}>$420k</div></div><div style={{fontFamily: font, color: accent, fontSize: 24, fontWeight: 800}}>38 accounts</div></div>
      <svg viewBox="0 0 800 260" style={{position: 'absolute', left: 42, right: 42, bottom: 42, width: 820, overflow: 'visible'}}>
        <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor={accent} stopOpacity=".5"/><stop offset="1" stopColor={accent} stopOpacity="0"/></linearGradient></defs>
        <path d={`M 0 ${points[0]} ${points.map((point, index) => `L ${index * 150} ${point * 2.4}`).join(' ')} L 750 260 L 0 260 Z`} fill="url(#chart-fill)" opacity={progress} />
        <path d={`M 0 ${points[0]} ${points.map((point, index) => `L ${index * 150} ${point * 2.4}`).join(' ')}`} fill="none" stroke={accent} strokeWidth="9" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} />
      </svg>
    </div>
  );
};

const CtaVisual = ({manifest, accent}: {manifest: FixtureRenderManifest; accent: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({fps, frame: frame - 35, config: {damping: 12, stiffness: 130}});
  return <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 76}}><Img src={staticFile('fixtures/pulseboard-logo.svg')} style={{width: 250, height: 250, filter: `drop-shadow(0 0 55px ${accent}66)`, transform: `scale(${interpolate(pop, [0, 1], [0.5, 1])}) rotate(${interpolate(pop, [0, 1], [-20, 0])}deg)`}}/><div style={{marginTop: 54, padding: '30px 52px', borderRadius: 22, background: accent, boxShadow: `0 20px 70px ${accent}55`, color: '#090817', fontFamily: font, fontSize: 27, letterSpacing: 2.5, fontWeight: 900, transform: `scale(${pop})`}}>{manifest.cta.label} →</div><div style={{fontFamily: font, color: '#d9d5ee', marginTop: 28, fontSize: 24}}>pulseboard.example</div></div>;
};

const Visual = ({visual, accent, manifest}: {visual: FixtureRenderManifest['scenes'][number]['visual']; accent: string; manifest: FixtureRenderManifest}) => {
  const visuals: Record<typeof visual, ReactNode> = {
    signal: <SignalVisual accent={accent} />,
    workflow: <DashboardVisual accent={accent} />,
    collaboration: <CollaborationVisual accent={accent} />,
    insight: <InsightVisual accent={accent} />,
    cta: <CtaVisual manifest={manifest} accent={accent} />,
  };
  return visuals[visual];
};

const Scene = ({scene, manifest, index}: {scene: FixtureRenderManifest['scenes'][number]; manifest: FixtureRenderManifest; index: number}) => {
  const frame = useCurrentFrame();
  const fadeIn = index === 0 ? 1 : interpolate(frame, [0, 12], [0, 1], clamp);
  const fadeOut = index === manifest.scenes.length - 1 ? 1 : interpolate(frame, [scene.durationInFrames - 15, scene.durationInFrames], [1, 0], clamp);
  const style: CSSProperties = {padding: '230px 72px 260px', opacity: Math.min(fadeIn, fadeOut)};
  const asset = scene.assetId ? manifest.assets.find(({id}) => id === scene.assetId) : undefined;
  return <AbsoluteFill style={style}><Copy eyebrow={scene.eyebrow} headline={scene.headline} body={scene.body} accent={scene.accent} />{asset ? <Img src={staticFile(asset.path)} style={{maxWidth: 860, maxHeight: 700, alignSelf: 'center', marginTop: 70, objectFit: 'contain', borderRadius: 32}} /> : <Visual visual={scene.visual} accent={scene.accent} manifest={manifest} />}</AbsoluteFill>;
};

const Captions = ({manifest}: {manifest: FixtureRenderManifest}) => {
  const frame = useCurrentFrame();
  const caption = manifest.captions.find((cue) => frame >= cue.startFrame && frame < cue.endFrame);
  if (!caption) return null;
  const local = frame - caption.startFrame;
  const opacity = Math.min(interpolate(local, [0, 5], [0, 1], clamp), interpolate(frame, [caption.endFrame - 5, caption.endFrame], [1, 0], clamp));
  return <div style={{position: 'absolute', zIndex: 30, bottom: 114, left: 66, right: 66, display: 'flex', justifyContent: 'center', opacity}}><div style={{fontFamily: font, color: '#fff', background: '#090817e8', border: '1px solid #ffffff30', borderRadius: 24, padding: '20px 28px', fontWeight: 720, fontSize: 31, lineHeight: 1.25, textAlign: 'center', boxShadow: '0 16px 50px #0008'}}>{caption.text}</div></div>;
};

const Progress = ({manifest}: {manifest: FixtureRenderManifest}) => {
  const frame = useCurrentFrame();
  const width = interpolate(frame, [0, manifest.output.fps * manifest.output.durationSeconds - 1], [0, 100], clamp);
  return <div style={{position: 'absolute', zIndex: 40, left: 0, right: 0, bottom: 0, height: 8, background: '#ffffff18'}}><div style={{width: `${width}%`, height: '100%', background: `linear-gradient(90deg, ${manifest.brand.palette[0]}, ${manifest.brand.palette[1]})`}} /></div>;
};

export const ProductLaunch = (props: FixtureRenderManifest) => {
  const manifest = parseFixtureRenderManifest(props);
  const frame = useCurrentFrame();
  const activeScene = manifest.scenes.find((scene) => frame >= scene.startFrame && frame < scene.startFrame + scene.durationInFrames);
  if (!activeScene) throw new Error(`No scene covers frame ${frame}`);
  return (
    <AbsoluteFill>
      <Background accent={activeScene.accent} />
      <Audio src={staticFile(manifest.music.audioPath)} volume={0.12} />
      <Audio src={staticFile(manifest.narration.audioPath)} volume={0.88} />
      <BrandHeader manifest={manifest} />
      {manifest.scenes.map((scene, index) => <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames} premountFor={30}><Scene scene={scene} manifest={manifest} index={index} /></Sequence>)}
      <Captions manifest={manifest} />
      <Progress manifest={manifest} />
    </AbsoluteFill>
  );
};
