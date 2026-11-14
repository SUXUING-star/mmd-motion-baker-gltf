// src/components/ClipSection/index.tsx
import React from 'react';
import type { ExpressionTracksController } from '../../hooks/useExpressionTracks';
import type { MmdPipeline } from '../../hooks/useMmdPipeline';
import type { I18nTexts } from '../../i18n';
import { ExpressionControls } from './ExpressionControls';
import { LoopInspectorBar } from './LoopInspectorBar';
import { PrTimeline } from './PrTimeline';
import { TransportBar } from './TransportBar';
import { TrimRangeBar } from './TrimRangeBar';

interface ClipSectionProps {
  t: I18nTexts;
  pipeline: MmdPipeline;
  exprState: ExpressionTracksController;
}

export const ClipSection: React.FC<ClipSectionProps> = ({ t, pipeline, exprState }) => {
  const {
    timeline,
    loop,
    availableMorphs,
    vmdExpressionTracks,
    getFrameVmdExpressions,
    bakeTargetType,
    processing,
  } = pipeline;

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
        isCameraMode={isCameraMode}
        disabled={processing}
      />
      <TrimRangeBar t={t} timeline={timeline} disabled={processing} />
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
          disabled={processing}
        />
      )}
    </div>
  );
};
