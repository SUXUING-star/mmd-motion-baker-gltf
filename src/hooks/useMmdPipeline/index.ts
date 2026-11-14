// src/hooks/useMmdPipeline/index.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { I18N, Lang } from '../../i18n';
import { CameraAnimationData } from '../../solvers/cameraSolver';
import { LandmarkData, ModelMorphInfo } from '../../types/types';
import { exportCameraGLB, exportCameraVRMA } from '../../utils/cameraExporter';
import { ExpressionTrack } from '../../utils/expressionTrackEvaluator';
import { VrmaMetaOptions } from '../../utils/motionExporter';
import {
  applyLoopSegmentToLandmarkData,
  findLoopCandidates,
  LoopCandidate,
  LoopRegionConfig,
} from '../../utils/motionTrimmer';
import { VmdExpressionTrackSummary } from '../../utils/vmdExpressionAnalyzer';
import { useMmdBaker } from './useMmdBaker';
import { useMmdFiles } from './useMmdFiles';
import { useMotionExporter } from './useMotionExporter';
import {
  TimelineController,
  useTimelinePlayback,
} from './useTimelinePlayback';

export type StatusType = 'ready' | 'analyzing' | 'ready_to_export' | 'exporting' | 'error';
export type BakeTargetType = 'motion' | 'camera';

export type { TimelineController };

export interface LoopController {
  candidates: LoopCandidate[];
  region: LoopRegionConfig | null;
  isBaked: boolean;
  bridgeFrames: number;
  findCandidates: () => void;
  selectCandidate: (c: LoopCandidate) => void;
  updateRegion: (region: LoopRegionConfig | null) => void;
  applyToTimeline: () => void;
  restoreRaw: () => void;
}

export interface MmdPipeline {
  bakeTargetType: BakeTargetType;
  setBakeTargetType: (type: BakeTargetType) => void;
  status: string;
  statusType: StatusType;
  progress: number;
  processing: boolean;
  exportingType: string | null;
  customPmxFile: File | null;
  vmdFile: File | null;
  activePmxTarget: File | string;
  activeVmdTarget: File | string;
  availableMorphs: ModelMorphInfo[];
  selectPmx: (file: File | null, extraFiles?: File[]) => void;
  selectVmd: (file: File) => void;
  resetPmx: () => void;
  timeline: TimelineController;
  loop: LoopController;
  startBake: () => Promise<void>;
  loadDefaultDemo: () => Promise<void>;
  downloadVrma: (metaOptions?: VrmaMetaOptions) => Promise<void>;
  downloadGlb: () => Promise<void>;
  downloadCameraVrma: (metaOptions?: VrmaMetaOptions) => Promise<void>;
  downloadCameraGlb: () => Promise<void>;
  downloadBoth: (metaOptions?: VrmaMetaOptions) => Promise<void>;
  vmdExpressionTracks: VmdExpressionTrackSummary[];
  getFrameVmdExpressions: (frame: number) => Record<string, number>;
}

export function useMmdPipeline(
  threeBridge: any,
  defaultPmxPath: string,
  defaultVmdPath: string,
  lang: Lang = 'zh',
  expressionTracks: ExpressionTrack[] = []
): MmdPipeline {
  const t = useMemo(() => I18N[lang], [lang]);

  const [bakeTargetType, setBakeTargetTypeState] = useState<BakeTargetType>('motion');
  const [statusType, setStatusType] = useState<StatusType>('ready');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [loopCandidates, setLoopCandidates] = useState<LoopCandidate[]>([]);
  const [loopRegion, setLoopRegion] = useState<LoopRegionConfig | null>(null);
  const [isLoopBaked, setIsLoopBaked] = useState<boolean>(false);

  const activeLandmarkDataRef = useRef<LandmarkData | null>(null);
  const cameraDataRef = useRef<CameraAnimationData | null>(null);
  const [cameraData, setCameraDataState] = useState<CameraAnimationData | null>(null);

  const markReady = useCallback(() => setStatusType('ready'), []);

  const files = useMmdFiles(defaultPmxPath, defaultVmdPath, markReady);
  const baker = useMmdBaker(threeBridge);
  const playback = useTimelinePlayback(
    activeLandmarkDataRef,
    threeBridge,
    expressionTracks,
    cameraDataRef
  );

  // 未应用到时间轴前，拖动起点/终点滑块实时同步 loopRegion 边界
  useEffect(() => {
    if (!isLoopBaked && loopRegion) {
      if (
        loopRegion.startFrame !== playback.startFrame ||
        loopRegion.endFrame !== playback.endFrame
      ) {
        setLoopRegion((prev) =>
          prev
            ? {
                ...prev,
                startFrame: playback.startFrame,
                endFrame: playback.endFrame,
              }
            : null
        );
      }
    }
  }, [isLoopBaked, loopRegion, playback.startFrame, playback.endFrame]);

  const exporter = useMotionExporter({
    rawLandmarkDataRef: activeLandmarkDataRef,
    expressionTracks,
    loopRegion,
    isLoopBaked,
    startFrame: playback.startFrame,
    endFrame: playback.endFrame,
    getBaseFilename: files.getBaseFilename,
    t,
  });

  const findCandidates = useCallback(() => {
    const src = baker.rawLandmarkDataRef.current;
    if (!src) return;
    setLoopCandidates(findLoopCandidates(src));
  }, [baker.rawLandmarkDataRef]);

  const selectCandidate = useCallback(
    (c: LoopCandidate) => {
      if (baker.rawLandmarkDataRef.current && isLoopBaked) {
        activeLandmarkDataRef.current = baker.rawLandmarkDataRef.current;
        playback.updateTimelineData(baker.rawLandmarkDataRef.current);
        setIsLoopBaked(false);
      }

      setLoopRegion({
        startFrame: c.startFrame,
        endFrame: c.endFrame,
        blendDuration: 0.35,
        inPlace: true,
      });
      playback.timeline.setStart(c.startFrame);
      playback.timeline.setEnd(c.endFrame);
    },
    [baker.rawLandmarkDataRef, isLoopBaked, playback]
  );

  const updateRegion = useCallback(
    (region: LoopRegionConfig | null) => {
      if (region === null && isLoopBaked && baker.rawLandmarkDataRef.current) {
        activeLandmarkDataRef.current = baker.rawLandmarkDataRef.current;
        playback.updateTimelineData(baker.rawLandmarkDataRef.current);
        setIsLoopBaked(false);
      }
      setLoopRegion(region);
    },
    [isLoopBaked, baker.rawLandmarkDataRef, playback]
  );

  const applyToTimeline = useCallback(() => {
    const raw = baker.rawLandmarkDataRef.current;
    if (!raw || !loopRegion) return;

    const stitched = applyLoopSegmentToLandmarkData(
      raw,
      loopRegion.startFrame,
      loopRegion.endFrame,
      loopRegion.blendDuration,
      loopRegion.inPlace
    );
    activeLandmarkDataRef.current = stitched;
    setIsLoopBaked(true);
    playback.updateTimelineData(stitched);
  }, [baker.rawLandmarkDataRef, loopRegion, playback]);

  const restoreRaw = useCallback(() => {
    const raw = baker.rawLandmarkDataRef.current;
    if (!raw) return;

    activeLandmarkDataRef.current = raw;
    setIsLoopBaked(false);
    playback.updateTimelineData(raw);
    if (loopRegion) {
      playback.timeline.setStart(loopRegion.startFrame);
      playback.timeline.setEnd(loopRegion.endFrame);
    }
  }, [baker.rawLandmarkDataRef, loopRegion, playback]);

  const fps = playback.timeline.fps || 30;
  const bridgeFrames = isLoopBaked
    ? activeLandmarkDataRef.current?.loopBridgeFrames || 0
    : loopRegion && loopRegion.endFrame - loopRegion.startFrame >= 6
    ? Math.max(
        3,
        Math.min(
          Math.max(2, Math.floor((loopRegion.endFrame - loopRegion.startFrame) * 0.45)),
          Math.round(loopRegion.blendDuration * fps)
        )
      )
    : 0;

  const loop: LoopController = useMemo(
    () => ({
      candidates: loopCandidates,
      region: loopRegion,
      isBaked: isLoopBaked,
      bridgeFrames,
      findCandidates,
      selectCandidate,
      updateRegion,
      applyToTimeline,
      restoreRaw,
    }),
    [
      loopCandidates,
      loopRegion,
      isLoopBaked,
      bridgeFrames,
      findCandidates,
      selectCandidate,
      updateRegion,
      applyToTimeline,
      restoreRaw,
    ]
  );

  const clearAllBakedState = useCallback(
    (targetMode: BakeTargetType) => {
      playback.resetTimeline();
      baker.clearBakeData();
      activeLandmarkDataRef.current = null;
      cameraDataRef.current = null;
      setCameraDataState(null);
      setLoopCandidates([]);
      setLoopRegion(null);
      setIsLoopBaked(false);
      threeBridge.clearCurrentMesh();

      if (targetMode === 'motion') {
        threeBridge.setMmdCamera();
      } else {
        threeBridge.setViewMode?.('camera');
      }

      setStatusType('ready');
      setErrorMessage('');
    },
    [playback, baker, threeBridge]
  );

  const setBakeTargetType = useCallback(
    (nextType: BakeTargetType) => {
      if (nextType === bakeTargetType) return;
      clearAllBakedState(nextType);
      setBakeTargetTypeState(nextType);
    },
    [bakeTargetType, clearAllBakedState]
  );

  const runBakeMotion = useCallback(
    async (pmxTarget: File | string, vmdTarget: File | string, extraFiles: File[]) => {
      try {
        playback.resetTimeline();
        cameraDataRef.current = null;
        setCameraDataState(null);
        setLoopCandidates([]);
        setLoopRegion(null);
        setIsLoopBaked(false);
        setStatusType('analyzing');

        const { landmarkData } = await baker.bake(pmxTarget, vmdTarget, extraFiles);
        activeLandmarkDataRef.current = landmarkData;

        setStatusType('ready_to_export');
        playback.initAndPlay(landmarkData);
      } catch (err: unknown) {
        console.error(err);
        setStatusType('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [playback, baker]
  );

  const runBakeCamera = useCallback(
    async (vmdTarget: File | string) => {
      try {
        playback.resetTimeline();
        baker.clearBakeData();
        activeLandmarkDataRef.current = null;
        cameraDataRef.current = null;
        setCameraDataState(null);
        setLoopCandidates([]);
        setLoopRegion(null);
        setIsLoopBaked(false);
        setStatusType('analyzing');
        threeBridge.setViewMode?.('camera');

        const result = await baker.bakeCamera(
          files.activePmxTarget,
          vmdTarget,
          files.customExtraFiles,
          (cam) => {
            threeBridge.setCameraPose?.(cam.position, cam.quaternion, cam.fov);
          }
        );

        cameraDataRef.current = result;
        setCameraDataState(result);
        setStatusType('ready_to_export');
        playback.initAndPlayCamera(result);
      } catch (err: unknown) {
        console.error(err);
        setStatusType('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [playback, baker, files, threeBridge]
  );

  const startBake = useCallback(async () => {
    if (bakeTargetType === 'motion') {
      await runBakeMotion(files.activePmxTarget, files.activeVmdTarget, files.customExtraFiles);
    } else {
      if (!files.vmdFile) {
        alert(t.cameraBakeAlert);
        return;
      }
      await runBakeCamera(files.vmdFile);
    }
  }, [bakeTargetType, runBakeMotion, runBakeCamera, files, t]);

  const loadDefaultDemo = useCallback(async () => {
    files.resetAllToDefault();
    if (bakeTargetType === 'motion') {
      await runBakeMotion(defaultPmxPath, defaultVmdPath, []);
    } else {
      alert(t.cameraDemoAlert);
    }
  }, [bakeTargetType, files, runBakeMotion, defaultPmxPath, defaultVmdPath, t]);

  const downloadCameraVrma = useCallback(
    async (metaOptions?: VrmaMetaOptions) => {
      if (!cameraData) return;
      try {
        const blob = await exportCameraVRMA(cameraData, metaOptions, playback.startFrame, playback.endFrame);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${files.getBaseFilename()}_camera.vrma`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        alert(t.exportCameraFail('VRMA', String(err)));
      }
    },
    [cameraData, playback.startFrame, playback.endFrame, files, t]
  );

  const downloadCameraGlb = useCallback(async () => {
    if (!cameraData) return;
    try {
      const blob = await exportCameraGLB(cameraData, playback.startFrame, playback.endFrame);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${files.getBaseFilename()}_camera.glb`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert(t.exportCameraFail('GLB', String(err)));
    }
  }, [cameraData, playback.startFrame, playback.endFrame, files, t]);

  const downloadVrma = useCallback(
    async (metaOptions?: VrmaMetaOptions) => {
      if (bakeTargetType === 'camera') {
        await downloadCameraVrma(metaOptions);
      } else {
        await exporter.downloadVrma(metaOptions);
      }
    },
    [bakeTargetType, downloadCameraVrma, exporter]
  );

  const downloadGlb = useCallback(async () => {
    if (bakeTargetType === 'camera') {
      await downloadCameraGlb();
    } else {
      await exporter.downloadGlb();
    }
  }, [bakeTargetType, downloadCameraGlb, exporter]);

  const downloadBoth = useCallback(
    async (metaOptions?: VrmaMetaOptions) => {
      await downloadVrma(metaOptions);
      await downloadGlb();
    },
    [downloadVrma, downloadGlb]
  );

  const status = useMemo(() => {
    switch (statusType) {
      case 'ready':
        return t.statusReady;
      case 'analyzing':
        return bakeTargetType === 'motion' ? t.statusAnalyzing : t.bakingCameraProgress(baker.progress);
      case 'ready_to_export':
        return t.statusReadyToExport;
      case 'exporting':
        return t.statusSolvingHumanoid;
      case 'error':
        return t.statusError(errorMessage);
    }
  }, [t, statusType, bakeTargetType, baker.progress, errorMessage]);

  return {
    bakeTargetType,
    setBakeTargetType,
    status,
    statusType,
    progress: baker.progress,
    processing: baker.processing,
    exportingType: exporter.exportingType,
    customPmxFile: files.customPmxFile,
    vmdFile: files.vmdFile,
    activePmxTarget: files.activePmxTarget,
    activeVmdTarget: files.activeVmdTarget,
    availableMorphs: baker.availableMorphs,
    selectPmx: files.selectPmx,
    selectVmd: files.selectVmd,
    resetPmx: files.resetPmx,
    timeline: playback.timeline,
    loop,
    startBake,
    loadDefaultDemo,
    downloadVrma,
    downloadGlb,
    downloadCameraVrma,
    downloadCameraGlb,
    downloadBoth,
    vmdExpressionTracks: baker.vmdExpressionTracks,
    getFrameVmdExpressions: baker.getFrameVmdExpressions,
  };
}
