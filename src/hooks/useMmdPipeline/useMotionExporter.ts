// src/hooks/useMmdPipeline/useMotionExporter.ts
import { RefObject, useCallback, useState } from 'react';
import { I18nTexts } from '../../i18n';
import { LandmarkData } from '../../types/types';
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
  rawLandmarkDataRef: RefObject<LandmarkData | null>;
  expressionTracks: ExpressionTrack[];
  loopRegion: LoopRegionConfig | null;
  isLoopBaked: boolean;
  startFrame: number;
  endFrame: number;
  getBaseFilename: () => string;
  t?: I18nTexts;
}

export function useMotionExporter({
  rawLandmarkDataRef,
  expressionTracks,
  loopRegion,
  isLoopBaked,
  startFrame,
  endFrame,
  getBaseFilename,
  t,
}: MotionExporterDeps) {
  const [exportingType, setExportingType] = useState<string | null>(null);

  const runExport = useCallback(
    async (format: 'vrma' | 'glb', buildBlob: (trimmed: LandmarkData) => Promise<Blob>) => {
      if (!rawLandmarkDataRef.current) return;
      try {
        setExportingType(format);
        const withExpressions = mergeExpressionTracksIntoLandmarkData(
          rawLandmarkDataRef.current,
          expressionTracks
        );

        let exportData: LandmarkData;
        const totalLen = withExpressions.frames.length;

        if (isLoopBaked && startFrame === 0 && endFrame === totalLen - 1) {
          // 时间轴已完成交叠拼接且未二次截断，直接保留 bridgeContinuation / bridgeLeadIn / loopMode 元数据送给 mathSolver
          exportData = withExpressions;
        } else if (!isLoopBaked && loopRegion) {
          // 尚未点应用到时间轴时直接导出，按当前循环参数现场拼接
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
    [rawLandmarkDataRef, expressionTracks, loopRegion, isLoopBaked, startFrame, endFrame, getBaseFilename, t]
  );

  const downloadVrma = useCallback(
    (metaOptions?: VrmaMetaOptions) =>
      runExport('vrma', (trimmed) =>
        exportFull52VRMA(trimmed, {
          title: metaOptions?.title || getBaseFilename(),
          authors: metaOptions?.authors,
          copyrightInformation: metaOptions?.copyrightInformation,
          licenseUrl: metaOptions?.licenseUrl,
        })
      ),
    [runExport, getBaseFilename]
  );

  const downloadGlb = useCallback(
    () => runExport('glb', (trimmed) => exportFull52HumanoidGLB(trimmed)),
    [runExport]
  );

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
    downloadBoth,
  };
}
