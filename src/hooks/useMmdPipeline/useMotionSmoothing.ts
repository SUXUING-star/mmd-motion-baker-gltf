// src/hooks/useMmdPipeline/useMotionSmoothing.ts
import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LandmarkData } from '../../types/types';
import {
    applyMotionSmoothing,
    DEFAULT_MOTION_SMOOTH,
    MotionSmoothConfig,
    MotionSmoothStats,
} from '../../utils/motionSmoother';

export interface MotionSmoothController {
  config: MotionSmoothConfig;
  stats: MotionSmoothStats | null;
  updateConfig: (patch: Partial<MotionSmoothConfig>) => void;
  applyQuickSmooth: () => void;
  resetConfig: () => void;
}

interface UseMotionSmoothingParams {
  rawLandmarkDataRef: RefObject<LandmarkData | null>;
  sessionVersion: number;
  maxFrames: number;
}

export function useMotionSmoothing({
  rawLandmarkDataRef,
  sessionVersion,
  maxFrames,
}: UseMotionSmoothingParams) {
  const [config, setConfig] = useState<MotionSmoothConfig>(DEFAULT_MOTION_SMOOTH);
  const [smoothRevision, setSmoothRevision] = useState<number>(0);

  const smoothedLandmarkDataRef = useRef<LandmarkData | null>(null);

  useEffect(() => {
    setConfig(DEFAULT_MOTION_SMOOTH);
    setSmoothRevision(0);
    smoothedLandmarkDataRef.current = rawLandmarkDataRef.current;
  }, [sessionVersion, rawLandmarkDataRef]);

  const smoothResult = useMemo(() => {
    const raw = rawLandmarkDataRef.current;
    if (!raw || maxFrames <= 0) {
      smoothedLandmarkDataRef.current = raw;
      return null;
    }
    const res = applyMotionSmoothing(raw, config);
    smoothedLandmarkDataRef.current = res.data;
    return res;
  }, [rawLandmarkDataRef, sessionVersion, maxFrames, config]);

  const updateConfig = useCallback((patch: Partial<MotionSmoothConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setSmoothRevision((v) => v + 1);
  }, []);

  const applyQuickSmooth = useCallback(() => {
    const rawFps = rawLandmarkDataRef.current?.fps || 30;
    setConfig({
      repairDroppedFrames: true,
      dropThreshold: 0.004,
      maxDropGap: 4,
      smoothStrength: 35,
      fpsMode: rawFps >= 45 ? '2x' : '60',
    });
    setSmoothRevision((v) => v + 1);
  }, [rawLandmarkDataRef]);

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_MOTION_SMOOTH);
    setSmoothRevision((v) => v + 1);
  }, []);

  const getSmoothedLandmarkData = useCallback((): LandmarkData | null => {
    return smoothedLandmarkDataRef.current ?? rawLandmarkDataRef.current;
  }, [rawLandmarkDataRef]);

  const controller: MotionSmoothController = useMemo(
    () => ({
      config,
      stats: smoothResult?.stats ?? null,
      updateConfig,
      applyQuickSmooth,
      resetConfig,
    }),
    [config, smoothResult, updateConfig, applyQuickSmooth, resetConfig]
  );

  return {
    smoothConfig: config,
    smoothController: controller,
    smoothRevision,
    smoothedLandmarkDataRef,
    getSmoothedLandmarkData,
  };
}
