// src/hooks/useExpressionTracks.ts
import { useCallback, useMemo, useState } from 'react';
import { isPresetExpression, resolveExpressionTarget } from '../types/expressionMapping';
import {
    evaluateExpressionTrackAtFrame,
    ExpressionInterpolation,
    ExpressionKeyframe,
    ExpressionTrack,
    generateAutoBlinkKeyframes,
} from '../utils/expressionTrackEvaluator';

export interface ExpressionTracksController {
  tracks: ExpressionTrack[];
  activeName: string;
  activeTrack: ExpressionTrack;
  customTrackNames: string[];
  setActiveName: (name: string) => void;
  upsertKeyframe: (name: string, frame: number, value: number) => void;
  removeKeyframe: (name: string, frame: number) => void;
  setInterpolation: (name: string, interpolation: ExpressionInterpolation) => void;
  setTrackKeyframes: (
    name: string,
    keyframes: ExpressionKeyframe[],
    interpolation?: ExpressionInterpolation
  ) => void;
  muteTrack: (name: string, maxFrames: number) => void;
  extractVmdTrack: (
    name: string,
    maxFrames: number,
    getVmdValueAtFrame: (frame: number) => number
  ) => ExpressionKeyframe[];
  replaceTrack: (
    sourceName: string,
    targetName: string,
    maxFrames: number,
    getVmdValueAtFrame: (frame: number) => number,
    options?: { mode?: 'move' | 'copy'; isSourceVmd?: boolean }
  ) => void;
  clearTrack: (name: string) => void;
  clearAllTracks: () => void;
  applyAutoBlink: (startFrame: number, endFrame: number, fps: number) => void;
  applyConstantRange: (name: string, startFrame: number, endFrame: number, value: number) => void;
  addCustomTrack: (rawName: string) => void;
  removeCustomTrack: (name: string) => void;
  isTrackOverridden: (name: string) => boolean;
  isTrackMuted: (name: string) => boolean;
  getValueAtFrame: (name: string, frame: number) => number;
}

const DEFAULT_TRACK = (
  name: string,
  interpolation: ExpressionInterpolation = 'smooth'
): ExpressionTrack => ({
  name,
  interpolation,
  keyframes: [],
});

function normalizeKeyframes(keyframes: ExpressionKeyframe[]): ExpressionKeyframe[] {
  const byFrame = new Map<number, number>();
  for (const kf of keyframes) {
    const safeFrame = Math.max(0, Math.round(kf.frame));
    const clampedVal = Number(Math.max(0, Math.min(1, kf.value)).toFixed(2));
    byFrame.set(safeFrame, clampedVal);
  }
  return Array.from(byFrame.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([frame, value]) => ({ frame, value }));
}

/**
 * 使用迭代版 Douglas-Peucker 将逐帧 VMD 权重序列压缩为稀疏可编辑关键帧
 */
export function simplifyWeightSeriesToKeyframes(
  values: number[],
  epsilon: number = 0.025
): ExpressionKeyframe[] {
  const n = values.length;
  if (n === 0) return [];

  let hasActive = false;
  for (let i = 0; i < n; i++) {
    if (values[i] > 1e-4) {
      hasActive = true;
      break;
    }
  }
  if (!hasActive) {
    return [{ frame: 0, value: 0 }];
  }
  if (n === 1) {
    return [{ frame: 0, value: Number(Math.max(0, Math.min(1, values[0])).toFixed(2)) }];
  }

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start <= 1) continue;

    const vStart = values[start];
    const vEnd = values[end];
    const span = end - start;

    let maxDist = -1;
    let maxIdx = -1;

    for (let i = start + 1; i < end; i++) {
      const t = (i - start) / span;
      const interp = vStart + (vEnd - vStart) * t;
      const dist = Math.abs(values[i] - interp);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon && maxIdx > start && maxIdx < end) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const raw: ExpressionKeyframe[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      raw.push({
        frame: i,
        value: Number(Math.max(0, Math.min(1, values[i])).toFixed(2)),
      });
    }
  }

  // 去掉首尾冗余的连续 0（保留紧贴变化沿的那一个 0）
  while (raw.length > 2 && raw[0].value === 0 && raw[1].value === 0) {
    raw.shift();
  }
  while (
    raw.length > 2 &&
    raw[raw.length - 1].value === 0 &&
    raw[raw.length - 2].value === 0
  ) {
    raw.pop();
  }

  return normalizeKeyframes(raw);
}

export function useExpressionTracks(): ExpressionTracksController {
  const [tracks, setTracks] = useState<ExpressionTrack[]>([]);
  const [activeName, setActiveName] = useState<string>('blink');
  const [customTrackNames, setCustomTrackNames] = useState<string[]>([]);
  const [interpPrefs, setInterpPrefs] = useState<Record<string, ExpressionInterpolation>>({});

  const trackMap = useMemo(() => {
    const map = new Map<string, ExpressionTrack>();
    tracks.forEach((t) => map.set(t.name, t));
    return map;
  }, [tracks]);

  const activeTrack = useMemo(() => {
    return trackMap.get(activeName) || DEFAULT_TRACK(activeName, interpPrefs[activeName] || 'smooth');
  }, [trackMap, activeName, interpPrefs]);

  const updateTrack = useCallback(
    (name: string, updater: (prev: ExpressionTrack) => ExpressionTrack) => {
      setTracks((prevList) => {
        const idx = prevList.findIndex((t) => t.name === name);
        const base =
          idx >= 0 ? prevList[idx] : DEFAULT_TRACK(name, interpPrefs[name] || 'smooth');
        const next = updater(base);

        // 若无关键帧则从 override 列表中移除，还原底层 VMD 数据
        if (next.keyframes.length === 0) {
          return idx >= 0 ? prevList.filter((_, i) => i !== idx) : prevList;
        }
        if (idx >= 0) {
          const copy = [...prevList];
          copy[idx] = next;
          return copy;
        }
        return [...prevList, next];
      });
    },
    [interpPrefs]
  );

  const upsertKeyframe = useCallback(
    (name: string, frame: number, value: number) => {
      const clampedVal = Number(Math.max(0, Math.min(1, value)).toFixed(2));
      const safeFrame = Math.max(0, Math.round(frame));

      updateTrack(name, (prev) => {
        const filtered = prev.keyframes.filter((k) => k.frame !== safeFrame);
        const nextKeyframes = [...filtered, { frame: safeFrame, value: clampedVal }].sort(
          (a, b) => a.frame - b.frame
        );
        return { ...prev, keyframes: nextKeyframes };
      });
    },
    [updateTrack]
  );

  const removeKeyframe = useCallback(
    (name: string, frame: number) => {
      updateTrack(name, (prev) => ({
        ...prev,
        keyframes: prev.keyframes.filter((k) => k.frame !== frame),
      }));
    },
    [updateTrack]
  );

  const setInterpolation = useCallback(
    (name: string, interpolation: ExpressionInterpolation) => {
      setInterpPrefs((prev) => ({ ...prev, [name]: interpolation }));
      setTracks((prevList) => {
        const idx = prevList.findIndex((t) => t.name === name);
        if (idx < 0) return prevList;
        const copy = [...prevList];
        copy[idx] = { ...copy[idx], interpolation };
        return copy;
      });
    },
    []
  );

  const setTrackKeyframes = useCallback(
    (name: string, keyframes: ExpressionKeyframe[], interpolation?: ExpressionInterpolation) => {
      const normalized = normalizeKeyframes(keyframes);
      if (interpolation) {
        setInterpPrefs((prev) => ({ ...prev, [name]: interpolation }));
      }
      updateTrack(name, (prev) => ({
        ...prev,
        interpolation: interpolation ?? prev.interpolation,
        keyframes: normalized,
      }));
    },
    [updateTrack]
  );

  const muteTrack = useCallback(
    (name: string, maxFrames: number) => {
      const lastFrame = Math.max(0, maxFrames - 1);
      const zeroKeyframes: ExpressionKeyframe[] =
        lastFrame > 0
          ? [
              { frame: 0, value: 0 },
              { frame: lastFrame, value: 0 },
            ]
          : [{ frame: 0, value: 0 }];
      setTrackKeyframes(name, zeroKeyframes, 'step');
    },
    [setTrackKeyframes]
  );

  const extractVmdTrack = useCallback(
    (name: string, maxFrames: number, getVmdValueAtFrame: (frame: number) => number) => {
      const count = Math.max(1, maxFrames);
      const values = new Array<number>(count);
      for (let f = 0; f < count; f++) {
        values[f] = getVmdValueAtFrame(f);
      }
      const simplified = simplifyWeightSeriesToKeyframes(values);
      setTrackKeyframes(name, simplified, 'linear');
      return simplified;
    },
    [setTrackKeyframes]
  );

  const replaceTrack = useCallback(
    (
      sourceName: string,
      targetName: string,
      maxFrames: number,
      getVmdValueAtFrame: (frame: number) => number,
      options?: { mode?: 'move' | 'copy'; isSourceVmd?: boolean }
    ) => {
      const target = targetName.trim();
      if (!target || target === sourceName) return;

      const mode = options?.mode ?? 'move';
      const isSourceVmd = options?.isSourceVmd ?? false;
      const sourceTrack = trackMap.get(sourceName);

      let nextKeyframes: ExpressionKeyframe[];
      let nextInterp: ExpressionInterpolation = 'linear';

      if (sourceTrack && sourceTrack.keyframes.length > 0) {
        nextKeyframes = sourceTrack.keyframes.map((k) => ({ ...k }));
        nextInterp = sourceTrack.interpolation;
      } else {
        const count = Math.max(1, maxFrames);
        const values = new Array<number>(count);
        for (let f = 0; f < count; f++) {
          values[f] = getVmdValueAtFrame(f);
        }
        nextKeyframes = simplifyWeightSeriesToKeyframes(values);
      }

      if (!isPresetExpression(target)) {
        setCustomTrackNames((prev) => (prev.includes(target) ? prev : [...prev, target]));
      }

      setTrackKeyframes(target, nextKeyframes, nextInterp);

      if (mode === 'move') {
        if (isSourceVmd) {
          muteTrack(sourceName, maxFrames);
        } else {
          setTracks((prev) => prev.filter((t) => t.name !== sourceName));
        }
      }

      setActiveName(target);
    },
    [trackMap, setTrackKeyframes, muteTrack]
  );

  const clearTrack = useCallback((name: string) => {
    setTracks((prev) => prev.filter((t) => t.name !== name));
  }, []);

  const clearAllTracks = useCallback(() => {
    setTracks([]);
  }, []);

  const applyAutoBlink = useCallback(
    (startFrame: number, endFrame: number, fps: number) => {
      const keyframes = generateAutoBlinkKeyframes(startFrame, endFrame, fps);
      setActiveName('blink');
      updateTrack('blink', (prev) => ({
        ...prev,
        interpolation: 'smooth',
        keyframes,
      }));
    },
    [updateTrack]
  );

  const applyConstantRange = useCallback(
    (name: string, startFrame: number, endFrame: number, value: number) => {
      const clampedVal = Number(Math.max(0, Math.min(1, value)).toFixed(2));
      const safeStart = Math.max(0, Math.round(startFrame));
      const safeEnd = Math.max(safeStart, Math.round(endFrame));
      const keyframes: ExpressionKeyframe[] =
        safeStart === safeEnd
          ? [{ frame: safeStart, value: clampedVal }]
          : [
              { frame: safeStart, value: clampedVal },
              { frame: safeEnd, value: clampedVal },
            ];
      updateTrack(name, (prev) => ({ ...prev, keyframes }));
    },
    [updateTrack]
  );

  const addCustomTrack = useCallback((rawName: string) => {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    const { key, isPreset } = resolveExpressionTarget(trimmed);
    if (!isPreset) {
      setCustomTrackNames((prev) => (prev.includes(key) ? prev : [...prev, key]));
    }
    setActiveName(key);
  }, []);

  const removeCustomTrack = useCallback((name: string) => {
    setCustomTrackNames((prev) => prev.filter((n) => n !== name));
    setTracks((prev) => prev.filter((t) => t.name !== name));
  }, []);

  const isTrackOverridden = useCallback(
    (name: string) => {
      const track = trackMap.get(name);
      return !!track && track.keyframes.length > 0;
    },
    [trackMap]
  );

  const isTrackMuted = useCallback(
    (name: string) => {
      const track = trackMap.get(name);
      return !!track && track.keyframes.length > 0 && track.keyframes.every((k) => k.value <= 1e-4);
    },
    [trackMap]
  );

  const getValueAtFrame = useCallback(
    (name: string, frame: number) => {
      const track = trackMap.get(name);
      return track ? evaluateExpressionTrackAtFrame(track, frame) : 0;
    },
    [trackMap]
  );

  return {
    tracks,
    activeName,
    activeTrack,
    customTrackNames,
    setActiveName,
    upsertKeyframe,
    removeKeyframe,
    setInterpolation,
    setTrackKeyframes,
    muteTrack,
    extractVmdTrack,
    replaceTrack,
    clearTrack,
    clearAllTracks,
    applyAutoBlink,
    applyConstantRange,
    addCustomTrack,
    removeCustomTrack,
    isTrackOverridden,
    isTrackMuted,
    getValueAtFrame,
  };
}
