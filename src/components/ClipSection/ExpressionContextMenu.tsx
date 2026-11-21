// src/components/ClipSection/ExpressionContextMenu.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExpressionTracksController } from '../../hooks/useExpressionTracks';
import { I18nTexts } from '../../i18n';
import { VRM_PRESET_EXPRESSIONS } from '../../types/expressionMapping';
import { ModelMorphInfo } from '../../types/types';
import { evaluateExpressionTrackAtFrame } from '../../utils/expressionTrackEvaluator';
import { VmdExpressionTrackSummary } from '../../utils/vmdExpressionAnalyzer';

export interface ExpressionContextMenuState {
  x: number;
  y: number;
  trackName: string;
}

interface ExpressionContextMenuProps {
  t: I18nTexts;
  menuState: ExpressionContextMenuState | null;
  onClose: () => void;
  currentFrame: number;
  maxFrames: number;
  startFrame: number;
  endFrame: number;
  fps: number;
  exprState: ExpressionTracksController;
  availableMorphs: ModelMorphInfo[];
  vmdExpressionTracks: VmdExpressionTrackSummary[];
  getFrameVmdExpressions: (frame: number) => Record<string, number>;
  disabled?: boolean;
}

const MENU_WIDTH = 256;

export const ExpressionContextMenu: React.FC<ExpressionContextMenuProps> = ({
  t,
  menuState,
  onClose,
  currentFrame,
  maxFrames,
  startFrame,
  endFrame,
  fps,
  exprState,
  availableMorphs,
  vmdExpressionTracks,
  getFrameVmdExpressions,
  disabled = false,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [subMode, setSubMode] = useState<'main' | 'replace' | 'copy'>('main');
  const [search, setSearch] = useState('');

  const uiLang: 'zh' | 'ja' | 'en' =
    t.play === '播放' ? 'zh' : t.play === '再生' ? 'ja' : 'en';

  const txt = useMemo(() => {
    if (uiLang === 'ja') {
      return {
        selectTrack: 'このトラックを選択',
        insertKf: `現在フレーム F${currentFrame} にキー追加`,
        deleteKf: `現在フレーム F${currentFrame} のキー削除`,
        extractVmd: 'VMD カーブをキーフレーム化',
        replaceWith: '別の表情に置換...',
        copyTo: '別の表情に複製...',
        fillRange: `選択値で範囲を埋める (F${startFrame}-${endFrame})`,
        autoBlink: '自動まばたきを生成 (blink)',
        restoreVmd: 'VMD オリジナルに戻す',
        muteZero: 'トラックを削除 / ミュート(0固定)',
        deleteTrack: 'トラックを削除',
        back: '← 戻る',
        searchPlaceholder: '表情名・モーフを検索...',
        replaceTitle: '置換先の表情を選択',
        copyTitle: '複製先の表情を選択',
        badgeMuted: 'ミュート(0)',
        badgeOverridden: '編集済み',
        badgeVmd: 'VMD',
        badgeEmpty: '空',
        modelTag: 'モデル対応',
      };
    }
    if (uiLang === 'en') {
      return {
        selectTrack: 'Select This Track',
        insertKf: `Set Keyframe at F${currentFrame}`,
        deleteKf: `Delete Keyframe at F${currentFrame}`,
        extractVmd: 'Extract VMD to Keyframes',
        replaceWith: 'Replace Track With...',
        copyTo: 'Duplicate Track To...',
        fillRange: `Fill Trim Range (F${startFrame}-${endFrame})`,
        autoBlink: 'Apply Auto Blink (blink)',
        restoreVmd: 'Restore Original VMD',
        muteZero: 'Delete / Mute Track (Zero)',
        deleteTrack: 'Delete Track',
        back: '← Back',
        searchPlaceholder: 'Search expression / morph...',
        replaceTitle: 'Replace With Target Expression',
        copyTitle: 'Duplicate To Target Expression',
        badgeMuted: 'Muted (0)',
        badgeOverridden: 'Edited',
        badgeVmd: 'VMD',
        badgeEmpty: 'Empty',
        modelTag: 'On Model',
      };
    }
    return {
      selectTrack: '选中此表情轨',
      insertKf: `在当前帧 F${currentFrame} 打关键帧`,
      deleteKf: `删除当前帧 F${currentFrame} 关键帧`,
      extractVmd: '提取 VMD 曲线为关键帧',
      replaceWith: '替换为其他表情...',
      copyTo: '复制动画到其他表情...',
      fillRange: `用当前权重填充裁剪区 (F${startFrame}-${endFrame})`,
      autoBlink: '生成自动眨眼 (blink)',
      restoreVmd: '恢复 VMD 原生数据',
      muteZero: '删除 / 静音置零此轨道',
      deleteTrack: '删除此轨道',
      back: '← 返回菜单',
      searchPlaceholder: '搜索预设或模型 Morph...',
      replaceTitle: '选择要替换成的目标表情',
      copyTitle: '选择要复制到的目标表情',
      badgeMuted: '已置零',
      badgeOverridden: '已编辑',
      badgeVmd: 'VMD 原生',
      badgeEmpty: '空白',
      modelTag: '模型支持',
    };
  }, [uiLang, currentFrame, startFrame, endFrame]);

  useEffect(() => {
    setSubMode('main');
    setSearch('');
  }, [menuState?.trackName, menuState?.x, menuState?.y]);

  useEffect(() => {
    if (!menuState) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', onClose);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [menuState, onClose]);

  const targetCandidates = useMemo(() => {
    if (!menuState) return [];
    const trackName = menuState.trackName;
    const presetSet = new Set<string>(VRM_PRESET_EXPRESSIONS as readonly string[]);
    const modelPresetRawMap = new Map<string, string[]>();
    const customModelSet = new Set<string>();

    for (const m of availableMorphs) {
      if (m.isPreset) {
        const list = modelPresetRawMap.get(m.targetKey) || [];
        if (!list.includes(m.rawName)) list.push(m.rawName);
        modelPresetRawMap.set(m.targetKey, list);
      } else {
        customModelSet.add(m.targetKey);
      }
    }

    const items: Array<{ name: string; label: string; onModel: boolean; isPreset: boolean }> = [];
    const seen = new Set<string>();

    for (const name of VRM_PRESET_EXPRESSIONS) {
      if (name === trackName) continue;
      seen.add(name);
      const raw = modelPresetRawMap.get(name);
      const presetLabel = t.exprPresetLabels[name] || name;
      items.push({
        name,
        label: raw?.length ? `${presetLabel} (${raw[0]})` : `${presetLabel} [${name}]`,
        onModel: !!raw?.length,
        isPreset: true,
      });
    }

    const extraNames = [
      ...Array.from(customModelSet),
      ...vmdExpressionTracks.map((tr) => tr.name),
      ...exprState.customTrackNames,
    ];
    for (const name of extraNames) {
      if (name === trackName || seen.has(name) || presetSet.has(name)) continue;
      seen.add(name);
      items.push({
        name,
        label: name,
        onModel: customModelSet.has(name),
        isPreset: false,
      });
    }

    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) => it.name.toLowerCase().includes(q) || it.label.toLowerCase().includes(q)
    );
  }, [menuState, availableMorphs, vmdExpressionTracks, exprState.customTrackNames, t.exprPresetLabels, search]);

  if (!menuState) return null;

  const { trackName, x, y } = menuState;
  const userTrack = exprState.tracks.find((tr) => tr.name === trackName);
  const isOverridden = !!userTrack && userTrack.keyframes.length > 0;
  const isMuted = isOverridden && userTrack!.keyframes.every((k) => k.value <= 1e-4);
  const isVmdTrack = vmdExpressionTracks.some((tr) => tr.name === trackName);
  const hasKfAtCurrent = !!userTrack?.keyframes.some((k) => k.frame === currentFrame);

  const vmdVal = getFrameVmdExpressions(currentFrame)[trackName] ?? 0;
  const effectiveVal = isOverridden
    ? evaluateExpressionTrackAtFrame(userTrack!, currentFrame)
    : vmdVal;

  const canAct = !disabled;
  const getVmdAt = (f: number) => getFrameVmdExpressions(f)[trackName] ?? 0;

  const estimatedHeight = subMode === 'main' ? 320 : 340;
  const posX = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 12));
  const posY = Math.max(8, Math.min(y, window.innerHeight - estimatedHeight - 12));

  const badge = isMuted
    ? { text: txt.badgeMuted, bg: '#fee2e2', color: '#b91c1c' }
    : isOverridden
      ? { text: txt.badgeOverridden, bg: '#dcfce7', color: '#15803d' }
      : isVmdTrack
        ? { text: txt.badgeVmd, bg: '#e0f2fe', color: '#0369a1' }
        : { text: txt.badgeEmpty, bg: '#f3f4f6', color: '#6b7280' };

  const itemBtnStyle = (danger = false, isDisabled = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '7px 10px',
    border: 'none',
    background: 'transparent',
    borderRadius: 5,
    fontSize: 12,
    textAlign: 'left',
    color: isDisabled ? '#9ca3af' : danger ? '#dc2626' : '#1f2937',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    fontWeight: danger ? 600 : 500,
  });

  return createPortal(
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: posX,
        top: posY,
        width: MENU_WIDTH,
        zIndex: 9999,
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        boxShadow: '0 10px 28px rgba(15, 23, 42, 0.16)',
        padding: 6,
        fontSize: 12,
        userSelect: 'none',
      }}
    >
      {/* 头部状态栏 */}
      <div
        style={{
          padding: '6px 8px',
          marginBottom: 4,
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div
            title={trackName}
            style={{
              fontWeight: 700,
              fontSize: 12,
              color: '#111827',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t.exprPresetLabels[trackName]
              ? `${t.exprPresetLabels[trackName]} (${trackName})`
              : trackName}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
            F{currentFrame}: {effectiveVal.toFixed(2)}
          </div>
        </div>
        <span
          style={{
            flexShrink: 0,
            padding: '2px 6px',
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            background: badge.bg,
            color: badge.color,
          }}
        >
          {badge.text}
        </span>
      </div>

      {subMode === 'main' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {exprState.activeName !== trackName && (
            <button
              type="button"
              disabled={!canAct}
              onClick={() => {
                exprState.setActiveName(trackName);
                onClose();
              }}
              style={itemBtnStyle(false, !canAct)}
              onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{txt.selectTrack}</span>
            </button>
          )}

          <button
            type="button"
            disabled={!canAct}
            onClick={() => {
              if (!isOverridden && isVmdTrack) {
                exprState.extractVmdTrack(trackName, maxFrames, getVmdAt);
              }
              exprState.upsertKeyframe(trackName, currentFrame, effectiveVal);
              exprState.setActiveName(trackName);
              onClose();
            }}
            style={itemBtnStyle(false, !canAct)}
            onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span>{txt.insertKf}</span>
          </button>

          {hasKfAtCurrent && (
            <button
              type="button"
              disabled={!canAct}
              onClick={() => {
                exprState.removeKeyframe(trackName, currentFrame);
                onClose();
              }}
              style={itemBtnStyle(false, !canAct)}
              onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{txt.deleteKf}</span>
            </button>
          )}

          {isVmdTrack && !isOverridden && (
            <button
              type="button"
              disabled={!canAct}
              onClick={() => {
                exprState.extractVmdTrack(trackName, maxFrames, getVmdAt);
                exprState.setActiveName(trackName);
                onClose();
              }}
              style={itemBtnStyle(false, !canAct)}
              onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{txt.extractVmd}</span>
            </button>
          )}

          <div style={{ height: 1, background: '#f1f5f9', margin: '3px 4px' }} />

          <button
            type="button"
            disabled={!canAct || (!isVmdTrack && !isOverridden)}
            onClick={() => setSubMode('replace')}
            style={itemBtnStyle(false, !canAct || (!isVmdTrack && !isOverridden))}
            onMouseEnter={(e) =>
              canAct && (isVmdTrack || isOverridden) && (e.currentTarget.style.background = '#f1f5f9')
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span>{txt.replaceWith}</span>
            <span style={{ color: '#9ca3af' }}>▸</span>
          </button>

          <button
            type="button"
            disabled={!canAct || (!isVmdTrack && !isOverridden)}
            onClick={() => setSubMode('copy')}
            style={itemBtnStyle(false, !canAct || (!isVmdTrack && !isOverridden))}
            onMouseEnter={(e) =>
              canAct && (isVmdTrack || isOverridden) && (e.currentTarget.style.background = '#f1f5f9')
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span>{txt.copyTo}</span>
            <span style={{ color: '#9ca3af' }}>▸</span>
          </button>

          <button
            type="button"
            disabled={!canAct}
            onClick={() => {
              exprState.applyConstantRange(
                trackName,
                startFrame,
                endFrame,
                effectiveVal > 0 ? effectiveVal : 1
              );
              exprState.setActiveName(trackName);
              onClose();
            }}
            style={itemBtnStyle(false, !canAct)}
            onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span>{txt.fillRange}</span>
          </button>

          {trackName === 'blink' && (
            <button
              type="button"
              disabled={!canAct}
              onClick={() => {
                exprState.applyAutoBlink(startFrame, endFrame, fps);
                onClose();
              }}
              style={itemBtnStyle(false, !canAct)}
              onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{txt.autoBlink}</span>
            </button>
          )}

          <div style={{ height: 1, background: '#f1f5f9', margin: '3px 4px' }} />

          {isVmdTrack && isOverridden && (
            <button
              type="button"
              disabled={!canAct}
              onClick={() => {
                exprState.clearTrack(trackName);
                onClose();
              }}
              style={itemBtnStyle(false, !canAct)}
              onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{txt.restoreVmd}</span>
            </button>
          )}

          {isVmdTrack ? (
            !isMuted && (
              <button
                type="button"
                disabled={!canAct}
                onClick={() => {
                  exprState.muteTrack(trackName, maxFrames);
                  exprState.setActiveName(trackName);
                  onClose();
                }}
                style={itemBtnStyle(true, !canAct)}
                onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#fef2f2')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span>{txt.muteZero}</span>
              </button>
            )
          ) : (
            <button
              type="button"
              disabled={!canAct || (!isOverridden && !exprState.customTrackNames.includes(trackName))}
              onClick={() => {
                exprState.removeCustomTrack(trackName);
                onClose();
              }}
              style={itemBtnStyle(
                true,
                !canAct || (!isOverridden && !exprState.customTrackNames.includes(trackName))
              )}
              onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#fef2f2')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{txt.deleteTrack}</span>
            </button>
          )}
        </div>
      ) : (
        /* 替换 / 复制子菜单 */
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <button
              type="button"
              onClick={() => setSubMode('main')}
              style={{
                border: 'none',
                background: '#f1f5f9',
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                color: '#334155',
              }}
            >
              {txt.back}
            </button>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>
              {subMode === 'replace' ? txt.replaceTitle : txt.copyTitle}
            </span>
          </div>

          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={txt.searchPlaceholder}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '5px 8px',
              marginBottom: 6,
              fontSize: 12,
              borderRadius: 5,
              border: '1px solid #cbd5e1',
              outline: 'none',
            }}
          />

          <div style={{ maxHeight: 210, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {targetCandidates.map((cand) => (
              <button
                key={cand.name}
                type="button"
                disabled={!canAct}
                onClick={() => {
                  exprState.replaceTrack(trackName, cand.name, maxFrames, getVmdAt, {
                    mode: subMode === 'replace' ? 'move' : 'copy',
                    isSourceVmd: isVmdTrack,
                  });
                  onClose();
                }}
                style={{
                  ...itemBtnStyle(false, !canAct),
                  padding: '5px 8px',
                }}
                onMouseEnter={(e) => canAct && (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cand.label}
                </span>
                {cand.onModel && (
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: '#ecfdf5',
                      color: '#047857',
                      marginLeft: 6,
                    }}
                  >
                    {txt.modelTag}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};
