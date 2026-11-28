// src/hooks/useMmdPipeline/index.ts
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { I18N, Lang } from '../../i18n';
import { ModelMorphInfo } from '../../types/types';
import { ExpressionTrack } from '../../utils/expressionTrackEvaluator';
import { VrmaMetaOptions } from '../../utils/motionExporter';
import { smoothAnimationClip } from '../../utils/motionSmoother';
import { VmdExpressionTrackSummary } from '../../utils/vmdExpressionAnalyzer';
import { LoopController, useLoopController } from './useLoopController';
import {
    BakerThreeBridge,
    BakeTargetType,
    PreviewMeshRefState,
    StatusType,
    useMmdBaker,
} from './useMmdBaker';
import { useMmdFiles } from './useMmdFiles';
import { useMotionExporter } from './useMotionExporter';
import { MotionSmoothController, useMotionSmoothing } from './useMotionSmoothing';
import { RootPostProcessController, useRootPostProcess } from './useRootPostProcess';
import {
    TimelineController,
    TimelineThreeBridge,
    useTimelinePlayback,
} from './useTimelinePlayback';

export type {
    BakeTargetType,
    LoopController,
    MotionSmoothController,
    RootPostProcessController,
    StatusType,
    TimelineController
};

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
  rootPostProcess: RootPostProcessController;
  motionSmooth: MotionSmoothController;
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
  threeBridge: BakerThreeBridge & TimelineThreeBridge,
  defaultPmxPath: string,
  defaultVmdPath: string,
  lang: Lang = 'zh',
  expressionTracks: ExpressionTrack[] = []
): MmdPipeline {
  const t = useMemo(() => I18N[lang], [lang]);

  const meshPreviewRef = useRef<PreviewMeshRefState>({
    mesh: null,
    basePos: new THREE.Vector3(),
    hasClipAnimation: false,
  });

  const files = useMmdFiles(defaultPmxPath, defaultVmdPath);
  const playback = useTimelinePlayback(threeBridge, expressionTracks, meshPreviewRef);
  const baker = useMmdBaker({
    threeBridge,
    meshPreviewRef,
    files,
    playback,
    defaultPmxPath,
    defaultVmdPath,
    t,
  });
  const smoothing = useMotionSmoothing({
    rawLandmarkDataRef: baker.rawLandmarkDataRef,
    sessionVersion: baker.sessionVersion,
    maxFrames: playback.timeline.maxFrames,
  });
  const loop = useLoopController({
    getBaseLandmarkData: smoothing.getSmoothedLandmarkData,
    sessionVersion: baker.sessionVersion,
    smoothRevision: smoothing.smoothRevision,
    playback,
  });
  const root = useRootPostProcess({
    getActiveLandmarkData: loop.getActiveLandmarkData,
    sessionVersion: baker.sessionVersion,
    isLoopBaked: loop.isLoopBaked,
    maxFrames: playback.timeline.maxFrames,
    startFrame: playback.startFrame,
    endFrame: playback.endFrame,
  });

  useEffect(() => {
    if (smoothing.smoothRevision === 0) return;
    const smoothed = smoothing.getSmoothedLandmarkData();
    if (!smoothed) return;
    playback.updateTimelineDataPreserveRange(smoothed);

    if (baker.rawAnimationClipRef.current && threeBridge.updateAnimationClip) {
      const nextClip = smoothAnimationClip(
        baker.rawAnimationClipRef.current,
        smoothing.smoothConfig,
        baker.rawLandmarkDataRef.current?.fps || 30
      );
      threeBridge.updateAnimationClip(nextClip);
    }
  }, [smoothing.smoothRevision]);

  useEffect(() => {
    playback.bindRootOffsetEvaluators(root.getFrameOffsetMmd, root.getFrameOffsetMeters);
  }, [playback, root.getFrameOffsetMmd, root.getFrameOffsetMeters]);

  const exporter = useMotionExporter({
    bakeTargetType: baker.bakeTargetType,
    getActiveLandmarkData: loop.getActiveLandmarkData,
    cameraDataRef: baker.cameraDataRef,
    expressionTracks,
    rootPostProcess: root.rootPostProcess,
    smoothStrength: smoothing.smoothConfig.smoothStrength,
    loopRegion: loop.loopRegion,
    isLoopBaked: loop.isLoopBaked,
    startFrame: playback.startFrame,
    endFrame: playback.endFrame,
    getBaseFilename: files.getBaseFilename,
    t,
  });

  return {
    bakeTargetType: baker.bakeTargetType,
    setBakeTargetType: baker.setBakeTargetType,
    status: baker.status,
    statusType: baker.statusType,
    progress: baker.progress,
    processing: baker.processing,
    availableMorphs: baker.availableMorphs,
    vmdExpressionTracks: baker.vmdExpressionTracks,
    getFrameVmdExpressions: baker.getFrameVmdExpressions,
    startBake: baker.startBake,
    loadDefaultDemo: baker.loadDefaultDemo,

    customPmxFile: files.customPmxFile,
    vmdFile: files.vmdFile,
    activePmxTarget: files.activePmxTarget,
    activeVmdTarget: files.activeVmdTarget,
    selectPmx: files.selectPmx,
    selectVmd: files.selectVmd,
    resetPmx: files.resetPmx,

    timeline: playback.timeline,
    loop: loop.loop,
    rootPostProcess: root.rootController,
    motionSmooth: smoothing.smoothController,

    exportingType: exporter.exportingType,
    downloadVrma: exporter.downloadVrma,
    downloadGlb: exporter.downloadGlb,
    downloadCameraVrma: exporter.downloadCameraVrma,
    downloadCameraGlb: exporter.downloadCameraGlb,
    downloadBoth: exporter.downloadBoth,
  };
}
