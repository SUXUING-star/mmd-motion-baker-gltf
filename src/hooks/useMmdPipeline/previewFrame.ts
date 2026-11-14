// src/hooks/useMmdPipeline/previewFrame.ts
import { LandmarkData } from '../../types/types';
import {
    evaluateExpressionTrackAtFrame,
    ExpressionTrack,
} from '../../utils/expressionTrackEvaluator';

export interface PreviewFrameParams {
  data: LandmarkData;
  frameIdx: number;
  expressionTracks: ExpressionTrack[];
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

  return {
    time: targetFrame.previewTime ?? targetFrame.time,
    landmarks: targetFrame.landmarks,
    blendTarget: targetFrame.previewBlendTarget,
    expressionsOverride,
  };
}
