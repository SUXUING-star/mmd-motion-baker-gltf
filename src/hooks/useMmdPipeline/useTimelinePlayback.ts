// src/hooks/useMmdPipeline/useTimelinePlayback.ts
import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { CameraAnimationData } from '../../solvers/cameraSolver';
import { LandmarkData } from '../../types/types';
import { ExpressionTrack } from '../../utils/expressionTrackEvaluator';
import { findBestLoopEndFrame } from '../../utils/motionTrimmer';
import { evaluatePreviewFrame } from './previewFrame';
import type { PreviewMeshRefState } from './useMmdBaker';

export interface TimelineController {
  maxFrames: number;
  fps: number;
  currentFrame: number;
  startFrame: number;
  endFrame: number;
  isPlaying: boolean;
  togglePlay: () => void;
  seek: (frame: number) => void;
  setStart: (frame: number) => void;
  setEnd: (frame: number) => void;
  autoSnapLoopEnd: () => void;
}

export interface TimelineThreeBridge {
  setMmdTime: (
    time: number,
    landmarks?: Record<string, [number, number, number]>,
    blendTarget?: { startTime: number; weight: number },
    expressionsOverride?: Record<string, number>,
    rootOffsetMmd?: [number, number, number]
  ) => void;
  setRootOffset?: (
    offsetMmd: [number, number, number],
    offsetMeters: [number, number, number]
  ) => void;
  setCameraPose?: (
    pos: THREE.Vector3 | [number, number, number],
    quat: THREE.Quaternion | [number, number, number, number],
    fov?: number
  ) => void;
}

export function useTimelinePlayback(
  threeBridge: TimelineThreeBridge,
  expressionTracks: ExpressionTrack[],
  meshPreviewRef?: MutableRefObject<PreviewMeshRefState>
) {
  const [maxFrames, setMaxFrames] = useState<number>(0);
  const [fps, setFps] = useState<number>(30);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [startFrame, setStartFrame] = useState<number>(0);
  const [endFrame, setEndFrame] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const landmarkDataRef = useRef<LandmarkData | null>(null);
  const cameraDataRef = useRef<CameraAnimationData | null>(null);

  const timerRef = useRef<number | null>(null);
  const fpsRef = useRef<number>(30);
  const currentFrameRef = useRef<number>(0);
  const startFrameRef = useRef<number>(0);
  const endFrameRef = useRef<number>(0);
  const loopRestartFrameRef = useRef<number | null>(null);
  const isPlayingRef = useRef<boolean>(false);

  const threeBridgeRef = useRef(threeBridge);
  threeBridgeRef.current = threeBridge;

  const expressionTracksRef = useRef<ExpressionTrack[]>(expressionTracks);

  const getFrameOffsetMmdRef = useRef<(frameIdx: number) => [number, number, number]>(
    () => [0, 0, 0]
  );
  const getFrameOffsetMetersRef = useRef<(frameIdx: number) => [number, number, number]>(
    () => [0, 0, 0]
  );

  const stopPlayback = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    return () => stopPlayback();
  }, [stopPlayback]);

  const renderFrame = useCallback(
    (frameIdx: number) => {
      if (cameraDataRef.current && threeBridgeRef.current.setCameraPose) {
        const camFrame = cameraDataRef.current.frames[frameIdx];
        if (camFrame) {
          threeBridgeRef.current.setCameraPose(camFrame.position, camFrame.quaternion, camFrame.fov);
        }
      }

      const data = landmarkDataRef.current;
      if (!data) return;

      const offsetMmd = getFrameOffsetMmdRef.current(frameIdx);
      const offsetMeters = getFrameOffsetMetersRef.current(frameIdx);

      const result = evaluatePreviewFrame({
        data,
        frameIdx,
        expressionTracks: expressionTracksRef.current,
        rootOffsetMmd: offsetMmd,
      });
      if (!result) return;

      if (threeBridgeRef.current.setRootOffset) {
        threeBridgeRef.current.setRootOffset(offsetMmd, offsetMeters);
      } else if (meshPreviewRef?.current.hasClipAnimation && meshPreviewRef.current.mesh) {
        const mesh = meshPreviewRef.current.mesh;
        const base = meshPreviewRef.current.basePos;
        mesh.position.set(
          base.x + offsetMmd[0] * mesh.scale.x,
          base.y + offsetMmd[1] * mesh.scale.y,
          base.z + offsetMmd[2] * mesh.scale.z
        );
      }

      threeBridgeRef.current.setMmdTime(
        result.time,
        result.landmarks,
        result.blendTarget,
        result.expressionsOverride,
        offsetMmd
      );
    },
    [meshPreviewRef]
  );

  useEffect(() => {
    expressionTracksRef.current = expressionTracks;
    if (!isPlayingRef.current && (landmarkDataRef.current || cameraDataRef.current)) {
      renderFrame(currentFrameRef.current);
    }
  }, [expressionTracks, renderFrame]);

  const bindRootOffsetEvaluators = useCallback(
    (
      getMmd: (frameIdx: number) => [number, number, number],
      getMeters: (frameIdx: number) => [number, number, number]
    ) => {
      getFrameOffsetMmdRef.current = getMmd;
      getFrameOffsetMetersRef.current = getMeters;
      if (!isPlayingRef.current && landmarkDataRef.current) {
        renderFrame(currentFrameRef.current);
      }
    },
    [renderFrame]
  );

  const seekToFrame = useCallback(
    (frameIdx: number) => {
      const totalLen =
        landmarkDataRef.current?.frames.length ||
        cameraDataRef.current?.frames.length ||
        0;
      if (totalLen === 0) return;

      const safeIdx = Math.max(0, Math.min(frameIdx, totalLen - 1));
      currentFrameRef.current = safeIdx;
      setCurrentFrame(safeIdx);
      renderFrame(safeIdx);
    },
    [renderFrame]
  );

  const startPlayback = useCallback(
    (initialFrame?: number) => {
      const hasData = !!landmarkDataRef.current || !!cameraDataRef.current;
      if (!hasData || endFrameRef.current <= startFrameRef.current) return;

      stopPlayback();
      if (initialFrame !== undefined) {
        currentFrameRef.current = initialFrame;
        setCurrentFrame(initialFrame);
        renderFrame(initialFrame);
      }

      isPlayingRef.current = true;
      setIsPlaying(true);
      const intervalMs = Math.round(1000 / (fpsRef.current || 30));

      timerRef.current = window.setInterval(() => {
        const start = startFrameRef.current;
        const end = endFrameRef.current;
        const loopRestart = loopRestartFrameRef.current;
        const isBakedLoop = loopRestart !== null && loopRestart >= start && loopRestart < end;
        const restartTarget = isBakedLoop ? loopRestart : start;

        let next = currentFrameRef.current + 1;
        if (isBakedLoop ? next >= end : next > end) {
          next = restartTarget;
        } else if (next < start) {
          next = start;
        }
        currentFrameRef.current = next;
        setCurrentFrame(next);
        renderFrame(next);
      }, intervalMs);
    },
    [renderFrame, stopPlayback]
  );

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }, [stopPlayback, startPlayback]);

  const initAndPlay = useCallback(
    (landmarkData: LandmarkData) => {
      landmarkDataRef.current = landmarkData;
      cameraDataRef.current = null;

      const total = landmarkData.totalFrames;
      const defaultEnd = Math.max(0, total - 1);

      fpsRef.current = landmarkData.fps;
      startFrameRef.current = 0;
      endFrameRef.current = defaultEnd;
      loopRestartFrameRef.current = landmarkData.loopMode
        ? (landmarkData.loopStartFrame ?? 0)
        : null;

      setMaxFrames(total);
      setFps(landmarkData.fps);
      setStartFrame(0);
      setEndFrame(defaultEnd);

      startPlayback(0);
    },
    [startPlayback]
  );

  const updateTimelineData = useCallback(
    (landmarkData: LandmarkData) => {
      landmarkDataRef.current = landmarkData;
      cameraDataRef.current = null;

      const total = landmarkData.totalFrames;
      const defaultEnd = Math.max(0, total - 1);

      fpsRef.current = landmarkData.fps;
      startFrameRef.current = 0;
      endFrameRef.current = defaultEnd;

      setMaxFrames(total);
      setFps(landmarkData.fps);
      setStartFrame(0);
      setEndFrame(defaultEnd);
      loopRestartFrameRef.current = landmarkData.loopMode
        ? (landmarkData.loopStartFrame ?? 0)
        : null;

      if (currentFrameRef.current >= total) {
        currentFrameRef.current = 0;
        setCurrentFrame(0);
      }
      renderFrame(currentFrameRef.current);
    },
    [renderFrame]
  );

  const initAndPlayCamera = useCallback(
    (camData: CameraAnimationData) => {
      landmarkDataRef.current = null;
      cameraDataRef.current = camData;

      const total = camData.totalFrames;
      const defaultEnd = Math.max(0, total - 1);

      fpsRef.current = camData.fps;
      startFrameRef.current = 0;
      endFrameRef.current = defaultEnd;
      loopRestartFrameRef.current = null;

      setMaxFrames(total);
      setFps(camData.fps);
      setStartFrame(0);
      setEndFrame(defaultEnd);

      startPlayback(0);
    },
    [startPlayback]
  );

  const autoSnapLoopEnd = useCallback(() => {
    if (!landmarkDataRef.current) return;
    const { bestFrameIndex } = findBestLoopEndFrame(
      landmarkDataRef.current,
      startFrameRef.current,
      30
    );
    endFrameRef.current = bestFrameIndex;
    setEndFrame(bestFrameIndex);
    seekToFrame(bestFrameIndex);
  }, [seekToFrame]);

  const timeline: TimelineController = useMemo(
    () => ({
      maxFrames,
      fps,
      currentFrame,
      startFrame,
      endFrame,
      isPlaying,
      togglePlay,
      seek: (f: number) => {
        stopPlayback();
        seekToFrame(f);
      },
      setStart: (f: number) => {
        stopPlayback();
        startFrameRef.current = f;
        setStartFrame(f);
        seekToFrame(f);
      },
      setEnd: (f: number) => {
        stopPlayback();
        endFrameRef.current = f;
        setEndFrame(f);
        seekToFrame(f);
      },
      autoSnapLoopEnd,
    }),
    [
      maxFrames,
      fps,
      currentFrame,
      startFrame,
      endFrame,
      isPlaying,
      togglePlay,
      stopPlayback,
      seekToFrame,
      autoSnapLoopEnd,
    ]
  );

  const resetTimeline = useCallback(() => {
    stopPlayback();
    landmarkDataRef.current = null;
    cameraDataRef.current = null;
    fpsRef.current = 30;
    currentFrameRef.current = 0;
    startFrameRef.current = 0;
    endFrameRef.current = 0;
    loopRestartFrameRef.current = null;
    setMaxFrames(0);
    setFps(30);
    setCurrentFrame(0);
    setStartFrame(0);
    setEndFrame(0);
  }, [stopPlayback]);

  const updateTimelineDataPreserveRange = useCallback(
     (landmarkData: LandmarkData) => {
       const prevTotal = landmarkDataRef.current?.totalFrames || 0;
       const prevSpan = Math.max(1, prevTotal - 1);
       const nextTotal = landmarkData.totalFrames;
       const nextSpan = Math.max(1, nextTotal - 1);

       const scaleIdx = (idx: number) =>
         prevTotal > 1 && nextTotal > 1 && prevTotal !== nextTotal
           ? Math.max(0, Math.min(nextTotal - 1, Math.round((idx / prevSpan) * nextSpan)))
           : Math.max(0, Math.min(nextTotal - 1, idx));

       const nextStart = scaleIdx(startFrameRef.current);
       const nextEnd = Math.max(nextStart + 1 <= nextTotal - 1 ? nextStart + 1 : nextStart, scaleIdx(endFrameRef.current));
       const nextCurrent = scaleIdx(currentFrameRef.current);

       landmarkDataRef.current = landmarkData;
       cameraDataRef.current = null;
       fpsRef.current = landmarkData.fps;
       startFrameRef.current = nextStart;
       endFrameRef.current = nextEnd;
       currentFrameRef.current = nextCurrent;
       loopRestartFrameRef.current = landmarkData.loopMode
         ? (landmarkData.loopStartFrame ?? 0)
         : null;

       setMaxFrames(nextTotal);
       setFps(landmarkData.fps);
       setStartFrame(nextStart);
       setEndFrame(nextEnd);
       setCurrentFrame(nextCurrent);

       if (isPlayingRef.current) {
         startPlayback(nextCurrent);
       } else {
         renderFrame(nextCurrent);
       }
     },
     [renderFrame, startPlayback]
   );

  return {
    timeline,
    startFrame,
    endFrame,
    resetTimeline,
    initAndPlay,
    updateTimelineData,
    updateTimelineDataPreserveRange,
    initAndPlayCamera,
    bindRootOffsetEvaluators,
  };
}
