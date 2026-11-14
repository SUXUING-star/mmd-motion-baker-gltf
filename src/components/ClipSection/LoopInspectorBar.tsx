// src/components/ClipSection/LoopInspectorBar.tsx
import React from 'react';
import type { LoopController, TimelineController } from '../../hooks/useMmdPipeline';
import type { I18nTexts } from '../../i18n';

interface LoopInspectorBarProps {
  t: I18nTexts;
  timeline: TimelineController;
  loop: LoopController;
  disabled?: boolean;
}

export const LoopInspectorBar: React.FC<LoopInspectorBarProps> = ({
  t,
  timeline,
  loop,
  disabled = false,
}) => {
  const fps = timeline.fps || 30;
  // Overlap 模式下严格维持 1.000 完整周期长度 (total = end - start + 1，拆分为主体 + 同相位交叠过渡)
  const totalOutFrames = loop.isBaked
    ? timeline.maxFrames
    : timeline.endFrame - timeline.startFrame + 1;
  const bodyFrames = Math.max(0, totalOutFrames - loop.bridgeFrames);

  return (
    <div style={{ marginTop: 12, padding: 10, background: '#ffffff', borderRadius: 6, border: '1px dashed #cbd5e1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
            {t.loopDetectTitle}
          </span>
          {loop.isBaked && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#7e22ce', background: '#f3e8ff', padding: '1px 6px', borderRadius: 4 }}>
              {t.loopBakedBadge}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {loop.isBaked && (
            <button
              type="button"
              disabled={disabled}
              onClick={loop.restoreRaw}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                color: '#475569',
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {t.restoreRawTimelineBtn}
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={loop.findCandidates}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              color: '#6366f1',
              background: '#eef2ff',
              border: '1px solid #c7d2fe',
              borderRadius: 4,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {t.findLoopCandidatesBtn}
          </button>
        </div>
      </div>

      {loop.candidates.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>{t.candidateListTitle}</span>
          {loop.candidates.map((c, i) => {
            const active =
              loop.region?.startFrame === c.startFrame && loop.region?.endFrame === c.endFrame;
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={() => loop.selectCandidate(c)}
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  borderRadius: 999,
                  background: active ? '#ede9fe' : '#f1f5f9',
                  border: active ? '1px solid #8b5cf6' : '1px solid #cbd5e1',
                  color: '#0f172a',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                {t.candidateChip(c.startFrame, c.endFrame, c.score, c.duration.toFixed(2))}
              </button>
            );
          })}
        </div>
      )}

      {loop.region && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #e2e8f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#7e22ce' }}>
              {t.loopTrackTitle}
            </span>

            {!loop.isBaked && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <label>{t.blendDurationLabel}:</label>
                  <input
                    type="range"
                    min={0.1}
                    max={1.5}
                    step={0.05}
                    value={loop.region.blendDuration}
                    disabled={disabled}
                    onChange={(e) =>
                      loop.updateRegion({
                        ...loop.region!,
                        blendDuration: parseFloat(e.target.value),
                      })
                    }
                    style={{ width: 90 }}
                  />
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#6b21a8' }}>
                    {t.blendFramesInfo(loop.region.blendDuration.toFixed(2), loop.bridgeFrames)}
                  </span>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#334155', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={loop.region.inPlace}
                    disabled={disabled}
                    onChange={(e) =>
                      loop.updateRegion({
                        ...loop.region!,
                        inPlace: e.target.checked,
                      })
                    }
                  />
                  {t.inPlaceLoopLabel}
                </label>
              </>
            )}

            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              {!loop.isBaked && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={loop.applyToTimeline}
                  style={{
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#ffffff',
                    background: '#7e22ce',
                    border: 'none',
                    borderRadius: 4,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {t.applyLoopToTimelineBtn}
                </button>
              )}

              <button
                type="button"
                disabled={disabled}
                onClick={() => loop.updateRegion(null)}
                style={{
                  padding: '2px 8px',
                  fontSize: 11,
                  color: '#ef4444',
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: 4,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                {t.clearLoopTrackBtn}
              </button>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b21a8' }}>
            {t.loopStatsSummary(
              bodyFrames,
              loop.bridgeFrames,
              totalOutFrames,
              ((Math.max(1, totalOutFrames) - 1) / fps).toFixed(2)
            )}
          </div>
        </div>
      )}
    </div>
  );
};
