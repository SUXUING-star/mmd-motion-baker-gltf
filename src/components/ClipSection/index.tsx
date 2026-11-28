// src/components/ClipSection/index.tsx
import React, { useCallback, useState } from 'react';
import type { ExpressionTracksController } from '../../hooks/useExpressionTracks';
import type { MmdPipeline } from '../../hooks/useMmdPipeline';
import type { I18nTexts } from '../../i18n';
import {
  ExpressionContextMenu,
  ExpressionContextMenuState,
} from './ExpressionContextMenu';
import { ExpressionControls } from './ExpressionControls';
import { LoopInspectorBar } from './LoopInspectorBar';
import { MotionSmoothBar } from './MotionSmoothBar';
import { PrTimeline } from './PrTimeline';
import { RootPostProcessBar } from './RootPostProcessBar';
import { TransportBar } from './TransportBar';
import { TrimRangeBar } from './TrimRangeBar';

interface ClipSectionProps {
  t: I18nTexts;
  pipeline: MmdPipeline;
  exprState: ExpressionTracksController;
}

export const ClipSection: React.FC<ClipSectionProps> = ({ t, pipeline, exprState }) => {
  // 组件内解构
  const {
    timeline,
    loop,
    rootPostProcess,
    motionSmooth,
    availableMorphs,
    vmdExpressionTracks,
    getFrameVmdExpressions,
    bakeTargetType,
    processing,
  } = pipeline;

  const [menuState, setMenuState] = useState<ExpressionContextMenuState | null>(null);

  const handleOpenContextMenu = useCallback((e: React.MouseEvent, trackName: string) => {
    e.preventDefault();
    setMenuState({
      x: e.clientX,
      y: e.clientY,
      trackName,
    });
  }, []);

  if (timeline.maxFrames === 0) return null;

  const isCameraMode = bakeTargetType === 'camera';

  return (
    <div style={{ padding: '14px 16px', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 8, marginBottom: 16 }}>
      <TransportBar
        t={t}
        timeline={timeline}
        exprState={exprState}
        isCameraMode={isCameraMode}
        disabled={processing}
      />
      <PrTimeline
        t={t}
        timeline={timeline}
        loop={loop}
        exprState={exprState}
        vmdExpressionTracks={vmdExpressionTracks}
        getFrameVmdExpressions={getFrameVmdExpressions}
        onOpenContextMenu={handleOpenContextMenu}
        isCameraMode={isCameraMode}
        disabled={processing}
      />
      <TrimRangeBar t={t} timeline={timeline} disabled={processing} />
      {!isCameraMode && (
        <RootPostProcessBar
          t={t}
          rootPostProcess={rootPostProcess}
          disabled={processing}
        />
      )}
      {!isCameraMode && (
        <MotionSmoothBar
          t={t}
          motionSmooth={motionSmooth}
          disabled={processing}
        />
      )}

      {!isCameraMode && (
        <LoopInspectorBar
          t={t}
          timeline={timeline}
          loop={loop}
          disabled={processing}
        />
      )}
      {!isCameraMode && (
        <ExpressionControls
          t={t}
          timeline={timeline}
          exprState={exprState}
          availableMorphs={availableMorphs}
          vmdExpressionTracks={vmdExpressionTracks}
          getFrameVmdExpressions={getFrameVmdExpressions}
          onOpenContextMenu={handleOpenContextMenu}
          disabled={processing}
        />
      )}
      {!isCameraMode && (
        <ExpressionContextMenu
          t={t}
          menuState={menuState}
          onClose={() => setMenuState(null)}
          currentFrame={timeline.currentFrame}
          maxFrames={timeline.maxFrames}
          startFrame={timeline.startFrame}
          endFrame={timeline.endFrame}
          fps={timeline.fps}
          exprState={exprState}
          availableMorphs={availableMorphs}
          vmdExpressionTracks={vmdExpressionTracks}
          getFrameVmdExpressions={getFrameVmdExpressions}
          disabled={processing}
        />
      )}
    </div>
  );
};
