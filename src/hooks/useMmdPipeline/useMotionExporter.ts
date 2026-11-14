import { RefObject, useCallback, useState } from 'react';
import { I18nTexts } from '../../i18n';
import { CameraAnimationData } from '../../solvers/cameraSolver';
import { LandmarkData } from '../../types/types';
import { exportCameraGLB, exportCameraVRMA } from '../../utils/cameraExporter';
import {
    ExpressionTrack,
    mergeExpressionTracksIntoLandmarkData,
} from '../../utils/expressionTrackEvaluator';
import { exportFull52HumanoidGLB, exportFull52VRMA, VrmaMetaOptions } from '../../utils/motionExporter';
import {
    applyLoopSegmentToLandmarkData,
    LoopRegionConfig,
    trimLandmarkData,
} from '../../utils/motionTrimmer';
import { BakeTargetType } from './useMmdBaker';

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface MotionExporterDeps {
  bakeTargetType: BakeTargetType;
  getActiveLandmarkData: () => LandmarkData | null;
  cameraDataRef: RefObject<CameraAnimationData | null>;
  expressionTracks: ExpressionTrack[];
  loopRegion: LoopRegionConfig | null;
  isLoopBaked: boolean;
  startFrame: number;
  endFrame: number;
  getBaseFilename: () => string;
  t?: I18nTexts;
}

export function useMotionExporter({
  bakeTargetType,
  getActiveLandmarkData,
  cameraDataRef,
  expressionTracks,
  loopRegion,
  isLoopBaked,
  startFrame,
  endFrame,
  getBaseFilename,
  t,
}: MotionExporterDeps) {
  const [exportingType, setExportingType] = useState<string | null>(null);

  const runMotionExport = useCallback(
    async (format: 'vrma' | 'glb', buildBlob: (trimmed: LandmarkData) => Promise<Blob>) => {
      const activeData = getActiveLandmarkData();
      if (!activeData) return;

      try {
        setExportingType(format);
        const withExpressions = mergeExpressionTracksIntoLandmarkData(activeData, expressionTracks);

        let exportData: LandmarkData;
        const totalLen = withExpressions.frames.length;

        if (isLoopBaked && startFrame === 0 && endFrame === totalLen - 1) {
          exportData = withExpressions;
        } else if (!isLoopBaked && loopRegion) {
          exportData = applyLoopSegmentToLandmarkData(
            withExpressions,
            loopRegion.startFrame,
            loopRegion.endFrame,
            loopRegion.blendDuration,
            loopRegion.inPlace
          );
        } else {
          exportData = trimLandmarkData(withExpressions, startFrame, endFrame);
        }

        const blob = await buildBlob(exportData);
        triggerBrowserDownload(blob, `${getBaseFilename()}_[${startFrame}-${endFrame}].${format}`);
      } catch (err) {
        const errMsg = t
          ? t.exportMotionFail(format.toUpperCase(), String(err))
          : `导出 ${format.toUpperCase()} 失败: ${err}`;
        alert(errMsg);
      } finally {
        setExportingType(null);
      }
    },
    [
      getActiveLandmarkData,
      expressionTracks,
      loopRegion,
      isLoopBaked,
      startFrame,
      endFrame,
      getBaseFilename,
      t,
    ]
  );

  const downloadCameraVrma = useCallback(
    async (metaOptions?: VrmaMetaOptions) => {
      const cameraData = cameraDataRef.current;
      if (!cameraData) return;

      try {
        setExportingType('vrma');
        const blob = await exportCameraVRMA(cameraData, metaOptions, startFrame, endFrame);
        triggerBrowserDownload(blob, `${getBaseFilename()}_camera.vrma`);
      } catch (err) {
        const errMsg = t
          ? t.exportCameraFail('VRMA', String(err))
          : `导出相机 VRMA 失败: ${err}`;
        alert(errMsg);
      } finally {
        setExportingType(null);
      }
    },
    [cameraDataRef, startFrame, endFrame, getBaseFilename, t]
  );

  const downloadCameraGlb = useCallback(async () => {
    const cameraData = cameraDataRef.current;
    if (!cameraData) return;

    try {
      setExportingType('glb');
      const blob = await exportCameraGLB(cameraData, startFrame, endFrame);
      triggerBrowserDownload(blob, `${getBaseFilename()}_camera.glb`);
    } catch (err) {
      const errMsg = t
        ? t.exportCameraFail('GLB', String(err))
        : `导出相机 GLB 失败: ${err}`;
      alert(errMsg);
    } finally {
      setExportingType(null);
    }
  }, [cameraDataRef, startFrame, endFrame, getBaseFilename, t]);

  const downloadVrma = useCallback(
    async (metaOptions?: VrmaMetaOptions) => {
      if (bakeTargetType === 'camera') {
        await downloadCameraVrma(metaOptions);
        return;
      }
      await runMotionExport('vrma', (trimmed) =>
        exportFull52VRMA(trimmed, {
          title: metaOptions?.title || getBaseFilename(),
          authors: metaOptions?.authors,
          copyrightInformation: metaOptions?.copyrightInformation,
          licenseUrl: metaOptions?.licenseUrl,
        })
      );
    },
    [bakeTargetType, downloadCameraVrma, runMotionExport, getBaseFilename]
  );

  const downloadGlb = useCallback(async () => {
    if (bakeTargetType === 'camera') {
      await downloadCameraGlb();
      return;
    }
    await runMotionExport('glb', (trimmed) => exportFull52HumanoidGLB(trimmed));
  }, [bakeTargetType, downloadCameraGlb, runMotionExport]);

  const downloadBoth = useCallback(
    async (metaOptions?: VrmaMetaOptions) => {
      await downloadVrma(metaOptions);
      await downloadGlb();
    },
    [downloadVrma, downloadGlb]
  );

  return {
    exportingType,
    downloadVrma,
    downloadGlb,
    downloadCameraVrma,
    downloadCameraGlb,
    downloadBoth,
  };
}
