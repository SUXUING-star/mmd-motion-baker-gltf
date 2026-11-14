// src/utils/motionTrimmer.ts
import { LandmarkData, LandmarkFrame } from '../types/types';

export interface LoopCandidate {
  startFrame: number;
  endFrame: number;
  duration: number;
  score: number;
  distance: number;
}

export interface LoopRegionConfig {
  startFrame: number;
  endFrame: number;
  blendDuration: number;
}

function getHipsPos(lm: Record<string, [number, number, number]>): [number, number, number] {
  return lm['Hips'] || lm['hips'] || lm['下半身'] || lm['Root'] || lm['センター'] || [0, 0, 0];
}

/**
 * 扣除全局 Hips XZ 水平位移后，计算两帧的局部相对姿态差异（消除位移漂移带来的误判）
 */
function calculateRelativePoseDistance(frameA: LandmarkFrame, frameB: LandmarkFrame): number {
  const hipsA = getHipsPos(frameA.landmarks);
  const hipsB = getHipsPos(frameB.landmarks);

  let distSqSum = 0;
  let count = 0;

  for (const name in frameA.landmarks) {
    if (frameB.landmarks[name]) {
      const [ax, ay, az] = frameA.landmarks[name];
      const [bx, by, bz] = frameB.landmarks[name];
      const dx = (ax - hipsA[0]) - (bx - hipsB[0]);
      const dy = ay - by;
      const dz = (az - hipsA[2]) - (bz - hipsB[2]);
      distSqSum += dx * dx + dy * dy + dz * dz;
      count++;
    }
  }

  return count > 0 ? distSqSum / count : Infinity;
}

/**
 * 自动扫描全姿态数据，检索高相干度的可循环段候选列表（精确到 1 帧局部极小值）
 */
export function findLoopCandidates(
  landmarkData: LandmarkData,
  minGapFrames = 30,
  maxCandidates = 4
): LoopCandidate[] {
  const frames = landmarkData.frames;
  const total = frames.length;
  if (total <= minGapFrames + 5) return [];

  const candidates: LoopCandidate[] = [];
  const fps = landmarkData.fps || 30;
  const coarseStep = Math.max(1, Math.floor(total / 80));

  for (let i = 0; i < total - minGapFrames; i += coarseStep) {
    const fStart = frames[i];
    let minDist = Infinity;
    let bestJ = -1;

    for (let j = i + minGapFrames; j < total; j += coarseStep) {
      const dist = calculateRelativePoseDistance(fStart, frames[j]);
      if (dist < minDist) {
        minDist = dist;
        bestJ = j;
      }
    }

    // 在粗略极小值附近 ±coarseStep 范围内做 1 帧级精确搜索
    if (bestJ > 0) {
      const searchStart = Math.max(i + minGapFrames, bestJ - coarseStep);
      const searchEnd = Math.min(total - 1, bestJ + coarseStep);
      for (let j = searchStart; j <= searchEnd; j++) {
        const dist = calculateRelativePoseDistance(fStart, frames[j]);
        if (dist < minDist) {
          minDist = dist;
          bestJ = j;
        }
      }
    }

    if (bestJ > 0 && minDist < 0.25) {
      const score = Math.max(0, Math.min(100, Math.round((1 - minDist / 0.25) * 100)));
      const duration = Number(((bestJ - i) / fps).toFixed(2));

      candidates.push({
        startFrame: i,
        endFrame: bestJ,
        duration,
        score,
        distance: minDist,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const result: LoopCandidate[] = [];

  for (const c of candidates) {
    const duplicate = result.some(
      (r) => Math.abs(r.startFrame - c.startFrame) < 12 && Math.abs(r.endFrame - c.endFrame) < 12
    );
    if (!duplicate) {
      result.push(c);
      if (result.length >= maxCandidates) break;
    }
  }

  return result;
}

export function findBestLoopEndFrame(
  landmarkData: LandmarkData,
  startFrameIndex = 0,
  minGapFrames = 30
): { bestFrameIndex: number; bestTime: number; minDistance: number } {
  const frames = landmarkData.frames;
  const totalFrames = frames.length;

  if (totalFrames <= minGapFrames + startFrameIndex) {
    const lastIndex = Math.max(0, totalFrames - 1);
    return {
      bestFrameIndex: lastIndex,
      bestTime: frames[lastIndex]?.time || 0,
      minDistance: 0,
    };
  }

  const refFrame = frames[startFrameIndex];
  let minDistance = Infinity;
  let bestFrameIndex = totalFrames - 1;

  for (let i = startFrameIndex + minGapFrames; i < totalFrames; i++) {
    const dist = calculateRelativePoseDistance(refFrame, frames[i]);
    if (dist < minDistance) {
      minDistance = dist;
      bestFrameIndex = i;
    }
  }

  return {
    bestFrameIndex,
    bestTime: frames[bestFrameIndex].time,
    minDistance,
  };
}

function cubicHermiteInterpolate(
  p0: [number, number, number],
  v0: [number, number, number],
  p1: [number, number, number],
  v1: [number, number, number],
  u: number,
  T: number
): [number, number, number] {
  const u2 = u * u;
  const u3 = u2 * u;

  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  return [
    h00 * p0[0] + h10 * (T * v0[0]) + h01 * p1[0] + h11 * (T * v1[0]),
    h00 * p0[1] + h10 * (T * v0[1]) + h01 * p1[1] + h11 * (T * v1[1]),
    h00 * p0[2] + h10 * (T * v0[2]) + h01 * p1[2] + h11 * (T * v1[2]),
  ];
}

/**
 * 裁剪出 [startFrameIndex, endFrameIndex]，并真正向尾部物理插入过渡帧
 */
export function applyLoopSegmentToLandmarkData(
  landmarkData: LandmarkData,
  startFrameIndex: number,
  endFrameIndex: number,
  blendDuration: number
): LandmarkData {
  const safeStart = Math.max(0, Math.min(startFrameIndex, landmarkData.frames.length - 1));
  const safeEnd = Math.max(safeStart, Math.min(endFrameIndex, landmarkData.frames.length - 1));

  const baseFrames = landmarkData.frames.slice(safeStart, safeEnd + 1);
  if (baseFrames.length < 4) return trimLandmarkData(landmarkData, safeStart, safeEnd);

  const fps = landmarkData.fps || 30;
  const dt = 1 / fps;
  const insertCount = Math.max(4, Math.round(blendDuration * fps));
  const T = insertCount * dt;

  const originalCount = baseFrames.length;
  const fStart = baseFrames[0];
  const fStartNext = baseFrames[1] || fStart;
  const fEnd = baseFrames[originalCount - 1];
  const fEndPrev = baseFrames[originalCount - 2] || fEnd;

  const startOrigTime = fStart.previewTime ?? fStart.time;
  const endOrigTime = fEnd.previewTime ?? fEnd.time;

  const vEnd: Record<string, [number, number, number]> = {};
  const vStart: Record<string, [number, number, number]> = {};

  for (const k in fEnd.landmarks) {
    const pEnd = fEnd.landmarks[k];
    const pEndP = fEndPrev.landmarks[k] || pEnd;
    vEnd[k] = [
      ((pEnd[0] - pEndP[0]) / dt) * 0.5,
      ((pEnd[1] - pEndP[1]) / dt) * 0.5,
      ((pEnd[2] - pEndP[2]) / dt) * 0.5,
    ];

    const pStart = fStart.landmarks[k] || pEnd;
    const pStartN = fStartNext.landmarks[k] || pStart;
    vStart[k] = [
      ((pStartN[0] - pStart[0]) / dt) * 0.5,
      ((pStartN[1] - pStart[1]) / dt) * 0.5,
      ((pStartN[2] - pStart[2]) / dt) * 0.5,
    ];
  }

  // 1. 保留主体剪辑帧（记录原始预览时间）
  const resultFrames: LandmarkFrame[] = baseFrames.map((f) => ({
    time: 0,
    landmarks: { ...f.landmarks },
    expressions: f.expressions ? { ...f.expressions } : undefined,
    previewTime: f.previewTime ?? f.time,
  }));

  // 2. 物理插入过渡帧（供预览与 mathSolver 四元数缝合使用）
  for (let step = 1; step <= insertCount; step++) {
    const u = step / insertCount;
    const smoothW = u * u * u * (u * (u * 6 - 15) + 10); // Quintic smootherstep
    const interpolatedLm: Record<string, [number, number, number]> = {};

    if (step === insertCount) {
      for (const k in fStart.landmarks) {
        const p = fStart.landmarks[k];
        interpolatedLm[k] = [p[0], p[1], p[2]];
      }
    } else {
      for (const k in fEnd.landmarks) {
        const pEnd = fEnd.landmarks[k];
        const pStart = fStart.landmarks[k] || pEnd;
        const ve = vEnd[k] || [0, 0, 0];
        const vs = vStart[k] || [0, 0, 0];
        const p = cubicHermiteInterpolate(pEnd, ve, pStart, vs, u, T);
        interpolatedLm[k] = [
          Number(p[0].toFixed(4)),
          Number(p[1].toFixed(4)),
          Number(p[2].toFixed(4)),
        ];
      }
    }

    let interpolatedExpr: Record<string, number> | undefined;
    if (fEnd.expressions || fStart.expressions) {
      interpolatedExpr = {};
      const allKeys = new Set([
        ...Object.keys(fEnd.expressions || {}),
        ...Object.keys(fStart.expressions || {}),
      ]);
      allKeys.forEach((key) => {
        const vE = fEnd.expressions?.[key] ?? 0;
        const vS = fStart.expressions?.[key] ?? 0;
        interpolatedExpr![key] = Number((vE + (vS - vE) * smoothW).toFixed(4));
      });
    }

    resultFrames.push({
      time: 0,
      landmarks: interpolatedLm,
      ...(interpolatedExpr ? { expressions: interpolatedExpr } : {}),
      previewTime: endOrigTime,
      previewBlendTarget: {
        startTime: startOrigTime,
        weight: smoothW,
      },
    });
  }

  // 3. 使用精确浮点时间戳 i / fps（严禁 toFixed(3) 截断，否则 SkeletonUtils.retargetClip 会少采样尾帧！）
  const totalFrames = resultFrames.length;
  for (let i = 0; i < totalFrames; i++) {
    resultFrames[i].time = i / fps;
  }
  const duration = totalFrames > 0 ? resultFrames[totalFrames - 1].time : 0;

  return {
    ...landmarkData,
    totalFrames,
    duration,
    frames: resultFrames,
    loopBridgeFrames: insertCount,
  };
}

export function trimLandmarkData(
  landmarkData: LandmarkData,
  startFrameIndex: number,
  endFrameIndex: number
): LandmarkData {
  const safeStart = Math.max(0, Math.min(startFrameIndex, landmarkData.frames.length - 1));
  const safeEnd = Math.max(safeStart, Math.min(endFrameIndex, landmarkData.frames.length - 1));

  const slicedFrames = landmarkData.frames.slice(safeStart, safeEnd + 1);
  const fps = landmarkData.fps || 30;

  const normalizedFrames: LandmarkFrame[] = slicedFrames.map((f, idx) => ({
    ...f,
    time: idx / fps,
    previewTime: f.previewTime ?? f.time,
  }));

  const totalFrames = normalizedFrames.length;
  const duration = totalFrames > 0 ? normalizedFrames[totalFrames - 1].time : 0;

  return {
    ...landmarkData,
    totalFrames,
    duration,
    frames: normalizedFrames,
  };
}
