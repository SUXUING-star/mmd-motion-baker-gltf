// src/components/ClipSection/RootPostProcessBar.tsx
import React from 'react';
import type { RootPostProcessController } from '../../hooks/useMmdPipeline';
import type { I18nTexts } from '../../i18n';
import type { RootCenterMode } from '../../utils/rootPostProcess';

interface RootPostProcessBarProps {
  t: I18nTexts;
  rootPostProcess: RootPostProcessController;
  disabled?: boolean;
}

const toNum = (val: string, fallback: number): number => {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

export const RootPostProcessBar: React.FC<RootPostProcessBarProps> = ({
  t,
  rootPostProcess,
  disabled = false,
}) => {
  const { config, stats, updateConfig, applyQuickFix, resetConfig } = rootPostProcess;

  const isModified =
    config.centerMode !== 'none' ||
    config.autoGround ||
    config.clampFloor ||
    Math.abs(config.offsetX) > 1e-4 ||
    Math.abs(config.offsetY) > 1e-4 ||
    Math.abs(config.offsetZ) > 1e-4;

  const axes: Array<{
    key: 'offsetX' | 'offsetY' | 'offsetZ';
    label: string;
    min: number;
    max: number;
    value: number;
  }> = [
    { key: 'offsetX', label: t.rootOffsetXLabel, min: -10, max: 10, value: config.offsetX },
    { key: 'offsetY', label: t.rootOffsetYLabel, min: -5, max: 5, value: config.offsetY },
    { key: 'offsetZ', label: t.rootOffsetZLabel, min: -10, max: 10, value: config.offsetZ },
  ];

  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        background: '#ffffff',
        borderRadius: 6,
        border: stats?.isSinking || stats?.isFarFromOrigin
          ? '1px dashed #f59e0b'
          : '1px dashed #cbd5e1',
      }}
    >
      {/* 标题与快捷操作 */}
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
            {t.rootPostTitle}
          </span>
          {stats?.isSinking && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#b91c1c',
                background: '#fee2e2',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {t.rootWarnSinking}
            </span>
          )}
          {stats?.isFarFromOrigin && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#b45309',
                background: '#fef3c7',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {t.rootWarnFar}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled={disabled}
            onClick={applyQuickFix}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              color: '#ffffff',
              background: '#1677ff',
              border: 'none',
              borderRadius: 4,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {t.rootQuickFixBtn}
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
            {t.rootResetBtn}
          </button>
        </div>
      </div>

      {/* 实时坐标诊断数值 */}
      {stats && (
        <div style={{ marginTop: 6, fontSize: 11, fontFamily: 'monospace', color: '#475569' }}>
          {t.rootStatsSummary(
            stats.rawStartX.toFixed(2),
            stats.rawStartZ.toFixed(2),
            stats.rawMinFootY.toFixed(2),
            stats.adjustedStartX.toFixed(2),
            stats.adjustedStartZ.toFixed(2),
            stats.adjustedMinFootY.toFixed(2)
          )}
        </div>
      )}

      {/* 原点对齐与贴地开关 */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontWeight: 600, color: '#334155' }}>{t.rootCenterModeLabel}:</label>
          <select
            value={config.centerMode}
            disabled={disabled}
            onChange={(e) => updateConfig({ centerMode: e.target.value as RootCenterMode })}
            style={{
              padding: '3px 6px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
            }}
          >
            <option value="none">{t.rootCenterNone}</option>
            <option value="start">{t.rootCenterStart}</option>
            <option value="average">{t.rootCenterAverage}</option>
          </select>
        </div>

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
            checked={config.autoGround}
            disabled={disabled}
            onChange={(e) => updateConfig({ autoGround: e.target.checked })}
          />
          {t.rootAutoGroundLabel}
        </label>

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
            checked={config.clampFloor}
            disabled={disabled}
            onChange={(e) => updateConfig({ clampFloor: e.target.checked })}
          />
          {t.rootClampFloorLabel}
        </label>
      </div>

      {/* 手动 X / Y / Z 调节 */}
      <div
        style={{
          marginTop: 8,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 10,
        }}
      >
        {axes.map((ax) => (
          <div
            key={ax.key}
            style={{
              padding: '6px 8px',
              background: '#f8fafc',
              borderRadius: 4,
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11,
                marginBottom: 4,
              }}
            >
              <span style={{ fontWeight: 600, color: '#334155' }}>{ax.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  step={0.01}
                  value={Number(ax.value.toFixed(3))}
                  disabled={disabled}
                  onChange={(e) => updateConfig({ [ax.key]: toNum(e.target.value, 0) })}
                  style={{
                    width: 62,
                    padding: '2px 4px',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    borderRadius: 3,
                    border: '1px solid #cbd5e1',
                  }}
                />
                <button
                  type="button"
                  disabled={disabled || ax.value === 0}
                  onClick={() => updateConfig({ [ax.key]: 0 })}
                  style={{
                    padding: '2px 5px',
                    fontSize: 10,
                    borderRadius: 3,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    cursor: disabled || ax.value === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  0
                </button>
              </div>
            </div>
            <input
              type="range"
              min={ax.min}
              max={ax.max}
              step={0.01}
              disabled={disabled}
              value={Math.max(ax.min, Math.min(ax.max, ax.value))}
              onChange={(e) => updateConfig({ [ax.key]: toNum(e.target.value, 0) })}
              style={{ width: '100%' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
