// src/components/ClipSection/PrTimeline.tsx
import React, { useMemo, useRef } from 'react';
import { ExpressionTracksController } from '../../hooks/useExpressionTracks';
import { LoopController, TimelineController } from '../../hooks/useMmdPipeline';
import { I18nTexts } from '../../i18n';
import { evaluateExpressionTrackAtFrame } from '../../utils/expressionTrackEvaluator';
import { VmdExpressionTrackSummary } from '../../utils/vmdExpressionAnalyzer';

interface PrTimelineProps {
  t?: I18nTexts;
  timeline: TimelineController;
  loop?: LoopController;
  exprState: ExpressionTracksController;
  vmdExpressionTracks: VmdExpressionTrackSummary[];
  getFrameVmdExpressions: (frame: number) => Record<string, number>;
  onOpenContextMenu?: (e: React.MouseEvent, trackName: string) => void;
  isCameraMode?: boolean;
  disabled: boolean;
}
const TRACK_COLORS = ['#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1'];

export const PrTimeline: React.FC<PrTimelineProps> = ({
  t,
  timeline,
  loop,
  exprState,
  vmdExpressionTracks,
  getFrameVmdExpressions,
  onOpenContextMenu,
  isCameraMode,
  disabled,
}) => {
  const { maxFrames, currentFrame, startFrame, endFrame, seek } = timeline;
  const { activeName, activeTrack, tracks } = exprState;

  const trackAreaRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const totalSpan = Math.max(1, maxFrames - 1);
  const pct = (f: number) => `${(Math.max(0, Math.min(totalSpan, f)) / totalSpan) * 100}%`;

  const scrubByClientX = (clientX: number) => {
    if (disabled || !trackAreaRef.current || maxFrames <= 0) return;
    const rect = trackAreaRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    seek(Math.round(ratio * totalSpan));
  };

  const hasUserOverride = activeTrack.keyframes.length > 0;
  const activeIsInVmd = useMemo(
    () => vmdExpressionTracks.some((tr) => tr.name === activeName),
    [vmdExpressionTracks, activeName]
  );

  // 用户关键帧曲线
  const curvePath = useMemo(() => {
    if (maxFrames <= 0 || activeTrack.keyframes.length === 0) return '';
    const step = Math.max(1, Math.floor(maxFrames / 220));
    const pts: string[] = [];
    for (let f = 0; f < maxFrames; f += step) {
      const x = (f / totalSpan) * 1000;
      const y = 6 + (1 - evaluateExpressionTrackAtFrame(activeTrack, f)) * 48;
      pts.push(`${f === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const lastV = evaluateExpressionTrackAtFrame(activeTrack, maxFrames - 1);
    pts.push(`L 1000 ${(6 + (1 - lastV) * 48).toFixed(1)}`);
    return pts.join(' ');
  }, [maxFrames, totalSpan, activeTrack]);

  // VMD 原生曲线（无覆盖时作为主曲线显示；有覆盖时作为虚线参考）
  const vmdCurvePath = useMemo(() => {
    if (maxFrames <= 0 || !activeIsInVmd) return '';
    const step = Math.max(1, Math.floor(maxFrames / 220));
    const pts: string[] = [];
    for (let f = 0; f < maxFrames; f += step) {
      const x = (f / totalSpan) * 1000;
      const w = getFrameVmdExpressions(f)[activeName] ?? 0;
      const y = 6 + (1 - Math.max(0, Math.min(1, w))) * 48;
      pts.push(`${f === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const lastW = getFrameVmdExpressions(maxFrames - 1)[activeName] ?? 0;
    pts.push(`L 1000 ${(6 + (1 - Math.max(0, Math.min(1, lastW))) * 48).toFixed(1)}`);
    return pts.join(' ');
  }, [maxFrames, totalSpan, activeIsInVmd, activeName, getFrameVmdExpressions]);

  // 当前帧真实有效权重列表（合并 VMD 原生与用户覆盖/置零）
  const activeEffectiveAtCurrent = useMemo(() => {
    const map = new Map<string, { weight: number; source: 'vmd' | 'user' }>();
    const vmdMap = getFrameVmdExpressions(currentFrame);
    for (const [name, w] of Object.entries(vmdMap)) {
      if (w > 0.01) map.set(name, { weight: w, source: 'vmd' });
    }
    for (const tr of tracks) {
      if (tr.keyframes.length === 0) continue;
      const w = evaluateExpressionTrackAtFrame(tr, currentFrame);
      if (w > 0.01) {
        map.set(tr.name, { weight: w, source: 'user' });
      } else {
        map.delete(tr.name);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1].weight - a[1].weight);
  }, [getFrameVmdExpressions, currentFrame, tracks]);

  // 用户新增（不在 vmdExpressionTracks 中）但有关键帧的轨道
  const extraEditedTracks = useMemo(() => {
    const vmdSet = new Set(vmdExpressionTracks.map((tr) => tr.name));
    return tracks.filter((tr) => tr.keyframes.length > 0 && !vmdSet.has(tr.name));
  }, [vmdExpressionTracks, tracks]);

  const trackOverrideMap = useMemo(() => {
    const map = new Map<string, { overridden: boolean; muted: boolean; kfCount: number }>();
    for (const tr of tracks) {
      if (tr.keyframes.length === 0) continue;
      map.set(tr.name, {
        overridden: true,
        muted: tr.keyframes.every((k) => k.value <= 1e-4),
        kfCount: tr.keyframes.length,
      });
    }
    return map;
  }, [tracks]);

  const rulerTicks = useMemo(() => {
    if (maxFrames <= 1) return [0];
    const step = Math.max(1, Math.round(totalSpan / Math.min(8, maxFrames - 1)));
    const ticks: number[] = [];
    for (let f = 0; f < maxFrames; f += step) ticks.push(f);
    if (ticks[ticks.length - 1] !== maxFrames - 1) ticks.push(maxFrames - 1);
    return ticks;
  }, [maxFrames, totalSpan]);

  const handleContextMenu = (e: React.MouseEvent, trackName: string) => {
    if (!onOpenContextMenu || isCameraMode) return;
    e.preventDefault();
    e.stopPropagation();
    onOpenContextMenu(e, trackName);
  };

  return (
    <>
      {/* 仅动作模式显示：当前帧有效激活表情 */}
      {!isCameraMode && (
        <div
          style={{
            marginBottom: 8,
            padding: '6px 10px',
            borderRadius: 6,
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 600, color: '#374151' }}>F{currentFrame}:</span>
          {activeEffectiveAtCurrent.length === 0 ? (
            <span style={{ color: '#9ca3af' }}>{t?.noActiveVmdMorph ?? 'No active VMD morph'}</span>
          ) : (
            activeEffectiveAtCurrent.map(([name, info]) => (
              <button
                key={name}
                type="button"
                onClick={() => exprState.setActiveName(name)}
                onContextMenu={(e) => handleContextMenu(e, name)}
                style={{
                  padding: '1px 7px',
                  borderRadius: 999,
                  border:
                    activeName === name
                      ? '1px solid #1677ff'
                      : info.source === 'user'
                        ? '1px solid #34d399'
                        : '1px solid #bae6fd',
                  background:
                    activeName === name
                      ? '#dbeafe'
                      : info.source === 'user'
                        ? '#ecfdf5'
                        : '#f0f9ff',
                  color: info.source === 'user' ? '#047857' : '#0369a1',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {name}: {info.weight.toFixed(2)}
              </button>
            ))
          )}
        </div>
      )}

      {/* 时间轴 */}
      <div style={{ background: '#ffffff', border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden', userSelect: 'none' }}>
        <div style={{ display: 'flex' }}>
          <div style={{ width: 136, flexShrink: 0, background: '#f5f5f5', borderRight: '1px solid #e5e7eb' }}>
            <div style={{ height: 24, padding: '0 8px', fontSize: 11, fontWeight: 600, color: '#6b7280', display: 'flex', alignItems: 'center', borderBottom: '1px solid #e5e7eb' }}>
              Timeline
            </div>
            {isCameraMode ? (
              <div
                style={{
                  height: 36,
                  padding: '0 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#1677ff',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {t?.bakeModeCamera ?? 'Camera'}
              </div>
            ) : (
              <div
                title={activeName}
                onContextMenu={(e) => handleContextMenu(e, activeName)}
                style={{
                  height: 60,
                  padding: '0 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#1677ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 4,
                  borderBottom: '1px solid #e5e7eb',
                  overflow: 'hidden',
                  cursor: 'context-menu',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeName}
                </span>
                {trackOverrideMap.get(activeName)?.muted ? (
                  <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#fee2e2', color: '#dc2626', flexShrink: 0 }}>
                    0
                  </span>
                ) : hasUserOverride ? (
                  <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#dcfce7', color: '#15803d', flexShrink: 0 }}>
                    KF
                  </span>
                ) : activeIsInVmd ? (
                  <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#e0f2fe', color: '#0369a1', flexShrink: 0 }}>
                    VMD
                  </span>
                ) : null}
              </div>
            )}
          </div>

          <div
            ref={trackAreaRef}
            onPointerDown={(e) => {
              if (disabled || e.button !== 0) return;
              draggingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              scrubByClientX(e.clientX);
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) scrubByClientX(e.clientX);
            }}
            onPointerUp={(e) => {
              draggingRef.current = false;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            style={{ flex: 1, position: 'relative', cursor: disabled ? 'not-allowed' : 'ew-resize' }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: pct(startFrame),
                width: `${((endFrame - startFrame) / totalSpan) * 100}%`,
                background: 'rgba(22, 119, 255, 0.08)',
                borderLeft: '2px solid #1677ff',
                borderRight: '2px solid #1677ff',
                pointerEvents: 'none',
              }}
            />

            {/* PR 循环过渡轨 Overlay */}
            {!isCameraMode && loop && (
              loop.isBaked && loop.bridgeFrames > 0 ? (
                <div
                  title={`${t?.loopTrackTitle ?? 'Transition'}: ${loop.bridgeFrames} frames`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: pct(Math.max(0, maxFrames - 1 - loop.bridgeFrames)),
                    right: 0,
                    background:
                      'repeating-linear-gradient(45deg, rgba(168,85,247,0.22), rgba(168,85,247,0.22) 6px, rgba(147,51,234,0.38) 6px, rgba(147,51,234,0.38) 12px)',
                    borderLeft: '2px dashed #7e22ce',
                    pointerEvents: 'none',
                    zIndex: 4,
                  }}
                />
              ) : (
                loop.region && (
                  <>
                    <div
                      title={`F${loop.region.startFrame} - F${loop.region.endFrame}`}
                      style={{
                        position: 'absolute',
                        top: 2,
                        height: 20,
                        left: pct(loop.region.startFrame),
                        width: `${((loop.region.endFrame - loop.region.startFrame) / totalSpan) * 100}%`,
                        background: 'rgba(147, 51, 234, 0.3)',
                        border: '1px dashed #7e22ce',
                        borderRadius: 3,
                        pointerEvents: 'none',
                        zIndex: 4,
                      }}
                    />
                    <div
                      title={`${loop.bridgeFrames} frames`}
                      style={{
                        position: 'absolute',
                        top: 2,
                        height: 20,
                        left: pct(loop.region.endFrame),
                        width: `${Math.min(100 - (loop.region.endFrame / totalSpan) * 100, (loop.bridgeFrames / totalSpan) * 100)}%`,
                        background:
                          'repeating-linear-gradient(45deg, rgba(168,85,247,0.4), rgba(168,85,247,0.4) 6px, rgba(147,51,234,0.7) 6px, rgba(147,51,234,0.7) 12px)',
                        border: '1px solid #6b21a8',
                        borderRadius: '0 3px 3px 0',
                        pointerEvents: 'none',
                        zIndex: 4,
                      }}
                    />
                  </>
                )
              )
            )}

            <div style={{ height: 24, position: 'relative', borderBottom: '1px solid #e5e7eb', background: '#fafafa' }}>
              {rulerTicks.map((f) => (
                <span
                  key={f}
                  style={{
                    position: 'absolute',
                    left: pct(f),
                    top: 4,
                    transform: f === maxFrames - 1 ? 'translateX(-100%)' : f === 0 ? 'none' : 'translateX(-50%)',
                    fontSize: 10,
                    color: '#6b7280',
                    fontFamily: 'monospace',
                    pointerEvents: 'none',
                  }}
                >
                  {f}
                </span>
              ))}
            </div>

            {isCameraMode ? (
              <div style={{ height: 36, position: 'relative' }} />
            ) : (
              <div
                onContextMenu={(e) => handleContextMenu(e, activeName)}
                style={{ height: 60, position: 'relative', borderBottom: '1px solid #e5e7eb' }}
              >
                <svg viewBox="0 0 1000 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}>
                  <line x1={0} y1={30} x2={1000} y2={30} stroke="#f3f4f6" strokeDasharray="4 4" />
                  {vmdCurvePath && (
                    <path
                      d={vmdCurvePath}
                      fill="none"
                      stroke={hasUserOverride ? '#cbd5e1' : '#0ea5e9'}
                      strokeWidth={hasUserOverride ? 1.5 : 2}
                      strokeDasharray={hasUserOverride ? '4 3' : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {curvePath && (
                    <path
                      d={curvePath}
                      fill="none"
                      stroke="#1677ff"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
                {activeTrack.keyframes.map((kf) => (
                  <div
                    key={kf.frame}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      seek(kf.frame);
                    }}
                    title={`F${kf.frame}: ${kf.value.toFixed(2)}`}
                    style={{
                      position: 'absolute',
                      left: pct(kf.frame),
                      top: `${((6 + (1 - kf.value) * 48) / 60) * 100}%`,
                      width: 9,
                      height: 9,
                      transform: 'translate(-50%, -50%)',
                      borderRadius: '50%',
                      background: kf.frame === currentFrame ? '#ef4444' : '#ffffff',
                      border: `2px solid ${kf.frame === currentFrame ? '#991b1b' : '#1677ff'}`,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            )}

            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: pct(currentFrame),
                width: 2,
                background: '#ef4444',
                transform: 'translateX(-1px)',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            />
          </div>
        </div>

        {/* 仅动作模式显示：VMD 原生表情 + 用户编辑轨道（支持右键快捷菜单） */}
        {!isCameraMode && (
          <div style={{ maxHeight: 175, overflowY: 'auto' }}>
            {vmdExpressionTracks.length === 0 && extraEditedTracks.length === 0 ? (
              <div style={{ padding: '8px 12px', fontSize: 11, color: '#9ca3af' }}>{t?.noVmdMorphTracks ?? 'No VMD facial morph tracks detected.'}</div>
            ) : (
              <>
                {vmdExpressionTracks.map((track, idx) => {
                  const color = TRACK_COLORS[idx % TRACK_COLORS.length];
                  const isSelected = activeName === track.name;
                  const ov = trackOverrideMap.get(track.name);
                  const isMuted = !!ov?.muted;
                  const isOverridden = !!ov?.overridden;

                  return (
                    <div
                      key={track.name}
                      onContextMenu={(e) => handleContextMenu(e, track.name)}
                      style={{
                        display: 'flex',
                        borderBottom: '1px solid #f0f0f0',
                        opacity: isMuted ? 0.55 : 1,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => exprState.setActiveName(track.name)}
                        title={`${track.name} (max ${track.maxWeight.toFixed(2)}, ${track.totalActiveFrames} frames)`}
                        style={{
                          width: 136,
                          flexShrink: 0,
                          height: 26,
                          padding: '0 8px',
                          border: 'none',
                          borderRight: '1px solid #e5e7eb',
                          background: isSelected ? '#eff6ff' : '#f9fafb',
                          color: isMuted ? '#9ca3af' : isSelected ? '#1d4ed8' : '#374151',
                          fontWeight: isSelected ? 700 : 500,
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 4,
                          cursor: 'pointer',
                        }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textDecoration: isMuted ? 'line-through' : 'none',
                          }}
                        >
                          {track.name}
                        </span>
                        {isMuted ? (
                          <span style={{ fontSize: 9, color: '#dc2626', fontWeight: 700, flexShrink: 0 }}>0</span>
                        ) : isOverridden ? (
                          <span style={{ fontSize: 9, color: '#15803d', fontWeight: 700, flexShrink: 0 }}>
                            [{ov?.kfCount}]
                          </span>
                        ) : null}
                      </button>

                      <div
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                          exprState.setActiveName(track.name);
                          seek(Math.round(ratio * totalSpan));
                        }}
                        style={{ flex: 1, position: 'relative', height: 26, background: isSelected ? '#f8fafc' : '#ffffff', cursor: 'pointer' }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: pct(currentFrame),
                            width: 1.5,
                            background: 'rgba(239, 68, 68, 0.55)',
                            pointerEvents: 'none',
                            zIndex: 3,
                          }}
                        />
                        {track.clips.map((clip, cIdx) => {
                          const spanPct = ((clip.endFrame - clip.startFrame) / totalSpan) * 100;
                          return (
                            <div
                              key={cIdx}
                              onClick={(e) => {
                                e.stopPropagation();
                                exprState.setActiveName(track.name);
                                seek(clip.peakFrame);
                              }}
                              title={`${track.name}: F${clip.startFrame}–F${clip.endFrame} (Peak F${clip.peakFrame}: ${clip.peakWeight.toFixed(2)})`}
                              style={{
                                position: 'absolute',
                                left: pct(clip.startFrame),
                                width: `${spanPct}%`,
                                minWidth: 5,
                                top: 3,
                                bottom: 3,
                                borderRadius: 3,
                                background: isMuted ? '#cbd5e1' : color,
                                opacity: isSelected ? 1 : 0.8,
                                color: '#ffffff',
                                fontSize: 10,
                                lineHeight: '20px',
                                padding: '0 4px',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                                boxSizing: 'border-box',
                                cursor: 'pointer',
                                zIndex: 2,
                              }}
                            >
                              {spanPct > 6 ? `F${clip.startFrame}-${clip.endFrame} (${clip.peakWeight.toFixed(1)})` : ''}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {extraEditedTracks.map((tr) => {
                  const isSelected = activeName === tr.name;
                  const firstF = tr.keyframes[0]?.frame ?? 0;
                  const lastF = tr.keyframes[tr.keyframes.length - 1]?.frame ?? firstF;
                  const spanPct = ((lastF - firstF) / totalSpan) * 100;
                  return (
                    <div
                      key={tr.name}
                      onContextMenu={(e) => handleContextMenu(e, tr.name)}
                      style={{ display: 'flex', borderBottom: '1px solid #f0f0f0' }}
                    >
                      <button
                        type="button"
                        onClick={() => exprState.setActiveName(tr.name)}
                        style={{
                          width: 136,
                          flexShrink: 0,
                          height: 26,
                          padding: '0 8px',
                          border: 'none',
                          borderRight: '1px solid #e5e7eb',
                          background: isSelected ? '#eff6ff' : '#f0fdf4',
                          color: isSelected ? '#1d4ed8' : '#047857',
                          fontWeight: 600,
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 4,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tr.name}
                        </span>
                        <span style={{ fontSize: 9, flexShrink: 0 }}>[{tr.keyframes.length}]</span>
                      </button>
                      <div
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                          exprState.setActiveName(tr.name);
                          seek(Math.round(ratio * totalSpan));
                        }}
                        style={{ flex: 1, position: 'relative', height: 26, background: isSelected ? '#f8fafc' : '#ffffff', cursor: 'pointer' }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: pct(firstF),
                            width: `${spanPct}%`,
                            minWidth: 6,
                            top: 4,
                            bottom: 4,
                            borderRadius: 3,
                            background: '#10b981',
                            opacity: 0.75,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
};
