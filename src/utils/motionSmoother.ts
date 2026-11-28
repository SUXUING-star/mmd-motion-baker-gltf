// src/utils/motionSmoother.ts
import * as THREE from 'three';
import { LandmarkData, LandmarkFrame } from '../types/types';
import { computeMmdScaleAndClearance } from './rootPostProcess';

export type TargetFpsMode = 'raw' | '2x' | '60' | '120';

export interface MotionSmoothConfig {
  /** 自动检测并修复中间丢帧 / 重复冻结帧 */
  repairDroppedFrames: boolean;
  /** 丢帧判定阈值（米，默认 0.004m = 4mm） */
  dropThreshold: number;
  /** 连续冻结最多修补帧数（超过该长度视为真实停顿定格，不强行抹平） */
  maxDropGap: number;
  /** 平滑滤波强度 0 ~ 100 */
  smoothStrength: number;
  /** 补帧输出帧率模式 */
  fpsMode: TargetFpsMode;
}

export const DEFAULT_MOTION_SMOOTH: MotionSmoothConfig = {
  repairDroppedFrames: false,
  dropThreshold: 0.004,
  maxDropGap: 4,
  smoothStrength: 0,
  fpsMode: 'raw',
};

export interface MotionSmoothStats {
  rawFps: number;
  rawFrameCount: number;
  detectedDroppedFrames: number;
  outputFps: number;
  outputFrameCount: number;
}

export interface MotionSmoothResult {
  data: LandmarkData;
  stats: MotionSmoothStats;
}

const TRACKED_BODY_KEYS = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
];

export function isMotionSmoothActive(cfg?: MotionSmoothConfig | null): boolean {
  if (!cfg) return false;
  return cfg.repairDroppedFrames || cfg.smoothStrength > 0 || cfg.fpsMode !== 'raw';
}

export function resolveTargetFps(rawFps: number, mode: TargetFpsMode): number {
  const base = rawFps > 0 ? rawFps : 30;
  switch (mode) {
    case '2x':
      return Math.round(base * 2);
    case '60':
      return 60;
    case '120':
      return 120;
    case 'raw':
    default:
      return base;
  }
}

/**
 * 检测丢帧/步进卡顿帧索引：短时停滞（1 ~ maxDropGap 帧）且紧接着发生明显位移的帧视为丢帧填充
 */
export function detectDroppedFrameIndices(
  frames: LandmarkFrame[],
  scaleFactor: number,
  dropThresholdMeters = 0.004,
  maxDropGap = 4
): Set<number> {
  const dropped = new Set<number>();
  const n = frames.length;
  if (n < 4) return dropped;

  const firstLm = frames[0].landmarks;
  const candidateKeys = TRACKED_BODY_KEYS.filter((k) => Boolean(firstLm[k]));
  const keys = candidateKeys.length >= 4 ? candidateKeys : Object.keys(firstLm);
  if (keys.length === 0) return dropped;

  const maxMoveMeters = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const prev = frames[i - 1].landmarks;
    const curr = frames[i].landmarks;
    let maxD2 = 0;
    for (const k of keys) {
      const a = prev[k];
      const b = curr[k];
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxD2) maxD2 = d2;
    }
    maxMoveMeters[i] = Math.sqrt(maxD2) * scaleFactor;
  }

  let i = 1;
  while (i < n - 1) {
    if (maxMoveMeters[i] <= dropThresholdMeters) {
      const runStart = i;
      let runEnd = i;
      while (runEnd + 1 < n - 1 && maxMoveMeters[runEnd + 1] <= dropThresholdMeters) {
        runEnd++;
      }
      const runLen = runEnd - runStart + 1;
      // 只有短时冻结且之后恢复明显运动时，才认定为丢帧重复区间
      if (runLen <= maxDropGap && maxMoveMeters[runEnd + 1] > dropThresholdMeters * 1.5) {
        for (let k = runStart; k <= runEnd; k++) {
          dropped.add(k);
        }
      }
      i = runEnd + 1;
    } else {
      i++;
    }
  }

  return dropped;
}

/**
 * 非均匀时间网格上的保单调三次埃尔米特样条 (PCHIP)，避免曲线过冲与脚底穿模
 */
function computePchipTangents(times: number[], values: Float32Array): Float32Array {
  const m = times.length;
  const tangents = new Float32Array(m);
  if (m < 2) return tangents;

  if (m === 2) {
    const dt = Math.max(1e-6, times[1] - times[0]);
    const slope = (values[1] - values[0]) / dt;
    tangents[0] = slope;
    tangents[1] = slope;
    return tangents;
  }

  const slopes = new Float32Array(m - 1);
  const dts = new Float32Array(m - 1);
  for (let i = 0; i < m - 1; i++) {
    const dt = Math.max(1e-6, times[i + 1] - times[i]);
    dts[i] = dt;
    slopes[i] = (values[i + 1] - values[i]) / dt;
  }

  for (let i = 1; i < m - 1; i++) {
    const d0 = slopes[i - 1];
    const d1 = slopes[i];
    if (d0 * d1 <= 0) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * dts[i] + dts[i - 1];
      const w2 = dts[i] + 2 * dts[i - 1];
      tangents[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
    }
  }

  tangents[0] = slopes[0];
  tangents[m - 1] = slopes[m - 2];
  return tangents;
}

function evaluatePchipAtInterval(
  times: number[],
  values: Float32Array,
  tangents: Float32Array,
  segIdx: number,
  t: number
): number {
  const t0 = times[segIdx];
  const t1 = times[segIdx + 1];
  const h = Math.max(1e-6, t1 - t0);
  const u = Math.max(0, Math.min(1, (t - t0) / h));
  const u2 = u * u;
  const u3 = u2 * u;

  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  return (
    h00 * values[segIdx] +
    h10 * h * tangents[segIdx] +
    h01 * values[segIdx + 1] +
    h11 * h * tangents[segIdx + 1]
  );
}

/**
 * 使用 PCHIP 样条在指定输出时间序列上插值重建 landmarks 与表情
 */
function interpolateFramesWithPchip(
  anchorFrames: LandmarkFrame[],
  anchorTimes: number[],
  targetTimes: number[]
): LandmarkFrame[] {
  const m = anchorFrames.length;
  const outCount = targetTimes.length;
  if (m === 0 || outCount === 0) return [];
  if (m === 1) {
    return targetTimes.map((t) => ({ ...anchorFrames[0], time: t }));
  }

  // 收集所有出现过的骨骼键名
  const boneKeySet = new Set<string>();
  anchorFrames.forEach((f) => Object.keys(f.landmarks).forEach((k) => boneKeySet.add(k)));
  const boneKeys = Array.from(boneKeySet);

  // 为每个目标时间找到所属锚点区间 [segIdx, segIdx + 1]
  const segIndices = new Int32Array(outCount);
  let cursor = 0;
  for (let j = 0; j < outCount; j++) {
    const t = targetTimes[j];
    while (cursor + 1 < m - 1 && anchorTimes[cursor + 1] < t) {
      cursor++;
    }
    segIndices[j] = cursor;
  }

  // 预分配输出 landmarks
  const outLandmarks: Array<Record<string, [number, number, number]>> = Array.from(
    { length: outCount },
    () => ({})
  );

  const xs = new Float32Array(m);
  const ys = new Float32Array(m);
  const zs = new Float32Array(m);

  for (const key of boneKeys) {
    let valid = true;
    for (let i = 0; i < m; i++) {
      const p = anchorFrames[i].landmarks[key];
      if (!p) {
        valid = false;
        break;
      }
      xs[i] = p[0];
      ys[i] = p[1];
      zs[i] = p[2];
    }

    if (!valid) {
      for (let j = 0; j < outCount; j++) {
        const s = segIndices[j];
        const fallback = anchorFrames[s].landmarks[key] || anchorFrames[s + 1]?.landmarks[key];
        if (fallback) {
          outLandmarks[j][key] = [fallback[0], fallback[1], fallback[2]];
        }
      }
      continue;
    }

    const tx = computePchipTangents(anchorTimes, xs);
    const ty = computePchipTangents(anchorTimes, ys);
    const tz = computePchipTangents(anchorTimes, zs);

    for (let j = 0; j < outCount; j++) {
      const s = segIndices[j];
      const t = targetTimes[j];
      outLandmarks[j][key] = [
        Number(evaluatePchipAtInterval(anchorTimes, xs, tx, s, t).toFixed(4)),
        Number(evaluatePchipAtInterval(anchorTimes, ys, ty, s, t).toFixed(4)),
        Number(evaluatePchipAtInterval(anchorTimes, zs, tz, s, t).toFixed(4)),
      ];
    }
  }

  // 线性插值表情权重与辅助预览时间
  const hasExpressions = anchorFrames.some((f) => Boolean(f.expressions));
  const outFrames: LandmarkFrame[] = new Array(outCount);

  for (let j = 0; j < outCount; j++) {
    const s = segIndices[j];
    const t = targetTimes[j];
    const t0 = anchorTimes[s];
    const t1 = anchorTimes[s + 1];
    const alpha = Math.max(0, Math.min(1, t1 - t0 > 1e-6 ? (t - t0) / (t1 - t0) : 0));

    const fA = anchorFrames[s];
    const fB = anchorFrames[s + 1];

    let expressions: Record<string, number> | undefined;
    if (hasExpressions) {
      expressions = {};
      const eA = fA.expressions || {};
      const eB = fB.expressions || {};
      const eKeys = new Set([...Object.keys(eA), ...Object.keys(eB)]);
      for (const ek of eKeys) {
        const va = eA[ek] ?? 0;
        const vb = eB[ek] ?? 0;
        const v = va + (vb - va) * alpha;
        if (v > 1e-4) {
          expressions[ek] = Number(Math.max(0, Math.min(1, v)).toFixed(4));
        }
      }
    }

    const prevTimeA = fA.previewTime ?? fA.time;
    const prevTimeB = fB.previewTime ?? fB.time;
    const previewTime =
      fA.previewTime !== undefined || fB.previewTime !== undefined
        ? Number((prevTimeA + (prevTimeB - prevTimeA) * alpha).toFixed(4))
        : undefined;

    outFrames[j] = {
      time: Number(t.toFixed(4)),
      landmarks: outLandmarks[j],
      ...(expressions ? { expressions } : {}),
      ...(previewTime !== undefined ? { previewTime } : {}),
      ...(alpha < 0.5 ? (fA.previewBlendTarget ? { previewBlendTarget: fA.previewBlendTarget } : {}) : (fB.previewBlendTarget ? { previewBlendTarget: fB.previewBlendTarget } : {})),
    };
  }

  return outFrames;
}

/**
 * 对 Landmark 序列施加高斯时域平滑
 */
function smoothLandmarkFramesGaussian(
  frames: LandmarkFrame[],
  smoothStrength: number
): LandmarkFrame[] {
  const n = frames.length;
  if (n < 3 || smoothStrength <= 0) return frames;

  const alpha = Math.max(0, Math.min(1, smoothStrength / 100));
  const sigma = 0.45 + alpha * 1.45;
  const radius = Math.max(1, Math.ceil(sigma * 2));
  const blend = Math.min(1, alpha * 1.15);

  const weights = new Float32Array(radius * 2 + 1);
  let wSum = 0;
  for (let d = -radius; d <= radius; d++) {
    const w = Math.exp(-0.5 * (d / sigma) * (d / sigma));
    weights[d + radius] = w;
    wSum += w;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= wSum;

  const keys = Object.keys(frames[0].landmarks);
  const smoothedLandmarks: Array<Record<string, [number, number, number]>> = frames.map((f) => ({
    ...f.landmarks,
  }));

  for (const key of keys) {
    let allPresent = true;
    for (let i = 0; i < n; i++) {
      if (!frames[i].landmarks[key]) {
        allPresent = false;
        break;
      }
    }
    if (!allPresent) continue;

    for (let i = 0; i < n; i++) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let d = -radius; d <= radius; d++) {
        const idx = Math.max(0, Math.min(n - 1, i + d));
        const p = frames[idx].landmarks[key];
        const w = weights[d + radius];
        sx += p[0] * w;
        sy += p[1] * w;
        sz += p[2] * w;
      }
      const orig = frames[i].landmarks[key];
      smoothedLandmarks[i][key] = [
        Number((orig[0] + (sx - orig[0]) * blend).toFixed(4)),
        Number((orig[1] + (sy - orig[1]) * blend).toFixed(4)),
        Number((orig[2] + (sz - orig[2]) * blend).toFixed(4)),
      ];
    }
  }

  return frames.map((f, i) => ({
    ...f,
    landmarks: smoothedLandmarks[i],
  }));
}

/**
 * 综合后处理：丢帧修复 + 时域高斯平滑 + 高帧率插值补帧
 */
export function applyMotionSmoothing(
  rawData: LandmarkData,
  cfg: MotionSmoothConfig
): MotionSmoothResult {
  const rawFrames = rawData.frames;
  const rawFps = rawData.fps || 30;
  const rawCount = rawFrames.length;

  if (rawCount < 2) {
    return {
      data: rawData,
      stats: {
        rawFps,
        rawFrameCount: rawCount,
        detectedDroppedFrames: 0,
        outputFps: rawFps,
        outputFrameCount: rawCount,
      },
    };
  }

  const { scaleFactor } = computeMmdScaleAndClearance(rawData);
  const droppedSet = detectDroppedFrameIndices(
    rawFrames,
    scaleFactor,
    cfg.dropThreshold,
    cfg.maxDropGap
  );

  const outputFps = resolveTargetFps(rawFps, cfg.fpsMode);

  if (!isMotionSmoothActive(cfg)) {
    return {
      data: rawData,
      stats: {
        rawFps,
        rawFrameCount: rawCount,
        detectedDroppedFrames: droppedSet.size,
        outputFps: rawFps,
        outputFrameCount: rawCount,
      },
    };
  }

  // 1. 构建有效锚点帧（若开启丢帧修复且检测到丢帧，则剔除冻结帧）
  const rawTimes = rawFrames.map((f, idx) =>
    Number.isFinite(f.time) ? f.time : idx / rawFps
  );

  let workingFrames = rawFrames;
  let workingTimes = rawTimes;

  if (cfg.repairDroppedFrames && droppedSet.size > 0) {
    const anchors: LandmarkFrame[] = [];
    const anchorTimes: number[] = [];
    for (let i = 0; i < rawCount; i++) {
      if (!droppedSet.has(i) || i === 0 || i === rawCount - 1) {
        anchors.push(rawFrames[i]);
        anchorTimes.push(rawTimes[i]);
      }
    }
    if (anchors.length >= 2) {
      workingFrames = interpolateFramesWithPchip(anchors, anchorTimes, rawTimes);
      workingTimes = rawTimes;
    }
  }

  // 2. 在原帧率上应用高斯平滑滤波
  if (cfg.smoothStrength > 0) {
    workingFrames = smoothLandmarkFramesGaussian(workingFrames, cfg.smoothStrength);
  }

  // 3. 若需要提升帧率，使用 PCHIP 对完整时间跨度重采样补帧
  if (cfg.fpsMode !== 'raw' && outputFps !== rawFps) {
    const totalDuration = Math.max(
      workingTimes[workingTimes.length - 1] - workingTimes[0],
      (rawCount - 1) / rawFps
    );
    const outCount = Math.max(2, Math.round(totalDuration * outputFps) + 1);
    const tStart = workingTimes[0];
    const targetTimes: number[] = new Array(outCount);
    for (let j = 0; j < outCount; j++) {
      targetTimes[j] = tStart + (j / (outCount - 1)) * totalDuration;
    }
    workingFrames = interpolateFramesWithPchip(workingFrames, workingTimes, targetTimes);
  }

  const normalizedFrames: LandmarkFrame[] = workingFrames.map((f, idx) => ({
    ...f,
    time: idx / outputFps,
  }));

  const finalDuration =
    normalizedFrames.length > 0
      ? normalizedFrames[normalizedFrames.length - 1].time
      : 0;

  return {
    data: {
      ...rawData,
      fps: outputFps,
      totalFrames: normalizedFrames.length,
      duration: finalDuration,
      frames: normalizedFrames,
    },
    stats: {
      rawFps,
      rawFrameCount: rawCount,
      detectedDroppedFrames: droppedSet.size,
      outputFps,
      outputFrameCount: normalizedFrames.length,
    },
  };
}

/**
 * 可选：同步平滑补帧 VMD AnimationClip（用于 useThreeScene 支持 updateAnimationClip 时同步 PMX 网格预览）
 */
export function smoothAnimationClip(
  rawClip: THREE.AnimationClip,
  cfg: MotionSmoothConfig,
  srcFps = 30
): THREE.AnimationClip {
  if (!isMotionSmoothActive(cfg)) return rawClip;

  const duration = rawClip.duration;
  if (duration <= 0) return rawClip;

  const outFps = resolveTargetFps(srcFps, cfg.fpsMode);
  const srcCount = Math.max(2, Math.round(duration * srcFps) + 1);
  const outCount = cfg.fpsMode === 'raw' ? srcCount : Math.max(2, Math.round(duration * outFps) + 1);

  const outTimes = new Float32Array(outCount);
  for (let i = 0; i < outCount; i++) {
    outTimes[i] = (i / (outCount - 1)) * duration;
  }

  const alpha = Math.max(0, Math.min(1, cfg.smoothStrength / 100));
  const sigma = 0.45 + alpha * 1.45;
  const radius = Math.max(1, Math.ceil(sigma * 2));
  const blend = Math.min(1, alpha * 1.15);

  const newTracks: THREE.KeyframeTrack[] = [];

  for (const track of rawClip.tracks) {
    const dim = track.getValueSize();
    const interpolant = track.createInterpolant();
    const sampled = new Float32Array(srcCount * dim);

    for (let i = 0; i < srcCount; i++) {
      const t = (i / (srcCount - 1)) * duration;
      const val = interpolant.evaluate(t);
      for (let c = 0; c < dim; c++) {
        sampled[i * dim + c] = val[c];
      }
    }

    // 四元数轨道：保证同半球连续 + 高斯混合平滑 + SLERP 补帧
    if (track instanceof THREE.QuaternionKeyframeTrack && dim === 4) {
      for (let i = 1; i < srcCount; i++) {
        const i4 = i * 4;
        const p4 = (i - 1) * 4;
        const dot =
          sampled[i4] * sampled[p4] +
          sampled[i4 + 1] * sampled[p4 + 1] +
          sampled[i4 + 2] * sampled[p4 + 2] +
          sampled[i4 + 3] * sampled[p4 + 3];
        if (dot < 0) {
          sampled[i4] = -sampled[i4];
          sampled[i4 + 1] = -sampled[i4 + 1];
          sampled[i4 + 2] = -sampled[i4 + 2];
          sampled[i4 + 3] = -sampled[i4 + 3];
        }
      }

      const smoothed = new Float32Array(sampled);
      if (cfg.smoothStrength > 0) {
        const qOrig = new THREE.Quaternion();
        const qAvg = new THREE.Quaternion();
        for (let i = 0; i < srcCount; i++) {
          let ax = 0, ay = 0, az = 0, aw = 0;
          const base4 = i * 4;
          const bx = sampled[base4], by = sampled[base4 + 1], bz = sampled[base4 + 2], bw = sampled[base4 + 3];
          for (let d = -radius; d <= radius; d++) {
            const idx = Math.max(0, Math.min(srcCount - 1, i + d));
            const w = Math.exp(-0.5 * (d / sigma) * (d / sigma));
            const j4 = idx * 4;
            const dot = sampled[j4] * bx + sampled[j4 + 1] * by + sampled[j4 + 2] * bz + sampled[j4 + 3] * bw;
            const sgn = dot < 0 ? -1 : 1;
            ax += sampled[j4] * sgn * w;
            ay += sampled[j4 + 1] * sgn * w;
            az += sampled[j4 + 2] * sgn * w;
            aw += sampled[j4 + 3] * sgn * w;
          }
          qOrig.set(bx, by, bz, bw).normalize();
          qAvg.set(ax, ay, az, aw).normalize();
          qOrig.slerp(qAvg, blend);
          smoothed[base4] = qOrig.x;
          smoothed[base4 + 1] = qOrig.y;
          smoothed[base4 + 2] = qOrig.z;
          smoothed[base4 + 3] = qOrig.w;
        }
      }

      const outVals = new Float32Array(outCount * 4);
      const qA = new THREE.Quaternion();
      const qB = new THREE.Quaternion();
      for (let j = 0; j < outCount; j++) {
        const pos = (j / (outCount - 1)) * (srcCount - 1);
        const i0 = Math.floor(pos);
        const i1 = Math.min(srcCount - 1, i0 + 1);
        const f = pos - i0;
        qA.set(smoothed[i0 * 4], smoothed[i0 * 4 + 1], smoothed[i0 * 4 + 2], smoothed[i0 * 4 + 3]);
        qB.set(smoothed[i1 * 4], smoothed[i1 * 4 + 1], smoothed[i1 * 4 + 2], smoothed[i1 * 4 + 3]);
        qA.slerp(qB, f);
        outVals[j * 4] = qA.x;
        outVals[j * 4 + 1] = qA.y;
        outVals[j * 4 + 2] = qA.z;
        outVals[j * 4 + 3] = qA.w;
      }
      newTracks.push(new THREE.QuaternionKeyframeTrack(track.name, outTimes, outVals));
    } else {
      // Vector / Number 轨道
      const smoothed = new Float32Array(sampled);
      if (cfg.smoothStrength > 0 && track instanceof THREE.VectorKeyframeTrack) {
        for (let i = 0; i < srcCount; i++) {
          for (let c = 0; c < dim; c++) {
            let acc = 0;
            let wSum = 0;
            for (let d = -radius; d <= radius; d++) {
              const idx = Math.max(0, Math.min(srcCount - 1, i + d));
              const w = Math.exp(-0.5 * (d / sigma) * (d / sigma));
              acc += sampled[idx * dim + c] * w;
              wSum += w;
            }
            const orig = sampled[i * dim + c];
            smoothed[i * dim + c] = orig + (acc / wSum - orig) * blend;
          }
        }
      }

      const outVals = new Float32Array(outCount * dim);
      for (let j = 0; j < outCount; j++) {
        const pos = (j / (outCount - 1)) * (srcCount - 1);
        const i0 = Math.floor(pos);
        const i1 = Math.min(srcCount - 1, i0 + 1);
        const f = pos - i0;
        for (let c = 0; c < dim; c++) {
          const va = smoothed[i0 * dim + c];
          const vb = smoothed[i1 * dim + c];
          outVals[j * dim + c] = va + (vb - va) * f;
        }
      }

      if (track instanceof THREE.VectorKeyframeTrack) {
        newTracks.push(new THREE.VectorKeyframeTrack(track.name, outTimes, outVals));
      } else {
        newTracks.push(new THREE.NumberKeyframeTrack(track.name, outTimes, outVals));
      }
    }
  }

  return new THREE.AnimationClip(rawClip.name, duration, newTracks);
}
