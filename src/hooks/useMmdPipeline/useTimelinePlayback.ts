// src/hooks/useMmdPipeline/useTimelinePlayback.ts
import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraAnimationData } from '../../solvers/cameraSolver';
import { LandmarkData } from '../../types/types';
import { ExpressionTrack } from '../../utils/expressionTrackEvaluator';
import { findBestLoopEndFrame } from '../../utils/motionTrimmer';
import { evaluatePreviewFrame } from './previewFrame';

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
    expressionsOverride?: Record<string, number>
  ) => void;
  setCameraPose?: (
    pos: THREE.Vector3 | [number, number, number],
    quat: THREE.Quaternion | [number, number, number, number],
    fov?: number
  ) => void;
}

export function useTimelinePlayback(
  rawLandmarkDataRef: RefObject<LandmarkData | null>,
  threeBridge: TimelineThreeBridge,
  expressionTracks: ExpressionTrack[],
  cameraDataRef?: RefObject<CameraAnimationData | null>
) {
  const [maxFrames, setMaxFrames] = useState<number>(0);
  const [fps, setFps] = useState<number>(30);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [startFrame, setStartFrame] = useState<number>(0);
  const [endFrame, setEndFrame] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const timerRef = useRef<number | null>(null);
  const fpsRef = useRef<number>(30);
  const currentFrameRef = useRef<number>(0);
  const startFrameRef = useRef<number>(0);
  const endFrameRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);

  const threeBridgeRef = useRef(threeBridge);
  threeBridgeRef.current = threeBridge;

  const expressionTracksRef = useRef<ExpressionTrack[]>(expressionTracks);

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
      if (cameraDataRef?.current && threeBridgeRef.current.setCameraPose) {
        const camFrame = cameraDataRef.current.frames[frameIdx];
        if (camFrame) {
          threeBridgeRef.current.setCameraPose(camFrame.position, camFrame.quaternion, camFrame.fov);
        }
      }

      const data = rawLandmarkDataRef.current;
      if (!data) return;

      const result = evaluatePreviewFrame({
        data,
        frameIdx,
        expressionTracks: expressionTracksRef.current,
      });
      if (!result) return;

      threeBridgeRef.current.setMmdTime(
          result.time,
          result.landmarks,
          result.blendTarget,
          result.expressionsOverride
        );
    },
    [rawLandmarkDataRef, cameraDataRef]
  );

  useEffect(() => {
    expressionTracksRef.current = expressionTracks;
    if (!isPlayingRef.current && (rawLandmarkDataRef.current || cameraDataRef?.current)) {
      renderFrame(currentFrameRef.current);
    }
  }, [expressionTracks, rawLandmarkDataRef, cameraDataRef, renderFrame]);

  const seekToFrame = useCallback(
    (frameIdx: number) => {
      const totalLen =
        rawLandmarkDataRef.current?.frames.length ||
        cameraDataRef?.current?.frames.length ||
        0;
      if (totalLen === 0) return;

      const safeIdx = Math.max(0, Math.min(frameIdx, totalLen - 1));
      currentFrameRef.current = safeIdx;
      setCurrentFrame(safeIdx);
      renderFrame(safeIdx);
    },
    [rawLandmarkDataRef, cameraDataRef, renderFrame]
  );

  const startPlayback = useCallback(
    (initialFrame?: number) => {
      const hasData = !!rawLandmarkDataRef.current || !!cameraDataRef?.current;
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
        let next = currentFrameRef.current + 1;
        if (next > end || next < start) {
          next = start;
        }
        currentFrameRef.current = next;
        setCurrentFrame(next);
        renderFrame(next);
      }, intervalMs);
    },
    [rawLandmarkDataRef, cameraDataRef, renderFrame, stopPlayback]
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
      const total = landmarkData.totalFrames;
      const defaultEnd = Math.max(0, total - 1);

      fpsRef.current = landmarkData.fps;
      startFrameRef.current = 0;
      endFrameRef.current = defaultEnd;

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
      const total = landmarkData.totalFrames;
      const defaultEnd = Math.max(0, total - 1);

      fpsRef.current = landmarkData.fps;
      startFrameRef.current = 0;
      endFrameRef.current = defaultEnd;

      setMaxFrames(total);
      setFps(landmarkData.fps);
      setStartFrame(0);
      setEndFrame(defaultEnd);

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
      const total = camData.totalFrames;
      const defaultEnd = Math.max(0, total - 1);

      fpsRef.current = camData.fps;
      startFrameRef.current = 0;
      endFrameRef.current = defaultEnd;

      setMaxFrames(total);
      setFps(camData.fps);
      setStartFrame(0);
      setEndFrame(defaultEnd);

      startPlayback(0);
    },
    [startPlayback]
  );

  const autoSnapLoopEnd = useCallback(() => {
    if (!rawLandmarkDataRef.current) return;
    const { bestFrameIndex } = findBestLoopEndFrame(
      rawLandmarkDataRef.current,
      startFrameRef.current,
      30
    );
    endFrameRef.current = bestFrameIndex;
    setEndFrame(bestFrameIndex);
    seekToFrame(bestFrameIndex);
  }, [rawLandmarkDataRef, seekToFrame]);

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
    fpsRef.current = 30;
    currentFrameRef.current = 0;
    startFrameRef.current = 0;
    endFrameRef.current = 0;
    setMaxFrames(0);
    setFps(30);
    setCurrentFrame(0);
    setStartFrame(0);
    setEndFrame(0);
  }, [stopPlayback]);

  return {
    timeline,
    startFrame,
    endFrame,
    stopPlayback,
    resetTimeline,
    initAndPlay,
    updateTimelineData,
    initAndPlayCamera,
  };
}
