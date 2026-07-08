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
import {
  allocateAssetFrames,
  buildKenBurnsTransform,
  clamp,
  computeClipPlaybackRate,
} from "./montageMotion";

const TRANSITION_DURATION_SECONDS = 0.2;

/**
 * Renders one montage scene from the client's real photos/clips: each asset
 * occupies a contiguous slice of the scene, stills get Ken Burns motion, clips
 * play their trimmed range. Except for "cut", each asset after the first mounts
 * a short overlap EARLY — it sits on top of the previous asset's tail and fades
 * in over it, producing a true cross-dissolve (not a dip to black). Because the
 * overlap borrows from the adjacent slot rather than trimming, the scene's total
 * length is unchanged, so the voiceover stays in sync downstream. Captions,
 * voice, and music are added later at the FFmpeg compose step.
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
  const fadeFramesBase =
    transition === "cut" ? 0 : Math.max(1, Math.round(TRANSITION_DURATION_SECONDS * fps));

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {assets.map((asset, i) => {
        const range = ranges[i];
        const prev = ranges[i - 1];
        // Don't dissolve longer than half of either neighbouring shot.
        const maxFade = prev
          ? Math.floor(Math.min(range.durationInFrames, prev.durationInFrames) / 2)
          : 0;
        const fadeInFrames = i === 0 ? 0 : clamp(fadeFramesBase, 0, Math.max(0, maxFade));
        // Mount `fadeInFrames` early to overlap the previous asset's tail; keep
        // the same end frame so the contiguous timeline (and total) is preserved.
        const from = Math.max(0, range.from - fadeInFrames);
        const seqDuration = range.from + range.durationInFrames - from;
        return (
          <Sequence key={i} from={from} durationInFrames={seqDuration}>
            <AssetLayer
              asset={asset}
              durationInFrames={seqDuration}
              fadeInFrames={fadeInFrames}
              transition={transition}
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
  fadeInFrames,
  transition,
}: {
  asset: MontageAsset;
  durationInFrames: number;
  fadeInFrames: number;
  transition: MontageTransition;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = durationInFrames > 1 ? clamp(frame / (durationInFrames - 1), 0, 1) : 1;

  // Cross-dissolve in over the overlap window with the previous asset.
  const fadeIn = fadeInFrames > 0 ? clamp(frame / fadeInFrames, 0, 1) : 1;
  const opacity = fadeIn;

  // Optional slide/zoom flourish layered on top of the dissolve.
  let entranceTransform = "";
  if (transition === "slide") entranceTransform = `translateX(${(1 - fadeIn) * 12}%)`;
  else if (transition === "zoom") entranceTransform = `scale(${1.04 - 0.04 * fadeIn})`;

  const focusX = clamp(asset.focusX ?? 0.5, 0, 1) * 100;
  const focusY = clamp(asset.focusY ?? 0.5, 0, 1) * 100;

  const mediaStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: asset.kind === "image" ? buildKenBurnsTransform(asset.motion, progress) : undefined,
    transformOrigin: `${focusX}% ${focusY}%`,
  };

  // When a clip's scene slot is longer than its selected footage, slow the clip
  // down (playbackRate < 1) so it fills the slot instead of playing out and then
  // holding a frozen last frame. Only possible when the footage window is known
  // (a trimmed clip); otherwise it plays at normal speed and any shortfall is
  // covered by the cross-dissolve / the compose step's black tail.
  const clipFootageSeconds =
    asset.kind === "clip" &&
    asset.trimEndSeconds != null &&
    asset.trimEndSeconds > (asset.trimStartSeconds ?? 0)
      ? asset.trimEndSeconds - (asset.trimStartSeconds ?? 0)
      : 0;
  const clipPlaybackRate = computeClipPlaybackRate(
    clipFootageSeconds,
    durationInFrames / fps
  );

  // Once the (possibly slowed) clip has played all its footage, there is nothing
  // left to show. Rather than freezing the last frame, render NOTHING so the
  // scene's black background shows through — a black scene, over which the voice
  // and music (muxed later at compose) keep playing. `coveredFrames` is how many
  // timeline frames the footage fills at the current playback rate.
  const clipExhausted =
    clipFootageSeconds > 0 &&
    frame >= (clipFootageSeconds * fps) / clipPlaybackRate;

  return (
    <AbsoluteFill style={{ opacity, transform: entranceTransform || undefined, overflow: "hidden" }}>
      {asset.kind === "clip" ? (
        clipExhausted ? null : (
          <OffthreadVideo
            src={asset.url}
            startFrom={Math.max(0, Math.round((asset.trimStartSeconds ?? 0) * fps))}
            endAt={
              asset.trimEndSeconds != null
                ? Math.round(asset.trimEndSeconds * fps)
                : undefined
            }
            playbackRate={clipPlaybackRate}
            muted
            style={mediaStyle}
          />
        )
      ) : (
        <Img src={asset.url} style={mediaStyle} />
      )}
    </AbsoluteFill>
  );
}
