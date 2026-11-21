// src/components/ClipSection/ExpressionControls.tsx
import React, { useMemo, useState } from 'react';
import { ExpressionTracksController } from '../../hooks/useExpressionTracks';
import { TimelineController } from '../../hooks/useMmdPipeline';
import { I18nTexts } from '../../i18n';
import { VRM_PRESET_EXPRESSIONS } from '../../types/expressionMapping';
import { ModelMorphInfo } from '../../types/types';
import { evaluateExpressionTrackAtFrame, ExpressionInterpolation } from '../../utils/expressionTrackEvaluator';
import { VmdExpressionTrackSummary } from '../../utils/vmdExpressionAnalyzer';

interface ExpressionControlsProps {
  t: I18nTexts;
  timeline: TimelineController;
  exprState: ExpressionTracksController;
  availableMorphs: ModelMorphInfo[];
  vmdExpressionTracks: VmdExpressionTrackSummary[];
  getFrameVmdExpressions: (frame: number) => Record<string, number>;
  onOpenContextMenu?: (e: React.MouseEvent, trackName: string) => void;
  disabled: boolean;
}

export const ExpressionControls: React.FC<ExpressionControlsProps> = ({
  t,
  timeline,
  exprState,
  availableMorphs,
  vmdExpressionTracks,
  getFrameVmdExpressions,
  onOpenContextMenu,
  disabled,
}) => {
  const [customInput, setCustomInput] = useState('');
  const { currentFrame, startFrame, endFrame, maxFrames, seek } = timeline;
  const { activeName, activeTrack, tracks, customTrackNames } = exprState;

  const { presetRawNamesMap, modelCustomNames } = useMemo(() => {
    const presetMap = new Map<string, string[]>();
    const customSet = new Set<string>();
    for (const m of availableMorphs) {
      if (m.isPreset) {
        const list = presetMap.get(m.targetKey) || [];
        if (!list.includes(m.rawName)) list.push(m.rawName);
        presetMap.set(m.targetKey, list);
      } else {
        customSet.add(m.targetKey);
      }
    }
    return { presetRawNamesMap: presetMap, modelCustomNames: Array.from(customSet) };
  }, [availableMorphs]);

  const vmdActiveSet = useMemo(() => new Set(vmdExpressionTracks.map((tr) => tr.name)), [vmdExpressionTracks]);

  const trackStateMap = useMemo(() => {
    const map = new Map<string, { count: number; muted: boolean }>();
    tracks.forEach((tr) => {
      if (tr.keyframes.length === 0) return;
      map.set(tr.name, {
        count: tr.keyframes.length,
        muted: tr.keyframes.every((k) => k.value <= 1e-4),
      });
    });
    return map;
  }, [tracks]);

  const hasUserOverride = activeTrack.keyframes.length > 0;
  const isMuted = hasUserOverride && activeTrack.keyframes.every((k) => k.value <= 1e-4);
  const isVmdTrack = vmdActiveSet.has(activeName);

  const vmdValueAtCurrent = useMemo(
    () => getFrameVmdExpressions(currentFrame)[activeName] ?? 0,
    [getFrameVmdExpressions, currentFrame, activeName]
  );

  // 核心修复：未手动覆盖时，显示 VMD 原生当前帧权重；有用户覆盖时，显示关键帧插值结果
  const currentValue = useMemo(() => {
    if (hasUserOverride) {
      return evaluateExpressionTrackAtFrame(activeTrack, currentFrame);
    }
    return vmdValueAtCurrent;
  }, [hasUserOverride, activeTrack, currentFrame, vmdValueAtCurrent]);

  const hasKf = useMemo(
    () => activeTrack.keyframes.some((k) => k.frame === currentFrame),
    [activeTrack, currentFrame]
  );

  const extraCustomNames = useMemo(() => {
    const presetSet = new Set<string>(VRM_PRESET_EXPRESSIONS as readonly string[]);
    const known = new Set<string>([...modelCustomNames]);
    const list = [...modelCustomNames];
    for (const n of customTrackNames) {
      if (!known.has(n) && !presetSet.has(n)) {
        known.add(n);
        list.push(n);
      }
    }
    for (const tr of vmdExpressionTracks) {
      if (!known.has(tr.name) && !presetSet.has(tr.name)) {
        known.add(tr.name);
        list.push(tr.name);
      }
    }
    return list;
  }, [modelCustomNames, customTrackNames, vmdExpressionTracks]);

  // 编辑单帧权重：如果是尚未覆盖的 VMD 原生轨，先提取其曲线再修改当前帧，防止丢失其余帧口型/表情
  const handleEditFrameValue = (val: number) => {
    if (!hasUserOverride && isVmdTrack) {
      exprState.extractVmdTrack(activeName, maxFrames, (f) => getFrameVmdExpressions(f)[activeName] ?? 0);
    }
    exprState.upsertKeyframe(activeName, currentFrame, val);
  };

  const handleAddCustom = () => {
    if (!customInput.trim()) return;
    exprState.addCustomTrack(customInput);
    setCustomInput('');
  };

  const handlePillContextMenu = (e: React.MouseEvent, name: string) => {
    if (!onOpenContextMenu) return;
    e.preventDefault();
    onOpenContextMenu(e, name);
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
      {/* 当前帧权重滑块与插值操作 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#ffffff', padding: 10, borderRadius: 8, border: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 340px' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', minWidth: 92 }}>
            {t.exprFrameValueLabel(currentFrame)}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 4,
              flexShrink: 0,
              background: isMuted
                ? '#fee2e2'
                : hasUserOverride
                  ? '#dcfce7'
                  : isVmdTrack
                    ? '#e0f2fe'
                    : '#f3f4f6',
              color: isMuted
                ? '#b91c1c'
                : hasUserOverride
                  ? '#15803d'
                  : isVmdTrack
                    ? '#0369a1'
                    : '#6b7280',
            }}
          >
            {isMuted ? '0' : hasUserOverride ? 'KF' : isVmdTrack ? 'VMD' : '-'}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            disabled={disabled}
            value={currentValue}
            onChange={(e) => handleEditFrameValue(Number(e.target.value))}
            style={{ flex: 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
          />
          <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#1677ff', minWidth: 38 }}>
            {currentValue.toFixed(2)}
          </span>
          {[0, 0.5, 1].map((v) => (
            <button
              key={v}
              type="button"
              disabled={disabled}
              onClick={() => handleEditFrameValue(v)}
              style={{ padding: '3px 7px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db', background: '#f9fafb', cursor: disabled ? 'not-allowed' : 'pointer' }}
            >
              {v}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#4b5563' }}>{t.exprInterpLabel}</label>
          <select
            disabled={disabled}
            value={activeTrack.interpolation}
            onChange={(e) => exprState.setInterpolation(activeName, e.target.value as ExpressionInterpolation)}
            style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db' }}
          >
            <option value="smooth">{t.exprInterpSmooth}</option>
            <option value="linear">{t.exprInterpLinear}</option>
            <option value="step">{t.exprInterpStep}</option>
          </select>
          <button
            type="button"
            disabled={disabled || !hasKf}
            onClick={() => exprState.removeKeyframe(activeName, currentFrame)}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #fca5a5', background: hasKf ? '#fef2f2' : '#f9fafb', color: hasKf ? '#dc2626' : '#9ca3af', cursor: disabled || !hasKf ? 'not-allowed' : 'pointer' }}
          >
            {t.exprDeleteKfBtn}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => exprState.applyConstantRange(activeName, startFrame, endFrame, currentValue > 0 ? currentValue : 1)}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', background: '#ffffff', cursor: disabled ? 'not-allowed' : 'pointer' }}
          >
            {t.exprFillRangeBtn}
          </button>
          <button
            type="button"
            disabled={disabled || activeTrack.keyframes.length === 0}
            onClick={() => exprState.clearTrack(activeName)}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', background: '#ffffff', cursor: disabled || activeTrack.keyframes.length === 0 ? 'not-allowed' : 'pointer' }}
          >
            {t.exprClearTrackBtn}
          </button>
        </div>
      </div>

      {/* VRM 预设表情（支持右键菜单） */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {VRM_PRESET_EXPRESSIONS.map((name) => {
          const st = trackStateMap.get(name);
          const kfCount = st?.count || 0;
          const muted = !!st?.muted;
          const hasVmd = vmdActiveSet.has(name);
          const isSelected = activeName === name;
          const rawMatches = presetRawNamesMap.get(name);
          const exists = !!rawMatches?.length;
          const label = t.exprPresetLabels[name] || name;

          return (
            <button
              key={name}
              type="button"
              disabled={disabled}
              onClick={() => exprState.setActiveName(name)}
              onContextMenu={(e) => handlePillContextMenu(e, name)}
              title={exists ? `${label} -> ${rawMatches.join(', ')}` : label}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
                cursor: disabled ? 'not-allowed' : 'pointer',
                border: isSelected
                  ? '1px solid #1677ff'
                  : muted
                    ? '1px solid #fca5a5'
                    : kfCount > 0
                      ? '1px solid #34d399'
                      : hasVmd
                        ? '1px solid #38bdf8'
                        : '1px solid #d1d5db',
                background: isSelected
                  ? '#1677ff'
                  : muted
                    ? '#fef2f2'
                    : kfCount > 0
                      ? '#ecfdf5'
                      : exists
                        ? '#ffffff'
                        : '#f3f4f6',
                color: isSelected
                  ? '#ffffff'
                  : muted
                    ? '#b91c1c'
                    : kfCount > 0
                      ? '#065f46'
                      : exists
                        ? '#111827'
                        : '#9ca3af',
                fontWeight: isSelected || kfCount > 0 || hasVmd ? 600 : 400,
                textDecoration: muted && !isSelected ? 'line-through' : 'none',
              }}
            >
              {hasVmd && !isSelected && !muted ? '● ' : ''}
              {label}
              {exists ? ` (${rawMatches[0]})` : ''}
              {kfCount > 0 ? ` [${muted ? '0' : kfCount}]` : ''}
            </button>
          );
        })}
      </div>

      {/* 模型专属 & VMD 自定义 Morph（支持右键菜单） */}
      {extraCustomNames.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 96, overflowY: 'auto', padding: 8, background: '#ffffff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          {extraCustomNames.map((name) => {
            const st = trackStateMap.get(name);
            const kfCount = st?.count || 0;
            const muted = !!st?.muted;
            const hasVmd = vmdActiveSet.has(name);
            const isSelected = activeName === name;
            return (
              <button
                key={name}
                type="button"
                disabled={disabled}
                onClick={() => exprState.setActiveName(name)}
                onContextMenu={(e) => handlePillContextMenu(e, name)}
                style={{
                  padding: '3px 9px',
                  borderRadius: 999,
                  fontSize: 11,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  border: isSelected
                    ? '1px solid #1677ff'
                    : muted
                      ? '1px solid #fca5a5'
                      : kfCount > 0
                        ? '1px solid #34d399'
                        : hasVmd
                          ? '1px solid #38bdf8'
                          : '1px solid #d1d5db',
                  background: isSelected ? '#1677ff' : muted ? '#fef2f2' : kfCount > 0 ? '#ecfdf5' : '#f9fafb',
                  color: isSelected ? '#ffffff' : muted ? '#b91c1c' : kfCount > 0 ? '#065f46' : '#374151',
                  fontWeight: isSelected || kfCount > 0 || hasVmd ? 600 : 400,
                  textDecoration: muted && !isSelected ? 'line-through' : 'none',
                }}
              >
                {hasVmd && !isSelected && !muted ? '● ' : ''}
                {name}
                {kfCount > 0 ? ` [${muted ? '0' : kfCount}]` : ''}
              </button>
            );
          })}
        </div>
      )}

      {/* 手动追加自定义表情名 & 当前轨道关键帧胶囊 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8, maxHeight: 110, overflowY: 'auto' }}>
        <input
          type="text"
          value={customInput}
          disabled={disabled}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
          placeholder={t.exprCustomPlaceholder}
          style={{ width: 150, padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db' }}
        />
        <button
          type="button"
          disabled={disabled || !customInput.trim()}
          onClick={handleAddCustom}
          style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', background: '#ffffff', cursor: disabled || !customInput.trim() ? 'not-allowed' : 'pointer' }}
        >
          +
        </button>

        {activeTrack.keyframes.map((kf) => (
          <span
            key={kf.frame}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 7px',
              borderRadius: 6,
              fontSize: 11,
              background: kf.frame === currentFrame ? '#dbeafe' : '#ffffff',
              border: kf.frame === currentFrame ? '1px solid #3b82f6' : '1px solid #e5e7eb',
            }}
          >
            <button type="button" onClick={() => seek(kf.frame)} style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 11, cursor: 'pointer', color: '#1f2937', fontWeight: 600 }}>
              F{kf.frame}: {kf.value.toFixed(2)}
            </button>
            <button type="button" disabled={disabled} onClick={() => exprState.removeKeyframe(activeName, kf.frame)} style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', color: '#ef4444' }}>
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
};
