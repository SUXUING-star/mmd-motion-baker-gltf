// src/solvers/loopSolver.ts
import * as THREE from 'three';
import { HUMANOID_BONES, HumanoidBoneName } from '../types/boneMapping';
import { LandmarkData, LandmarkFrame } from '../types/types';

export interface LoopCandidate {
  startFrame: number;
  endFrame: number;
  duration: number;
  score: number;
  distance: number;
}

export interface SequenceSolveResult {
  hipsArr: THREE.Vector3[];
  quatsArr: Record<HumanoidBoneName, THREE.Quaternion[]>;
  lastPrevQuats: Partial<Record<HumanoidBoneName, THREE.Quaternion>>;
}

export type SequenceSolverFn = (
  frames: LandmarkFrame[],
  initPrevQuats?: Partial<Record<HumanoidBoneName, THREE.Quaternion>>
) => SequenceSolveResult;

// ============================================================================
// 一、运动学辅助：核心骨骼相位搜索（排除 30 根手指稀释，适配侧身 Idle 与任意动作）
// ============================================================================

const CORE_BONE_WEIGHTS: Array<{ keys: string[]; weight: number }> = [
  { keys: ['hips', 'Hips', '下半身', 'センター', 'Root'], weight: 2.2 },
  { keys: ['spine', 'Spine', '上半身'], weight: 2.0 },
  { keys: ['chest', 'Chest', 'upperChest', 'UpperChest', '上半身2'], weight: 2.0 },
  { keys: ['neck', 'Neck', '首', 'head', 'Head', '頭'], weight: 1.4 },
  { keys: ['leftUpperArm', 'LeftUpperArm', '左腕'], weight: 1.6 },
  { keys: ['rightUpperArm', 'RightUpperArm', '右腕'], weight: 1.6 },
  { keys: ['leftLowerArm', 'LeftLowerArm', '左ひじ'], weight: 1.3 },
  { keys: ['rightLowerArm', 'RightLowerArm', '右ひじ'], weight: 1.3 },
  { keys: ['leftHand', 'LeftHand', '左手首'], weight: 1.0 },
  { keys: ['rightHand', 'RightHand', '右手首'], weight: 1.0 },
  { keys: ['leftUpperLeg', 'LeftUpperLeg', '左足'], weight: 1.8 },
  { keys: ['rightUpperLeg', 'RightUpperLeg', '右足'], weight: 1.8 },
  { keys: ['leftLowerLeg', 'LeftLowerLeg', '左ひざ'], weight: 1.5 },
  { keys: ['rightLowerLeg', 'RightLowerLeg', '右ひざ'], weight: 1.5 },
  { keys: ['leftFoot', 'LeftFoot', '左足首'], weight: 1.4 },
  { keys: ['rightFoot', 'RightFoot', '右足首'], weight: 1.4 },
];

function getHipsPos(lm: Record<string, [number, number, number]>): [number, number, number] {
  return lm['Hips'] || lm['hips'] || lm['下半身'] || lm['Root'] || lm['センター'] || [0, 0, 0];
}

function getCoreBonePos(
  lm: Record<string, [number, number, number]>,
  keys: string[]
): [number, number, number] | null {
  for (let i = 0; i < keys.length; i++) {
    const p = lm[keys[i]];
    if (p) return p;
  }
  return null;
}

function calculateCorePoseDistance(frameA: LandmarkFrame, frameB: LandmarkFrame): number {
  const hipsA = getHipsPos(frameA.landmarks);
  const hipsB = getHipsPos(frameB.landmarks);

  let weightedDistSq = 0;
  let weightSum = 0;

  for (let i = 0; i < CORE_BONE_WEIGHTS.length; i++) {
    const { keys, weight } = CORE_BONE_WEIGHTS[i];
    const pA = getCoreBonePos(frameA.landmarks, keys);
    const pB = getCoreBonePos(frameB.landmarks, keys);
    if (!pA || !pB) continue;

    const dx = (pA[0] - hipsA[0]) - (pB[0] - hipsB[0]);
    const dy = pA[1] - pB[1];
    const dz = (pA[2] - hipsA[2]) - (pB[2] - hipsB[2]);
    weightedDistSq += (dx * dx + dy * dy + dz * dz) * weight;
    weightSum += weight;
  }

  if (weightSum > 0) return weightedDistSq / weightSum;

  let distSqSum = 0;
  let count = 0;
  for (const name in frameA.landmarks) {
    const pA = frameA.landmarks[name];
    const pB = frameB.landmarks[name];
    if (pB) {
      const dx = (pA[0] - hipsA[0]) - (pB[0] - hipsB[0]);
      const dy = pA[1] - pB[1];
      const dz = (pA[2] - hipsA[2]) - (pB[2] - hipsB[2]);
      distSqSum += dx * dx + dy * dy + dz * dz;
      count++;
    }
  }
  return count > 0 ? distSqSum / count : Infinity;
}

function calculateCoreMotionWindowDistance(
  frames: LandmarkFrame[],
  idxA: number,
  idxB: number
): number {
  const poseDist = calculateCorePoseDistance(frames[idxA], frames[idxB]);
  if (!Number.isFinite(poseDist)) return Infinity;

  const prevA = frames[Math.max(0, idxA - 2)];
  const nextA = frames[Math.min(frames.length - 1, idxA + 2)];
  const prevB = frames[Math.max(0, idxB - 2)];
  const nextB = frames[Math.min(frames.length - 1, idxB + 2)];

  const hipsPA = getHipsPos(prevA.landmarks);
  const hipsNA = getHipsPos(nextA.landmarks);
  const hipsPB = getHipsPos(prevB.landmarks);
  const hipsNB = getHipsPos(nextB.landmarks);

  let velDiffWeightedSq = 0;
  let velWeightSum = 0;

  for (let i = 0; i < CORE_BONE_WEIGHTS.length; i++) {
    const { keys, weight } = CORE_BONE_WEIGHTS[i];
    const pPA = getCoreBonePos(prevA.landmarks, keys);
    const pNA = getCoreBonePos(nextA.landmarks, keys);
    const pPB = getCoreBonePos(prevB.landmarks, keys);
    const pNB = getCoreBonePos(nextB.landmarks, keys);
    if (!pPA || !pNA || !pPB || !pNB) continue;

    const vAx = (pNA[0] - hipsNA[0]) - (pPA[0] - hipsPA[0]);
    const vAy = pNA[1] - pPA[1];
    const vAz = (pNA[2] - hipsNA[2]) - (pPA[2] - hipsPA[2]);

    const vBx = (pNB[0] - hipsNB[0]) - (pPB[0] - hipsPB[0]);
    const vBy = pNB[1] - pPB[1];
    const vBz = (pNB[2] - hipsNB[2]) - (pPB[2] - hipsPB[2]);

    const dvx = vAx - vBx;
    const dvy = vAy - vBy;
    const dvz = vAz - vBz;
    velDiffWeightedSq += (dvx * dvx + dvy * dvy + dvz * dvz) * weight;
    velWeightSum += weight;
  }

  const avgVelDiff = velWeightSum > 0 ? velDiffWeightedSq / velWeightSum : 0;
  return poseDist * 0.5 + avgVelDiff * 1.8;
}

function computeMotionEnergyThreshold(frames: LandmarkFrame[]): number {
  const total = frames.length;
  if (total < 6) return 0.0005;
  const step = Math.max(1, Math.floor(total / 24));
  let maxDist = 0;
  for (let i = step; i < total; i += step) {
    const d = calculateCorePoseDistance(frames[0], frames[i]);
    if (Number.isFinite(d) && d > maxDist) maxDist = d;
  }
  return Math.max(0.0002, Math.min(0.002, maxDist * 0.08));
}

function hasActiveMotionInSegment(
  frames: LandmarkFrame[],
  start: number,
  end: number,
  threshold: number
): boolean {
  const q1 = Math.floor(start + (end - start) * 0.25);
  const mid = Math.floor((start + end) * 0.5);
  const q3 = Math.floor(start + (end - start) * 0.75);
  const d1 = calculateCorePoseDistance(frames[start], frames[q1]);
  const d2 = calculateCorePoseDistance(frames[start], frames[mid]);
  const d3 = calculateCorePoseDistance(frames[start], frames[q3]);
  return Math.max(d1, d2, d3) > threshold;
}

export function findLoopCandidatesInSolver(
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
  const energyThreshold = computeMotionEnergyThreshold(frames);

  for (let i = 2; i < total - minGapFrames - 3; i += coarseStep) {
    let minDist = Infinity;
    let bestJ = -1;

    for (let j = i + minGapFrames; j < total - 2; j += coarseStep) {
      const dist = calculateCoreMotionWindowDistance(frames, i, j);
      if (dist < minDist) {
        minDist = dist;
        bestJ = j;
      }
    }

    if (bestJ > 0) {
      const searchStart = Math.max(i + minGapFrames, bestJ - coarseStep);
      const searchEnd = Math.min(total - 3, bestJ + coarseStep);
      for (let j = searchStart; j <= searchEnd; j++) {
        const dist = calculateCoreMotionWindowDistance(frames, i, j);
        if (dist < minDist) {
          minDist = dist;
          bestJ = j;
        }
      }
    }

    if (
      bestJ > 0 &&
      minDist < 0.35 &&
      hasActiveMotionInSegment(frames, i, bestJ, energyThreshold)
    ) {
      const score = Math.max(1, Math.min(99, Math.round(Math.exp(-minDist * 8.5) * 100)));
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

export function findBestLoopEndFrameInSolver(
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
    const dist = calculateCoreMotionWindowDistance(frames, startFrameIndex, i);
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

// ============================================================================
// 二、数学内核：Lie 代数 so(3) + 周期性热核扩散（严格凸组合，绝不过冲）
// ============================================================================

function quatLog(q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  let x = q.x, y = q.y, z = q.z, w = q.w;
  if (w < 0) {
    x = -x; y = -y; z = -z; w = -w;
  }
  const sinHalf = Math.hypot(x, y, z);
  if (sinHalf < 1e-7) return out.set(x * 2, y * 2, z * 2);
  const halfAngle = Math.atan2(sinHalf, Math.min(1, w));
  const scale = (2 * halfAngle) / sinHalf;
  return out.set(x * scale, y * scale, z * scale);
}

function quatExp(v: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const angle = v.length();
  if (angle < 1e-7) return out.set(v.x * 0.5, v.y * 0.5, v.z * 0.5, 1).normalize();
  const halfAngle = angle * 0.5;
  const s = Math.sin(halfAngle) / angle;
  return out.set(v.x * s, v.y * s, v.z * s, Math.cos(halfAngle)).normalize();
}

function getSeamDiffusionWeight(idx: number, frameCount: number, radius: number): number {
  const E = frameCount - 1;
  const minDist = Math.min(idx, E - idx);
  if (minDist >= radius) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * minDist) / radius));
}

function closeScalarTrackPeriodic(
  values: Float64Array,
  frameCount: number,
  seamRadius: number,
  passes: number
) {
  const E = frameCount - 1;
  if (E < 4) return;

  // 1. 全周期均匀摊销首尾差（零加速度偏差）
  const diff = values[0] - values[E];
  if (Math.abs(diff) > 1e-8) {
    for (let i = 0; i <= E; i++) {
      values[i] += (i / E - 0.5) * diff;
    }
  }
  values[E] = values[0];

  if (passes <= 0) return;

  // 2. 接缝局部周期热核磨圆
  const period = E;
  const radius = Math.max(3, Math.min(Math.floor(period / 3), seamRadius));
  const tmp = new Float64Array(frameCount);

  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < period; i++) {
      const blend = getSeamDiffusionWeight(i, frameCount, radius);
      if (blend <= 1e-4) {
        tmp[i] = values[i];
      } else {
        const vPrev = values[(i - 1 + period) % period];
        const vCur = values[i];
        const vNext = values[(i + 1) % period];
        const avg = (vPrev + 2 * vCur + vNext) * 0.25;
        tmp[i] = vCur * (1 - blend) + avg * blend;
      }
    }
    tmp[E] = tmp[0];
    for (let i = 0; i <= E; i++) {
      values[i] = tmp[i];
    }
  }
}

// ============================================================================
// 三、预览与主体构建器（严格回归纯净 1.000 单周期闭合架构，零前导污染）
// ============================================================================

function cloneFrame(frame: LandmarkFrame): LandmarkFrame {
  const lm: Record<string, [number, number, number]> = {};
  for (const k in frame.landmarks) {
    const p = frame.landmarks[k];
    lm[k] = [p[0], p[1], p[2]];
  }
  return {
    ...frame,
    landmarks: lm,
    expressions: frame.expressions ? { ...frame.expressions } : undefined,
    previewTime: frame.previewTime ?? frame.time,
  };
}

function shiftFrameXZInPlace(frame: LandmarkFrame, dx: number, dz: number) {
  for (const k in frame.landmarks) {
    const p = frame.landmarks[k];
    p[0] += dx;
    p[2] += dz;
  }
}

export function buildLoopedLandmarkData(
  landmarkData: LandmarkData,
  startFrameIndex: number,
  endFrameIndex: number,
  blendDuration: number,
  inPlace = true
): LandmarkData {
  const allFrames = landmarkData.frames;
  const rawTotal = allFrames.length;
  const safeStart = Math.max(0, Math.min(startFrameIndex, rawTotal - 1));
  const safeEnd = Math.max(safeStart, Math.min(endFrameIndex, rawTotal - 1));

  const cycleSpan = safeEnd - safeStart;
  if (cycleSpan < 6) {
    const sliced = allFrames.slice(safeStart, safeEnd + 1);
    const fps = landmarkData.fps || 30;
    const frames = sliced.map((f, idx) => ({
      ...cloneFrame(f),
      time: idx / fps,
    }));
    return {
      ...landmarkData,
      totalFrames: frames.length,
      duration: frames.length > 0 ? frames[frames.length - 1].time : 0,
      frames,
      loopMode: undefined,
      loopStartFrame: undefined,
      loopBridgeFrames: 0,
      bridgeContinuation: undefined,
      bridgeLeadIn: undefined,
    };
  }

  const fps = landmarkData.fps || 30;
  const maxAllowedBlend = Math.max(2, Math.floor(cycleSpan * 0.45));
  const insertCount = Math.max(3, Math.min(maxAllowedBlend, Math.round(blendDuration * fps)));
  const canOverlapForward = safeEnd + insertCount < rawTotal;

  // --------------------------------------------------------------------------
  // 模式 1：同相位交叠融合 (Phase-Aligned Overlap Crossfade)
  //         主体 = raw[S + B .. E]，桥接 = Blend(E+1..E+B, S+1..S+B)
  //         第 0 帧 === 末帧 === raw[S + B]
  // --------------------------------------------------------------------------
  if (canOverlapForward) {
    const bodyStart = safeStart + insertCount;
    const bodyFrames = allFrames.slice(bodyStart, safeEnd + 1).map(cloneFrame);
    const bridgeContinuation = allFrames
      .slice(safeEnd + 1, safeEnd + 1 + insertCount)
      .map(cloneFrame);

    const hStart = getHipsPos(allFrames[safeStart].landmarks);
    const hEnd = getHipsPos(allFrames[safeEnd].landmarks);
    const cycleDriftX = hEnd[0] - hStart[0];
    const cycleDriftZ = hEnd[2] - hStart[2];

    const bridgeLeadIn = allFrames
      .slice(safeStart + 1, safeStart + 1 + insertCount)
      .map(cloneFrame);

    const bodyCount = bodyFrames.length;
    const totalFrames = bodyCount + insertCount;
    const loopSpan = Math.max(1, totalFrames - 1);

    // 三段共享同一连续 XZ 坐标系（绝不出现主体扣了偏移而桥接段没扣的断层）
    if (inPlace) {
      for (let i = 0; i < bodyCount; i++) {
        const frac = i / loopSpan;
        shiftFrameXZInPlace(bodyFrames[i], -cycleDriftX * frac, -cycleDriftZ * frac);
      }
      for (let k = 0; k < insertCount; k++) {
        const frac = (bodyCount + k) / loopSpan;
        shiftFrameXZInPlace(bridgeContinuation[k], -cycleDriftX * frac, -cycleDriftZ * frac);
        shiftFrameXZInPlace(bridgeLeadIn[k], cycleDriftX * (1 - frac), cycleDriftZ * (1 - frac));
      }
    } else {
      for (let k = 0; k < insertCount; k++) {
        shiftFrameXZInPlace(bridgeLeadIn[k], cycleDriftX, cycleDriftZ);
      }
    }

    const resultFrames: LandmarkFrame[] = [...bodyFrames];

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

    for (let i = 0; i < totalFrames; i++) {
      resultFrames[i].time = i / fps;
    }

    return {
      ...landmarkData,
      totalFrames,
      duration: resultFrames[totalFrames - 1].time,
      frames: resultFrames,
      loopMode: 'overlap',
      loopStartFrame: 0,
      loopBridgeFrames: insertCount,
      loopInPlace: inPlace,
      bridgeContinuation,
      bridgeLeadIn,
    };
  }

  // --------------------------------------------------------------------------
  // 模式 2：结尾无后续帧兜底 (Warp 模式：raw[S .. E] + 预览闭环)
  // --------------------------------------------------------------------------
  const resultFrames = allFrames.slice(safeStart, safeEnd + 1).map(cloneFrame);
  const totalFrames = resultFrames.length;

  if (inPlace && totalFrames > 1) {
    const firstH = getHipsPos(resultFrames[0].landmarks);
    const lastH = getHipsPos(resultFrames[totalFrames - 1].landmarks);
    const totalDriftX = lastH[0] - firstH[0];
    const totalDriftZ = lastH[2] - firstH[2];

    for (let i = 0; i < totalFrames; i++) {
      const frac = i / (totalFrames - 1);
      shiftFrameXZInPlace(resultFrames[i], -totalDriftX * frac, -totalDriftZ * frac);
    }
  }

  if (totalFrames >= 6) {
    const boneNames = Object.keys(resultFrames[0].landmarks);
    const seamRadius = Math.max(4, Math.min(Math.floor(totalFrames / 3), insertCount));
    const buf = new Float64Array(totalFrames);

    for (let b = 0; b < boneNames.length; b++) {
      const bone = boneNames[b];
      if (!resultFrames.every((fr) => !!fr.landmarks[bone])) continue;

      for (let axis = 0; axis < 3; axis++) {
        if (!inPlace && (axis === 0 || axis === 2)) continue;
        for (let i = 0; i < totalFrames; i++) buf[i] = resultFrames[i].landmarks[bone][axis];
        closeScalarTrackPeriodic(buf, totalFrames, seamRadius, 2);
        for (let i = 0; i < totalFrames; i++) resultFrames[i].landmarks[bone][axis] = buf[i];
      }
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
    loopMode: 'warp',
    loopStartFrame: 0,
    loopBridgeFrames: insertCount,
    loopInPlace: inPlace,
    bridgeContinuation: undefined,
    bridgeLeadIn: undefined,
  };
}

// ============================================================================
// 四、核心出口：旋转空间 (S^3) + Hips 位移空间 (R^3) 统一闭环解算
// ============================================================================

export function solveHumanoidRotationLoop(
  data: LandmarkData,
  solveSequence: SequenceSolverFn
): {
  times: number[];
  hipsPositions: number[];
  quatTracksData: Record<HumanoidBoneName, number[]>;
} {
  const frames = data.frames;
  const frameCount = frames.length;
  const times = frames.map((f) => f.time);

  const hipsPositions: number[] = [];
  const quatTracksData: Record<HumanoidBoneName, number[]> = {} as any;
  HUMANOID_BONES.forEach((k) => (quatTracksData[k] = []));

  const hasOverlap =
    data.loopMode === 'overlap' &&
    !!data.loopBridgeFrames &&
    data.loopBridgeFrames > 0 &&
    data.bridgeContinuation?.length === data.loopBridgeFrames &&
    data.bridgeLeadIn?.length === data.loopBridgeFrames &&
    data.loopBridgeFrames < frameCount;

  const bridgeCount = hasOverlap ? data.loopBridgeFrames! : 0;
  const bodyCount = frameCount - bridgeCount;

  // 1. 解算主体帧（0 .. bodyCount - 1）
  const bodyRes = solveSequence(frames.slice(0, bodyCount));
  for (let i = 0; i < bodyCount; i++) {
    const hp = bodyRes.hipsArr[i];
    hipsPositions.push(hp.x, hp.y, hp.z);
    HUMANOID_BONES.forEach((k) => {
      const q = bodyRes.quatsArr[k][i];
      quatTracksData[k].push(q.x, q.y, q.z, q.w);
    });
  }

  // 2. Overlap 交叉叠化（在四元数空间 S^3 对 Track A 与 Track B 执行 SLERP）
  if (hasOverlap) {
    const resA = solveSequence(data.bridgeContinuation!, bodyRes.lastPrevQuats);
    // 独立连续解算 Track B，确保其内在旋转平滑，随后统一对其末帧与 bodyRes[0] 做半球符号对齐
    const resB = solveSequence(data.bridgeLeadIn!);

    HUMANOID_BONES.forEach((bone) => {
      const arrB = resB.quatsArr[bone];
      const qEndB = arrB[bridgeCount - 1];
      const qBody0 = bodyRes.quatsArr[bone][0];
      if (qEndB && qBody0 && qEndB.dot(qBody0) < 0) {
        for (let i = 0; i < bridgeCount; i++) {
          arrB[i].set(-arrB[i].x, -arrB[i].y, -arrB[i].z, -arrB[i].w);
        }
      }
    });

    const tmpQ = new THREE.Quaternion();
    const tmpB = new THREE.Quaternion();

    for (let k = 0; k < bridgeCount; k++) {
      const u = (k + 1) / bridgeCount;
      const w = u * u * u * (u * (u * 6 - 15) + 10);

      const hA = resA.hipsArr[k];
      const hB = resB.hipsArr[k];
      hipsPositions.push(
        hA.x * (1 - w) + hB.x * w,
        hA.y * (1 - w) + hB.y * w,
        hA.z * (1 - w) + hB.z * w
      );

      HUMANOID_BONES.forEach((bone) => {
        const qA = resA.quatsArr[bone][k];
        const qB = resB.quatsArr[bone][k];
        tmpB.copy(qB);
        if (qA.dot(tmpB) < 0) tmpB.set(-tmpB.x, -tmpB.y, -tmpB.z, -tmpB.w);
        tmpQ.copy(qA).slerp(tmpB, w).normalize();
        quatTracksData[bone].push(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
      });
    }
  }

  // 3. 统一周期闭环后处理（严格 0 .. frameCount - 1 闭环）
  const E = frameCount - 1;
  if (E < 4) {
    return { times, hipsPositions, quatTracksData };
  }

  const bridgeFrames = data.loopBridgeFrames || 10;
  const seamRadius = Math.max(4, Math.min(Math.floor(E / 3), Math.max(5, bridgeFrames)));
  // Overlap 模式下本身首尾已天然对齐，只需 1 轮极轻周期磨圆；Warp 模式用 3 轮磨圆任意接缝折角
  const smoothPasses = hasOverlap ? 1 : 3;

  // 3A. Hips 位移闭环：Y 轴始终闭环；X / Z 轴仅在 loopInPlace 为 true 时闭环
  const hipsBuf = new Float64Array(frameCount);
  for (let axis = 0; axis < 3; axis++) {
    if (!data.loopInPlace && (axis === 0 || axis === 2)) continue;
    for (let i = 0; i < frameCount; i++) hipsBuf[i] = hipsPositions[i * 3 + axis];
    closeScalarTrackPeriodic(hipsBuf, frameCount, seamRadius, smoothPasses);
    for (let i = 0; i < frameCount; i++) hipsPositions[i * 3 + axis] = hipsBuf[i];
  }

  // 3B. 52 根骨骼旋转闭环：全周期旋转差摊销 + 局部周期热核磨圆 (SLERP)
  const q0 = new THREE.Quaternion();
  const qE = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const qCur = new THREE.Quaternion();
  const qCorr = new THREE.Quaternion();
  const qAvg = new THREE.Quaternion();
  const dVec = new THREE.Vector3();
  const rVec = new THREE.Vector3();
  const period = E;

  HUMANOID_BONES.forEach((k) => {
    const arr = quatTracksData[k];

    // 连续半球符号统一
    for (let i = 1; i < frameCount; i++) {
      const pOff = (i - 1) * 4;
      const cOff = i * 4;
      if (
        arr[pOff] * arr[cOff] +
          arr[pOff + 1] * arr[cOff + 1] +
          arr[pOff + 2] * arr[cOff + 2] +
          arr[pOff + 3] * arr[cOff + 3] <
        0
      ) {
        arr[cOff] = -arr[cOff];
        arr[cOff + 1] = -arr[cOff + 1];
        arr[cOff + 2] = -arr[cOff + 2];
        arr[cOff + 3] = -arr[cOff + 3];
      }
    }

    q0.set(arr[0], arr[1], arr[2], arr[3]).normalize();
    qE.set(arr[E * 4], arr[E * 4 + 1], arr[E * 4 + 2], arr[E * 4 + 3]).normalize();
    if (q0.dot(qE) < 0) qE.set(-qE.x, -qE.y, -qE.z, -qE.w);

    // 1) 全周期均匀摊销首尾旋转差 dVec = log(q0 * qE^-1)
    qTmp.copy(qE).invert().premultiply(q0);
    quatLog(qTmp, dVec);

    if (dVec.lengthSq() > 1e-10) {
      for (let i = 0; i <= E; i++) {
        rVec.copy(dVec).multiplyScalar(i / E - 0.5);
        quatExp(rVec, qCorr);
        qCur.set(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]).normalize();
        qCur.premultiply(qCorr).normalize();
        arr[i * 4] = qCur.x;
        arr[i * 4 + 1] = qCur.y;
        arr[i * 4 + 2] = qCur.z;
        arr[i * 4 + 3] = qCur.w;
      }
    }

    // 同步首尾闭合点供周期热核计算
    let initLx = arr[0], initLy = arr[1], initLz = arr[2], initLw = arr[3];
    const initPrevOff = (E - 1) * 4;
    if (
      arr[initPrevOff] * initLx +
        arr[initPrevOff + 1] * initLy +
        arr[initPrevOff + 2] * initLz +
        arr[initPrevOff + 3] * initLw <
      0
    ) {
      initLx = -initLx; initLy = -initLy; initLz = -initLz; initLw = -initLw;
    }
    arr[E * 4] = initLx;
    arr[E * 4 + 1] = initLy;
    arr[E * 4 + 2] = initLz;
    arr[E * 4 + 3] = initLw;

    // 2) 接缝局部周期热核磨圆 (SLERP 严格凸组合，消除最后两帧任何折角)
    const out = new Float32Array(frameCount * 4);
    for (let p = 0; p < smoothPasses; p++) {
      for (let i = 0; i < period; i++) {
        const cx = arr[i * 4];
        const cy = arr[i * 4 + 1];
        const cz = arr[i * 4 + 2];
        const cw = arr[i * 4 + 3];

        const blend = getSeamDiffusionWeight(i, frameCount, seamRadius);
        if (blend <= 1e-4) {
          out[i * 4] = cx;
          out[i * 4 + 1] = cy;
          out[i * 4 + 2] = cz;
          out[i * 4 + 3] = cw;
          continue;
        }

        const iPrev = (i - 1 + period) % period;
        const iNext = (i + 1) % period;

        let px = arr[iPrev * 4], py = arr[iPrev * 4 + 1], pz = arr[iPrev * 4 + 2], pw = arr[iPrev * 4 + 3];
        if (px * cx + py * cy + pz * cz + pw * cw < 0) {
          px = -px; py = -py; pz = -pz; pw = -pw;
        }

        let nx = arr[iNext * 4], ny = arr[iNext * 4 + 1], nz = arr[iNext * 4 + 2], nw = arr[iNext * 4 + 3];
        if (nx * cx + ny * cy + nz * cz + nw * cw < 0) {
          nx = -nx; ny = -ny; nz = -nz; nw = -nw;
        }

        qAvg.set(
          (px + 2 * cx + nx) * 0.25,
          (py + 2 * cy + ny) * 0.25,
          (pz + 2 * cz + nz) * 0.25,
          (pw + 2 * cw + nw) * 0.25
        ).normalize();

        qCur.set(cx, cy, cz, cw).normalize();
        if (qCur.dot(qAvg) < 0) {
          qAvg.set(-qAvg.x, -qAvg.y, -qAvg.z, -qAvg.w);
        }
        qCur.slerp(qAvg, blend).normalize();

        out[i * 4] = qCur.x;
        out[i * 4 + 1] = qCur.y;
        out[i * 4 + 2] = qCur.z;
        out[i * 4 + 3] = qCur.w;
      }

      // 连续半球对齐
      for (let i = 1; i < period; i++) {
        const px = out[(i - 1) * 4], py = out[(i - 1) * 4 + 1], pz = out[(i - 1) * 4 + 2], pw = out[(i - 1) * 4 + 3];
        const cx = out[i * 4], cy = out[i * 4 + 1], cz = out[i * 4 + 2], cw = out[i * 4 + 3];
        if (px * cx + py * cy + pz * cz + pw * cw < 0) {
          out[i * 4] = -cx; out[i * 4 + 1] = -cy; out[i * 4 + 2] = -cz; out[i * 4 + 3] = -cw;
        }
      }

      const lastPrevIdx = (period - 1) * 4;
      let q0x = out[0], q0y = out[1], q0z = out[2], q0w = out[3];
      if (
        out[lastPrevIdx] * q0x +
          out[lastPrevIdx + 1] * q0y +
          out[lastPrevIdx + 2] * q0z +
          out[lastPrevIdx + 3] * q0w <
        0
      ) {
        q0x = -q0x; q0y = -q0y; q0z = -q0z; q0w = -q0w;
      }
      out[E * 4] = q0x;
      out[E * 4 + 1] = q0y;
      out[E * 4 + 2] = q0z;
      out[E * 4 + 3] = q0w;

      for (let j = 0; j < out.length; j++) {
        arr[j] = out[j];
      }
    }
  });

  return { times, hipsPositions, quatTracksData };
}
