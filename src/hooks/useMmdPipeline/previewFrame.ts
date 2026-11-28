// src/hooks/useMmdPipeline/previewFrame.ts
import { LandmarkData } from '../../types/types';
import {
    evaluateExpressionTrackAtFrame,
    ExpressionTrack,
} from '../../utils/expressionTrackEvaluator';
import { offsetLandmarks } from '../../utils/rootPostProcess';

export interface PreviewFrameParams {
  data: LandmarkData;
  frameIdx: number;
  expressionTracks: ExpressionTrack[];
  rootOffsetMmd?: [number, number, number];
}

export interface PreviewFrameResult {
  time: number;
  landmarks: Record<string, [number, number, number]>;
  blendTarget?: { startTime: number; weight: number };
  expressionsOverride?: Record<string, number>;
}

export function evaluatePreviewFrame({
  data,
  frameIdx,
  expressionTracks,
  rootOffsetMmd,
}: PreviewFrameParams): PreviewFrameResult | null {
  const targetFrame = data.frames[frameIdx];
  if (!targetFrame) return null;

  const activeTracks = expressionTracks.filter((t) => t.keyframes.length > 0);
  let expressionsOverride: Record<string, number> | undefined;
  if (activeTracks.length > 0) {
    expressionsOverride = { ...(targetFrame.expressions || {}) };
    for (const tr of activeTracks) {
      expressionsOverride[tr.name] = evaluateExpressionTrackAtFrame(tr, frameIdx);
    }
  }

  const landmarks = rootOffsetMmd
    ? offsetLandmarks(targetFrame.landmarks, rootOffsetMmd[0], rootOffsetMmd[1], rootOffsetMmd[2])
    : targetFrame.landmarks;

  return {
    time: targetFrame.previewTime ?? targetFrame.time,
    landmarks,
    blendTarget: targetFrame.previewBlendTarget,
    expressionsOverride,
  };
}
