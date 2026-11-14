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
  inPlace: boolean;
}

function getHipsPos(lm: Record<string, [number, number, number]>): [number, number, number] {
  return lm['Hips'] || lm['hips'] || lm['下半身'] || lm['Root'] || lm['センター'] || [0, 0, 0];
}

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
 * 计算姿态 + 显式速度向量差异（严防反方向摆腿与静止帧混入）
 */
function calculateMotionWindowDistance(
  frames: LandmarkFrame[],
  idxA: number,
  idxB: number
): number {
  const poseDist = calculateRelativePoseDistance(frames[idxA], frames[idxB]);
  if (!Number.isFinite(poseDist)) return Infinity;

  const prevA = frames[Math.max(0, idxA - 2)];
  const nextA = frames[Math.min(frames.length - 1, idxA + 2)];
  const prevB = frames[Math.max(0, idxB - 2)];
  const nextB = frames[Math.min(frames.length - 1, idxB + 2)];

  const hipsPA = getHipsPos(prevA.landmarks);
  const hipsNA = getHipsPos(nextA.landmarks);
  const hipsPB = getHipsPos(prevB.landmarks);
  const hipsNB = getHipsPos(nextB.landmarks);

  let velDiffSq = 0;
  let velCount = 0;

  for (const name in prevA.landmarks) {
    if (nextA.landmarks[name] && prevB.landmarks[name] && nextB.landmarks[name]) {
      const vAx = (nextA.landmarks[name][0] - hipsNA[0]) - (prevA.landmarks[name][0] - hipsPA[0]);
      const vAy = nextA.landmarks[name][1] - prevA.landmarks[name][1];
      const vAz = (nextA.landmarks[name][2] - hipsNA[2]) - (prevA.landmarks[name][2] - hipsPA[2]);

      const vBx = (nextB.landmarks[name][0] - hipsNB[0]) - (prevB.landmarks[name][0] - hipsPB[0]);
      const vBy = nextB.landmarks[name][1] - prevB.landmarks[name][1];
      const vBz = (nextB.landmarks[name][2] - hipsNB[2]) - (prevB.landmarks[name][2] - hipsPB[2]);

      const dvx = vAx - vBx;
      const dvy = vAy - vBy;
      const dvz = vAz - vBz;
      velDiffSq += dvx * dvx + dvy * dvy + dvz * dvz;
      velCount++;
    }
  }

  const avgVelDiff = velCount > 0 ? velDiffSq / velCount : 0;
  return poseDist * 0.55 + avgVelDiff * 1.5;
}

/**
 * 检验片段区间内是否确实有有效动作（避免选中全程站着不动的段落）
 */
function hasActiveMotionInSegment(frames: LandmarkFrame[], start: number, end: number): boolean {
  const mid = Math.floor((start + end) / 2);
  const d1 = calculateRelativePoseDistance(frames[start], frames[mid]);
  const d2 = calculateRelativePoseDistance(frames[start], frames[Math.floor((start + mid) / 2)]);
  return Math.max(d1, d2) > 0.002;
}

export function findLoopCandidates(
  landmarkData: LandmarkData,
  minGapFrames = 24,
  maxCandidates = 4
): LoopCandidate[] {
  const frames = landmarkData.frames;
  const total = frames.length;
  if (total <= minGapFrames + 6) return [];

  const candidates: LoopCandidate[] = [];
  const fps = landmarkData.fps || 30;
  const coarseStep = Math.max(1, Math.floor(total / 80));

  for (let i = 2; i < total - minGapFrames - 3; i += coarseStep) {
    let minDist = Infinity;
    let bestJ = -1;

    for (let j = i + minGapFrames; j < total - 2; j += coarseStep) {
      const dist = calculateMotionWindowDistance(frames, i, j);
      if (dist < minDist) {
        minDist = dist;
        bestJ = j;
      }
    }

    if (bestJ > 0) {
      const searchStart = Math.max(i + minGapFrames, bestJ - coarseStep);
      const searchEnd = Math.min(total - 3, bestJ + coarseStep);
      for (let j = searchStart; j <= searchEnd; j++) {
        const dist = calculateMotionWindowDistance(frames, i, j);
        if (dist < minDist) {
          minDist = dist;
          bestJ = j;
        }
      }
    }

    if (bestJ > 0 && minDist < 0.25 && hasActiveMotionInSegment(frames, i, bestJ)) {
      const score = Math.max(1, Math.min(99, Math.round(Math.exp(-minDist * 10) * 100)));
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
  minGapFrames = 24
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

  let minDistance = Infinity;
  let bestFrameIndex = totalFrames - 1;

  for (let i = startFrameIndex + minGapFrames; i < totalFrames; i++) {
    const dist = calculateMotionWindowDistance(frames, startFrameIndex, i);
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

function shiftFrameXZ(
  frame: LandmarkFrame,
  dx: number,
  dz: number
): LandmarkFrame {
  const lm: Record<string, [number, number, number]> = {};
  for (const k in frame.landmarks) {
    const p = frame.landmarks[k];
    lm[k] = [p[0] + dx, p[1], p[2] + dz];
  }
  return {
    ...frame,
    landmarks: lm,
    expressions: frame.expressions ? { ...frame.expressions } : undefined,
  };
}

/**
 * 同相位交叠融合（保持 1.000 完整周期长度，绝不切半拍破坏节奏）：
 * - 若 E 后方有足够真实延续帧 (E + B < rawTotal)：
 *   主体 = raw[S + B .. E]
 *   过渡 = Blend(TrackA: raw[E + 1 .. E + B], TrackB: raw[S + 1 .. S + B])
 *   其中 TrackA 与 TrackB 相位完全同步（均相对周期起点推进 1..B 帧），第 B 帧 100% 抵达 raw[S + B] === Frame[0]！
 * - 若 E 贴近视频结尾没有后续帧：
 *   保留 raw[S .. E]，启用 'warp' 模式在 mathSolver 内对首尾残差做加性分散校准。
 */
export function applyLoopSegmentToLandmarkData(
  landmarkData: LandmarkData,
  startFrameIndex: number,
  endFrameIndex: number,
  blendDuration: number,
  inPlace: boolean = true
): LandmarkData {
  const allFrames = landmarkData.frames;
  const rawTotal = allFrames.length;
  const safeStart = Math.max(0, Math.min(startFrameIndex, rawTotal - 1));
  const safeEnd = Math.max(safeStart, Math.min(endFrameIndex, rawTotal - 1));

  const cycleSpan = safeEnd - safeStart;
  if (cycleSpan < 6) return trimLandmarkData(landmarkData, safeStart, safeEnd);

  const fps = landmarkData.fps || 30;
  // 融合帧数不超过半个周期
  const maxAllowedBlend = Math.max(2, Math.floor(cycleSpan * 0.45));
  const insertCount = Math.max(3, Math.min(maxAllowedBlend, Math.round(blendDuration * fps)));

  const canOverlapForward = safeEnd + insertCount < rawTotal;

  // =========================================================================
  // 模式 1：同相位交叠继续动 (Phase-Aligned Overlap Crossfade)
  // =========================================================================
  if (canOverlapForward) {
    const bodyStart = safeStart + insertCount;
    const bodyFrames = allFrames.slice(bodyStart, safeEnd + 1);

    // Track A: 从 E 继续往后动 (E + 1 .. E + B)
    const bridgeContinuation: LandmarkFrame[] = allFrames
      .slice(safeEnd + 1, safeEnd + 1 + insertCount)
      .map((f) => ({
        ...f,
        previewTime: f.previewTime ?? f.time,
        landmarks: { ...f.landmarks },
      }));

    // 计算周期前进位移，把 Track B 平移到与 Track A 相同的空间接续位置，避免过渡区倒着滑步
    const hStart = getHipsPos(allFrames[safeStart].landmarks);
    const hEnd = getHipsPos(allFrames[safeEnd].landmarks);
    const cycleDriftX = hEnd[0] - hStart[0];
    const cycleDriftZ = hEnd[2] - hStart[2];

    // Track B: 同相位接回 (S + 1 .. S + B)，末帧 B 正好是 raw[S + B] === bodyFrames[0]
    const bridgeLeadIn: LandmarkFrame[] = allFrames
      .slice(safeStart + 1, safeStart + 1 + insertCount)
      .map((f) =>
        shiftFrameXZ(
          {
            ...f,
            previewTime: f.previewTime ?? f.time,
          },
          cycleDriftX,
          cycleDriftZ
        )
      );

    const resultFrames: LandmarkFrame[] = bodyFrames.map((f) => ({
      time: 0,
      landmarks: { ...f.landmarks },
      expressions: f.expressions ? { ...f.expressions } : undefined,
      previewTime: f.previewTime ?? f.time,
    }));

    for (let k = 0; k < insertCount; k++) {
      const u = (k + 1) / insertCount;
      const w = u * u * u * (u * (u * 6 - 15) + 10);
      const fA = bridgeContinuation[k];
      const fB = bridgeLeadIn[k];

      const lm: Record<string, [number, number, number]> = {};
      for (const boneKey in fA.landmarks) {
        const pA = fA.landmarks[boneKey];
        const pB = fB.landmarks[boneKey] || pA;
        lm[boneKey] = [
          pA[0] * (1 - w) + pB[0] * w,
          pA[1] * (1 - w) + pB[1] * w,
          pA[2] * (1 - w) + pB[2] * w,
        ];
      }

      let expressions: Record<string, number> | undefined;
      if (fA.expressions || fB.expressions) {
        expressions = {};
        const keys = new Set([
          ...Object.keys(fA.expressions || {}),
          ...Object.keys(fB.expressions || {}),
        ]);
        keys.forEach((key) => {
          const vA = fA.expressions?.[key] ?? 0;
          const vB = fB.expressions?.[key] ?? 0;
          expressions![key] = Number((vA * (1 - w) + vB * w).toFixed(4));
        });
      }

      resultFrames.push({
        time: 0,
        landmarks: lm,
        ...(expressions ? { expressions } : {}),
        previewTime: fA.previewTime ?? fA.time,
        previewBlendTarget: {
          startTime: fB.previewTime ?? fB.time,
          weight: w,
        },
      });
    }

    const totalFrames = resultFrames.length;
    // 若开启原地循环，从全部帧（含过渡轨）统一扣除线性 XZ 前进趋势，保留 100% 骨盆摇摆与 Y 起伏
    if (inPlace && totalFrames > 1) {
      const firstH = getHipsPos(resultFrames[0].landmarks);
      const lastH = getHipsPos(resultFrames[totalFrames - 1].landmarks);
      const totalDriftX = lastH[0] - firstH[0];
      const totalDriftZ = lastH[2] - firstH[2];

      for (let i = 0; i < totalFrames; i++) {
        const frac = i / (totalFrames - 1);
        resultFrames[i] = shiftFrameXZ(
          resultFrames[i],
          -totalDriftX * frac,
          -totalDriftZ * frac
        );
      }
    }

    for (let i = 0; i < totalFrames; i++) {
      resultFrames[i].time = i / fps;
    }

    return {
      ...landmarkData,
      totalFrames,
      duration: resultFrames[totalFrames - 1].time,
      frames: resultFrames,
      loopMode: 'overlap',
      loopBridgeFrames: insertCount,
      loopInPlace: inPlace,
      bridgeContinuation,
      bridgeLeadIn,
    };
  }

  // =========================================================================
  // 模式 2：结尾无后续帧兜底 —— 残差分散校准 (Unity Loop Pose Warp)
  // =========================================================================
  const sliced = allFrames.slice(safeStart, safeEnd + 1);
  const totalFrames = sliced.length;
  const resultFrames: LandmarkFrame[] = sliced.map((f, idx) => ({
    time: idx / fps,
    landmarks: { ...f.landmarks },
    expressions: f.expressions ? { ...f.expressions } : undefined,
    previewTime: f.previewTime ?? f.time,
  }));

  if (inPlace && totalFrames > 1) {
    const firstH = getHipsPos(resultFrames[0].landmarks);
    const lastH = getHipsPos(resultFrames[totalFrames - 1].landmarks);
    const totalDriftX = lastH[0] - firstH[0];
    const totalDriftZ = lastH[2] - firstH[2];

    for (let i = 0; i < totalFrames; i++) {
      const frac = i / (totalFrames - 1);
      resultFrames[i] = shiftFrameXZ(
        resultFrames[i],
        -totalDriftX * frac,
        -totalDriftZ * frac
      );
    }
  }

  return {
    ...landmarkData,
    totalFrames,
    duration: resultFrames[totalFrames - 1].time,
    frames: resultFrames,
    loopMode: 'warp',
    loopBridgeFrames: insertCount,
    loopInPlace: inPlace,
    bridgeContinuation: undefined,
    bridgeLeadIn: undefined,
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
    loopMode: undefined,
    loopBridgeFrames: 0,
    bridgeContinuation: undefined,
    bridgeLeadIn: undefined,
  };
}
