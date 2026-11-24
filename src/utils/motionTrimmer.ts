// src/utils/motionTrimmer.ts
import {
    buildLoopedLandmarkData,
    findBestLoopEndFrameInSolver,
    findLoopCandidatesInSolver,
} from '../solvers/loopSolver';
import { LandmarkData, LandmarkFrame } from '../types/types';

export interface LoopCandidate {
  startFrame: number;
  endFrame: number;
  duration: number;
  score: number;
  distance: number;
}

export interface LoopRegionConfig {
  startFrame: number;
  endFrame: number;
  blendDuration: number;
  inPlace: boolean;
}

export function findLoopCandidates(
  landmarkData: LandmarkData,
  minGapFrames = 24,
  maxCandidates = 4
): LoopCandidate[] {
  return findLoopCandidatesInSolver(landmarkData, minGapFrames, maxCandidates);
}

export function findBestLoopEndFrame(
  landmarkData: LandmarkData,
  startFrameIndex = 0,
  minGapFrames = 24
): { bestFrameIndex: number; bestTime: number; minDistance: number } {
  return findBestLoopEndFrameInSolver(landmarkData, startFrameIndex, minGapFrames);
}

export function applyLoopSegmentToLandmarkData(
  landmarkData: LandmarkData,
  startFrameIndex: number,
  endFrameIndex: number,
  blendDuration: number,
  inPlace = true
): LandmarkData {
  return buildLoopedLandmarkData(
    landmarkData,
    startFrameIndex,
    endFrameIndex,
    blendDuration,
    inPlace
  );
}

export function trimLandmarkData(
  landmarkData: LandmarkData,
  startFrameIndex: number,
  endFrameIndex: number
): LandmarkData {
  const rawTotal = landmarkData.frames.length;
  const safeStart = Math.max(0, Math.min(startFrameIndex, rawTotal - 1));
  const safeEnd = Math.max(safeStart, Math.min(endFrameIndex, rawTotal - 1));

  const slicedFrames = landmarkData.frames.slice(safeStart, safeEnd + 1);
  const fps = landmarkData.fps || 30;

  const normalizedFrames: LandmarkFrame[] = slicedFrames.map((f, idx) => ({
    ...f,
    time: idx / fps,
    previewTime: f.previewTime ?? f.time,
  }));

  const totalFrames = normalizedFrames.length;
  const duration = totalFrames > 0 ? normalizedFrames[totalFrames - 1].time : 0;

  const existingLoopStart = landmarkData.loopStartFrame ?? 0;
  const keepLoopMetadata =
    !!landmarkData.loopMode &&
    safeEnd === rawTotal - 1 &&
    safeStart <= existingLoopStart;

  if (keepLoopMetadata) {
    return {
      ...landmarkData,
      totalFrames,
      duration,
      frames: normalizedFrames,
      loopStartFrame: existingLoopStart - safeStart,
    };
  }

  return {
    ...landmarkData,
    totalFrames,
    duration,
    frames: normalizedFrames,
    loopMode: undefined,
    loopStartFrame: undefined,
    loopBridgeFrames: 0,
    bridgeContinuation: undefined,
    bridgeLeadIn: undefined,
  };
}
