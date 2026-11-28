// src/hooks/useMmdPipeline/useRootPostProcess.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LandmarkData } from '../../types/types';
import {
    analyzeRootPostProcess,
    DEFAULT_ROOT_POST_PROCESS,
    RootDiagnosticStats,
    RootPostProcessConfig,
} from '../../utils/rootPostProcess';

export interface RootPostProcessController {
  config: RootPostProcessConfig;
  stats: RootDiagnosticStats | null;
  updateConfig: (patch: Partial<RootPostProcessConfig>) => void;
  applyQuickFix: () => void;
  resetConfig: () => void;
}

interface UseRootPostProcessParams {
  getActiveLandmarkData: () => LandmarkData | null;
  sessionVersion: number;
  isLoopBaked: boolean;
  maxFrames: number;
  startFrame: number;
  endFrame: number;
}

export function useRootPostProcess({
  getActiveLandmarkData,
  sessionVersion,
  isLoopBaked,
  maxFrames,
  startFrame,
  endFrame,
}: UseRootPostProcessParams) {
  const [config, setConfig] = useState<RootPostProcessConfig>(DEFAULT_ROOT_POST_PROCESS);

  useEffect(() => {
    setConfig(DEFAULT_ROOT_POST_PROCESS);
  }, [sessionVersion]);

  const plan = useMemo(() => {
    if (maxFrames <= 0) return null;
    const data = getActiveLandmarkData();
    if (!data) return null;
    return analyzeRootPostProcess(data, config, startFrame, endFrame);
  }, [getActiveLandmarkData, sessionVersion, isLoopBaked, maxFrames, config, startFrame, endFrame]);

  const updateConfig = useCallback((patch: Partial<RootPostProcessConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyQuickFix = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      centerMode: 'start',
      autoGround: true,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    }));
  }, []);

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_ROOT_POST_PROCESS);
  }, []);

  const getFrameOffsetMmd = useCallback(
    (frameIdx: number): [number, number, number] => {
      return plan ? plan.getFrameOffsetMmd(frameIdx) : [0, 0, 0];
    },
    [plan]
  );

  const getFrameOffsetMeters = useCallback(
    (frameIdx: number): [number, number, number] => {
      return plan ? plan.getFrameOffsetMeters(frameIdx) : [0, 0, 0];
    },
    [plan]
  );

  const controller: RootPostProcessController = useMemo(
    () => ({
      config,
      stats: plan?.stats ?? null,
      updateConfig,
      applyQuickFix,
      resetConfig,
    }),
    [config, plan, updateConfig, applyQuickFix, resetConfig]
  );

  return {
    rootPostProcess: config,
    rootController: controller,
    plan,
    getFrameOffsetMmd,
    getFrameOffsetMeters,
  };
}
