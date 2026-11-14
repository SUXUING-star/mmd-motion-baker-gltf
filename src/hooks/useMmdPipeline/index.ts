import { useMemo } from 'react';
import { I18N, Lang } from '../../i18n';
import { ModelMorphInfo } from '../../types/types';
import { ExpressionTrack } from '../../utils/expressionTrackEvaluator';
import { VrmaMetaOptions } from '../../utils/motionExporter';
import { VmdExpressionTrackSummary } from '../../utils/vmdExpressionAnalyzer';
import { LoopController, useLoopController } from './useLoopController';
import {
    BakerThreeBridge,
    BakeTargetType,
    StatusType,
    useMmdBaker,
} from './useMmdBaker';
import { useMmdFiles } from './useMmdFiles';
import { useMotionExporter } from './useMotionExporter';
import {
    TimelineController,
    TimelineThreeBridge,
    useTimelinePlayback,
} from './useTimelinePlayback';

export type { BakeTargetType, LoopController, StatusType, TimelineController };

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
  threeBridge: BakerThreeBridge & TimelineThreeBridge,
  defaultPmxPath: string,
  defaultVmdPath: string,
  lang: Lang = 'zh',
  expressionTracks: ExpressionTrack[] = []
): MmdPipeline {
  const t = useMemo(() => I18N[lang], [lang]);

  const files = useMmdFiles(defaultPmxPath, defaultVmdPath);
  const playback = useTimelinePlayback(threeBridge, expressionTracks);
  const baker = useMmdBaker({
    threeBridge,
    files,
    playback,
    defaultPmxPath,
    defaultVmdPath,
    t,
  });
  const loop = useLoopController({
    rawLandmarkDataRef: baker.rawLandmarkDataRef,
    sessionVersion: baker.sessionVersion,
    playback,
  });
  const exporter = useMotionExporter({
    bakeTargetType: baker.bakeTargetType,
    getActiveLandmarkData: loop.getActiveLandmarkData,
    cameraDataRef: baker.cameraDataRef,
    expressionTracks,
    loopRegion: loop.loopRegion,
    isLoopBaked: loop.isLoopBaked,
    startFrame: playback.startFrame,
    endFrame: playback.endFrame,
    getBaseFilename: files.getBaseFilename,
    t,
  });

  return {
    // 烘焙与会话状态
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

    // 文件状态
    customPmxFile: files.customPmxFile,
    vmdFile: files.vmdFile,
    activePmxTarget: files.activePmxTarget,
    activeVmdTarget: files.activeVmdTarget,
    selectPmx: files.selectPmx,
    selectVmd: files.selectVmd,
    resetPmx: files.resetPmx,

    // 控制器
    timeline: playback.timeline,
    loop: loop.loop,

    // 导出状态与动作
    exportingType: exporter.exportingType,
    downloadVrma: exporter.downloadVrma,
    downloadGlb: exporter.downloadGlb,
    downloadCameraVrma: exporter.downloadCameraVrma,
    downloadCameraGlb: exporter.downloadCameraGlb,
    downloadBoth: exporter.downloadBoth,
  };
}
