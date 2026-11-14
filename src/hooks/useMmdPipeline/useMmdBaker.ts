import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { I18nTexts } from '../../i18n';
import { CameraAnimationData } from '../../solvers/cameraSolver';
import { LandmarkData, ModelMorphInfo } from '../../types/types';
import { bakePure3DLandmarks, BakerResult, loadPmxMeshOnly } from '../../utils/baker';
import { bakeCameraVmd } from '../../utils/cameraBaker';
import {
    analyzeVmdExpressions,
    VmdExpressionTrackSummary,
} from '../../utils/vmdExpressionAnalyzer';

export type StatusType = 'ready' | 'analyzing' | 'ready_to_export' | 'exporting' | 'error';
export type BakeTargetType = 'motion' | 'camera';

export interface BakerThreeBridge {
  setMmdCamera: () => void;
  clearCurrentMesh: () => void;
  setupMmdAnimation: (mesh: any, animation?: any) => void;
  updateLandmarks: (mesh: any, landmarks: Record<string, [number, number, number]>) => void;
  setViewMode?: (mode: 'mmd' | 'camera') => void;
  setCameraPose?: (
    pos: THREE.Vector3 | [number, number, number],
    quat: THREE.Quaternion | [number, number, number, number],
    fov?: number
  ) => void;
}

interface UseMmdBakerParams {
  threeBridge: BakerThreeBridge;
  files: {
    activePmxTarget: File | string;
    activeVmdTarget: File | string;
    vmdFile: File | null;
    customExtraFiles: File[];
    changeVersion: number;
    resetAllToDefault: () => void;
  };
  playback: {
    resetTimeline: () => void;
    initAndPlay: (data: LandmarkData) => void;
    initAndPlayCamera: (data: CameraAnimationData) => void;
  };
  defaultPmxPath: string;
  defaultVmdPath: string;
  t: I18nTexts;
}

export function useMmdBaker({
  threeBridge,
  files,
  playback,
  defaultPmxPath,
  defaultVmdPath,
  t,
}: UseMmdBakerParams) {
  const rawLandmarkDataRef = useRef<LandmarkData | null>(null);
  const cameraDataRef = useRef<CameraAnimationData | null>(null);

  const [bakeTargetType, setBakeTargetTypeState] = useState<BakeTargetType>('motion');
  const [statusType, setStatusType] = useState<StatusType>('ready');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [availableMorphs, setAvailableMorphs] = useState<ModelMorphInfo[]>([]);
  const [vmdExpressionTracks, setVmdExpressionTracks] = useState<VmdExpressionTrackSummary[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [processing, setProcessing] = useState<boolean>(false);
  const [sessionVersion, setSessionVersion] = useState<number>(0);

  const prevFilesChangeRef = useRef(files.changeVersion);
  useEffect(() => {
    if (files.changeVersion !== prevFilesChangeRef.current) {
      prevFilesChangeRef.current = files.changeVersion;
      setStatusType('ready');
    }
  }, [files.changeVersion]);

  const clearBakeData = useCallback(() => {
    rawLandmarkDataRef.current = null;
    cameraDataRef.current = null;
    setAvailableMorphs([]);
    setVmdExpressionTracks([]);
    setProgress(0);
  }, []);

  const bakeMotionRaw = useCallback(
    async (
      pmxTarget: File | string,
      vmdTarget: File | string,
      extraFiles: File[]
    ): Promise<BakerResult> => {
      try {
        setProcessing(true);
        clearBakeData();
        threeBridge.setMmdCamera();
        threeBridge.clearCurrentMesh();

        const result = await bakePure3DLandmarks(
          pmxTarget,
          vmdTarget,
          (mesh, landmarks, prog) => {
            setProgress(prog);
            threeBridge.updateLandmarks(mesh, landmarks);
          },
          extraFiles
        );

        rawLandmarkDataRef.current = result.landmarkData;
        setAvailableMorphs(result.landmarkData.availableMorphs || []);
        setVmdExpressionTracks(analyzeVmdExpressions(result.landmarkData));
        threeBridge.setupMmdAnimation(result.mesh, result.animation);

        return result;
      } finally {
        setProcessing(false);
      }
    },
    [threeBridge, clearBakeData]
  );

  const bakeCameraRaw = useCallback(
    async (
      pmxTarget: File | string,
      vmdTarget: File | string,
      extraFiles: File[]
    ): Promise<CameraAnimationData> => {
      try {
        setProcessing(true);
        clearBakeData();
        threeBridge.clearCurrentMesh();

        const mesh = await loadPmxMeshOnly(pmxTarget, extraFiles);
        threeBridge.setupMmdAnimation(mesh);

        const result = await bakeCameraVmd(vmdTarget, (cam, prog) => {
          setProgress(prog);
          threeBridge.setCameraPose?.(cam.position, cam.quaternion, cam.fov);
        });

        cameraDataRef.current = result;
        return result;
      } finally {
        setProcessing(false);
      }
    },
    [threeBridge, clearBakeData]
  );

  const { resetTimeline, initAndPlay, initAndPlayCamera } = playback;

  const setBakeTargetType = useCallback(
    (nextType: BakeTargetType) => {
      if (nextType === bakeTargetType) return;
      resetTimeline();
      clearBakeData();
      threeBridge.clearCurrentMesh();

      if (nextType === 'motion') {
        threeBridge.setMmdCamera();
      } else {
        threeBridge.setViewMode?.('camera');
      }

      setStatusType('ready');
      setErrorMessage('');
      setSessionVersion((v) => v + 1);
      setBakeTargetTypeState(nextType);
    },
    [bakeTargetType, resetTimeline, clearBakeData, threeBridge]
  );

  const runBakeMotion = useCallback(
    async (pmxTarget: File | string, vmdTarget: File | string, extraFiles: File[]) => {
      try {
        resetTimeline();
        setSessionVersion((v) => v + 1);
        setStatusType('analyzing');

        const { landmarkData } = await bakeMotionRaw(pmxTarget, vmdTarget, extraFiles);
        setStatusType('ready_to_export');
        initAndPlay(landmarkData);
      } catch (err: unknown) {
        console.error(err);
        setStatusType('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [resetTimeline, bakeMotionRaw, initAndPlay]
  );

  const runBakeCamera = useCallback(
    async (vmdTarget: File | string) => {
      try {
        resetTimeline();
        setSessionVersion((v) => v + 1);
        setStatusType('analyzing');
        threeBridge.setViewMode?.('camera');

        const result = await bakeCameraRaw(
          files.activePmxTarget,
          vmdTarget,
          files.customExtraFiles
        );
        setStatusType('ready_to_export');
        initAndPlayCamera(result);
      } catch (err: unknown) {
        console.error(err);
        setStatusType('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [resetTimeline, threeBridge, bakeCameraRaw, files.activePmxTarget, files.customExtraFiles, initAndPlayCamera]
  );

  const startBake = useCallback(async () => {
    if (bakeTargetType === 'motion') {
      await runBakeMotion(
        files.activePmxTarget,
        files.activeVmdTarget,
        files.customExtraFiles
      );
    } else {
      if (!files.vmdFile) {
        alert(t.cameraBakeAlert);
        return;
      }
      await runBakeCamera(files.vmdFile);
    }
  }, [bakeTargetType, runBakeMotion, runBakeCamera, files.activePmxTarget, files.activeVmdTarget, files.vmdFile, files.customExtraFiles, t]);

  const loadDefaultDemo = useCallback(async () => {
    files.resetAllToDefault();
    if (bakeTargetType === 'motion') {
      await runBakeMotion(defaultPmxPath, defaultVmdPath, []);
    } else {
      alert(t.cameraDemoAlert);
    }
  }, [files, bakeTargetType, runBakeMotion, defaultPmxPath, defaultVmdPath, t]);

  const getFrameVmdExpressions = useCallback((frame: number): Record<string, number> => {
    return rawLandmarkDataRef.current?.frames[frame]?.expressions || {};
  }, []);

  const status = useMemo(() => {
    switch (statusType) {
      case 'ready':
        return t.statusReady;
      case 'analyzing':
        return bakeTargetType === 'motion' ? t.statusAnalyzing : t.bakingCameraProgress(progress);
      case 'ready_to_export':
        return t.statusReadyToExport;
      case 'exporting':
        return t.statusSolvingHumanoid;
      case 'error':
        return t.statusError(errorMessage);
    }
  }, [t, statusType, bakeTargetType, progress, errorMessage]);

  return {
    rawLandmarkDataRef,
    cameraDataRef,
    bakeTargetType,
    setBakeTargetType,
    status,
    statusType,
    progress,
    processing,
    availableMorphs,
    vmdExpressionTracks,
    getFrameVmdExpressions,
    startBake,
    loadDefaultDemo,
    sessionVersion,
  };
}
