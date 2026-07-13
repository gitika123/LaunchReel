import {Composition} from 'remotion';
import manifestJson from '../public/fixtures/product-launch-manifest.json';
import {ProductLaunch} from './video/ProductLaunch';
import {parseFixtureRenderManifest} from './video/manifest';

const fixtureManifest = parseFixtureRenderManifest(manifestJson);

export const RemotionRoot = () => (
  <Composition
    id="LaunchReelProductLaunch"
    component={ProductLaunch}
    durationInFrames={fixtureManifest.output.fps * fixtureManifest.output.durationSeconds}
    fps={fixtureManifest.output.fps}
    width={fixtureManifest.output.width}
    height={fixtureManifest.output.height}
    defaultProps={fixtureManifest}
    calculateMetadata={({props}) => {
      const manifest = parseFixtureRenderManifest(props);
      return {
        durationInFrames: manifest.output.fps * manifest.output.durationSeconds,
        fps: manifest.output.fps,
        width: manifest.output.width,
        height: manifest.output.height,
        props: manifest,
      };
    }}
  />
);
