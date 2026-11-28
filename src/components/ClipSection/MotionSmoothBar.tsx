// src/components/ClipSection/MotionSmoothBar.tsx
import React from 'react';
import type { MotionSmoothController } from '../../hooks/useMmdPipeline';
import type { I18nTexts } from '../../i18n';
import type { TargetFpsMode } from '../../utils/motionSmoother';

interface MotionSmoothBarProps {
  t: I18nTexts;
  motionSmooth: MotionSmoothController;
  disabled?: boolean;
}

export const MotionSmoothBar: React.FC<MotionSmoothBarProps> = ({
  t,
  motionSmooth,
  disabled = false,
}) => {
  const { config, stats, updateConfig, applyQuickSmooth, resetConfig } = motionSmooth;

  const isModified =
    config.repairDroppedFrames || config.smoothStrength > 0 || config.fpsMode !== 'raw';

  const rawFps = stats?.rawFps || 30;
  const detectedDrops = stats?.detectedDroppedFrames || 0;

  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        background: '#ffffff',
        borderRadius: 6,
        border: detectedDrops > 0 ? '1px dashed #60a5fa' : '1px dashed #cbd5e1',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
            {t.smoothTitle}
          </span>
          {detectedDrops > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#1d4ed8',
                background: '#dbeafe',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {t.smoothDropFoundBadge(detectedDrops)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled={disabled}
            onClick={applyQuickSmooth}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              color: '#ffffff',
              background: '#0ea5e9',
              border: 'none',
              borderRadius: 4,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {t.smoothQuickFixBtn}
          </button>
          <button
            type="button"
            disabled={disabled || !isModified}
            onClick={resetConfig}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              color: '#475569',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              cursor: disabled || !isModified ? 'not-allowed' : 'pointer',
              opacity: isModified ? 1 : 0.6,
            }}
          >
            {t.smoothResetBtn}
          </button>
        </div>
      </div>

      {stats && (
        <div style={{ marginTop: 6, fontSize: 11, fontFamily: 'monospace', color: '#475569' }}>
          {t.smoothStatsSummary(
            stats.rawFps,
            stats.rawFrameCount,
            stats.outputFps,
            stats.outputFrameCount,
            stats.detectedDroppedFrames
          )}
        </div>
      )}

      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px dashed #e2e8f0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 14,
          fontSize: 11,
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: '#334155',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={config.repairDroppedFrames}
            disabled={disabled}
            onChange={(e) => updateConfig({ repairDroppedFrames: e.target.checked })}
          />
          {t.smoothRepairDropLabel}
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontWeight: 600, color: '#334155' }}>{t.smoothFpsModeLabel}:</label>
          <select
            value={config.fpsMode}
            disabled={disabled}
            onChange={(e) => updateConfig({ fpsMode: e.target.value as TargetFpsMode })}
            style={{
              padding: '3px 6px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
            }}
          >
            <option value="raw">{t.smoothFpsRaw(rawFps)}</option>
            <option value="2x">{t.smoothFps2x(rawFps)}</option>
            <option value="60">{t.smoothFps60}</option>
            <option value="120">{t.smoothFps120}</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px' }}>
          <label style={{ fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
            {t.smoothStrengthLabel}:
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={config.smoothStrength}
            disabled={disabled}
            onChange={(e) => updateConfig({ smoothStrength: Number(e.target.value) })}
            style={{ flex: 1, minWidth: 90 }}
          />
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0284c7', minWidth: 34 }}>
            {config.smoothStrength}%
          </span>
        </div>
      </div>
    </div>
  );
};
