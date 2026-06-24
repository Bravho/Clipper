import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MontageAsset, MontageSceneInputProps, MontageTransition } from "./montageTypes";
import { allocateAssetFrames, buildKenBurnsTransform, clamp } from "./montageMotion";

const TRANSITION_DURATION_SECONDS = 0.3;

/**
 * Renders one montage scene from the client's real photos/clips: each asset
 * occupies a contiguous slice of the scene, stills get Ken Burns motion, clips
 * play their trimmed range, and (except for "cut") each asset after the first
 * eases in with a fade/slide/zoom entrance. Captions, voice, and music are NOT
 * here — they are added downstream at the FFmpeg compose step.
 */
export function MontageScene(props: MontageSceneInputProps) {
  const { assets, transition } = props;
  const { fps, durationInFrames } = useVideoConfig();

  if (assets.length === 0) {
    return <AbsoluteFill style={{ backgroundColor: "black" }} />;
  }

  const ranges = allocateAssetFrames(
    assets.map((a) => a.durationSeconds),
    durationInFrames
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {assets.map((asset, i) => {
        const range = ranges[i];
        return (
          <Sequence key={i} from={range.from} durationInFrames={range.durationInFrames}>
            <AssetLayer
              asset={asset}
              durationInFrames={range.durationInFrames}
              fps={fps}
              transition={i === 0 ? "cut" : transition}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function AssetLayer({
  asset,
  durationInFrames,
  fps,
  transition,
}: {
  asset: MontageAsset;
  durationInFrames: number;
  fps: number;
  transition: MontageTransition;
}) {
  const frame = useCurrentFrame();
  const progress = durationInFrames > 1 ? clamp(frame / (durationInFrames - 1), 0, 1) : 1;

  // Entrance easing (relative to this asset's own start).
  const entranceFrames = Math.max(1, Math.round(TRANSITION_DURATION_SECONDS * fps));
  const tp = transition === "cut" ? 1 : clamp(frame / entranceFrames, 0, 1);
  const opacity = transition === "fade" || transition === "slide" || transition === "zoom" ? tp : 1;

  let entranceTransform = "";
  if (transition === "slide") entranceTransform = `translateX(${(1 - tp) * 30}%)`;
  else if (transition === "zoom") entranceTransform = `scale(${1.06 - 0.06 * tp})`;

  const focusX = clamp(asset.focusX ?? 0.5, 0, 1) * 100;
  const focusY = clamp(asset.focusY ?? 0.5, 0, 1) * 100;

  const mediaStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: asset.kind === "image" ? buildKenBurnsTransform(asset.motion, progress) : undefined,
    transformOrigin: `${focusX}% ${focusY}%`,
  };

  return (
    <AbsoluteFill style={{ opacity, transform: entranceTransform || undefined, overflow: "hidden" }}>
      {asset.kind === "clip" ? (
        <OffthreadVideo
          src={asset.url}
          startFrom={Math.max(0, Math.round((asset.trimStartSeconds ?? 0) * fps))}
          endAt={
            asset.trimEndSeconds != null
              ? Math.round(asset.trimEndSeconds * fps)
              : undefined
          }
          muted
          style={mediaStyle}
        />
      ) : (
        <Img src={asset.url} style={mediaStyle} />
      )}
    </AbsoluteFill>
  );
}
