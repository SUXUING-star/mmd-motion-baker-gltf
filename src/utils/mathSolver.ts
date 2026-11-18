// src/utils/mathSolver.ts
import * as THREE from 'three';
import { solveFingers } from '../solvers/fingerSolver';
import { solveHips } from '../solvers/hipsSolver';
import { solveLimbs } from '../solvers/limbSolver';
import { ensureQuatContinuity, getV, hasBone } from '../solvers/mathUtils';
import { solveSpine } from '../solvers/spineSolver';
import { HUMANOID_BONES, HumanoidBoneName, StandardBone } from '../types/boneMapping';
import { LandmarkData, LandmarkFrame } from '../types/types';

function solveSingleFramePose(
  lm: Record<string, [number, number, number]>,
  scaleFactor: number,
  ankleBaseY: number,
  restLm?: Record<string, [number, number, number]>
): { hipsPos: THREE.Vector3; localMap: Record<HumanoidBoneName, THREE.Quaternion> } {
  const hips = solveHips(lm, scaleFactor, ankleBaseY);
  const spine = solveSpine(lm, hips.hipsWorldQ, hips.hipForward, restLm);
  const limbs = solveLimbs(
    lm,
    spine.spineWorldQ,
    hips.hipsWorldQ,
    hips.hipSideOrtho,
    spine.spineUp,
    restLm
  );
  const leftFingers = solveFingers(lm, true, limbs.leftHandWorldQ, restLm);
  const rightFingers = solveFingers(lm, false, limbs.rightHandWorldQ, restLm);

  return {
    hipsPos: hips.hipsPosition,
    localMap: {
      hips: hips.hipsWorldQ,
      ...spine.localRotations,
      ...limbs.localRotations,
      ...leftFingers,
      ...rightFingers,
    } as Record<HumanoidBoneName, THREE.Quaternion>,
  };
}

function solveSequenceContinuous(
  seqFrames: LandmarkFrame[],
  scaleFactor: number,
  ankleBaseY: number,
  restLm: Record<string, [number, number, number]> | undefined,
  initPrevQuats?: Partial<Record<HumanoidBoneName, THREE.Quaternion>>
) {
  const hipsArr: THREE.Vector3[] = [];
  const quatsArr: Record<HumanoidBoneName, THREE.Quaternion[]> = {} as any;
  HUMANOID_BONES.forEach((k) => (quatsArr[k] = []));

  const prevQuats: Partial<Record<HumanoidBoneName, THREE.Quaternion>> = {
    ...(initPrevQuats || {}),
  };

  for (let i = 0; i < seqFrames.length; i++) {
    const { hipsPos, localMap } = solveSingleFramePose(
      seqFrames[i].landmarks,
      scaleFactor,
      ankleBaseY,
      restLm
    );
    hipsArr.push(hipsPos);

    HUMANOID_BONES.forEach((k) => {
      const qRaw = localMap[k] || new THREE.Quaternion(0, 0, 0, 1);
      const qCont = ensureQuatContinuity(qRaw, prevQuats[k]);
      prevQuats[k] = qCont.clone();
      quatsArr[k].push(qCont);
    });
  }

  return { hipsArr, quatsArr, lastPrevQuats: prevQuats };
}

export function solveAllHumanoidQuaternions(data: LandmarkData) {
  const { frames } = data;
  if (frames.length === 0) {
    return { times: [], hipsPositions: [], quatTracksData: {} as any };
  }

  const f0 = frames[0].landmarks;
  const restLm = data.restLandmarks;

  const pPelvis0 = hasBone(f0, StandardBone.Hips)
    ? getV(f0, StandardBone.Hips)
    : getV(f0, StandardBone.Root, new THREE.Vector3(0, 9.5, 0));
  const pPelvis0Y = pPelvis0.y;

  const pLAnkle0Y = getV(f0, StandardBone.LeftFoot, new THREE.Vector3(0, 1.0, 0)).y;
  const pRAnkle0Y = getV(f0, StandardBone.RightFoot, new THREE.Vector3(0, 1.0, 0)).y;
  const ankleBaseY = (pLAnkle0Y + pRAnkle0Y) / 2;

  const mmdLegSpan = Math.max(0.5, pPelvis0Y - ankleBaseY);
  const scaleFactor = 0.87 / mmdLegSpan;

  const frameCount = frames.length;
  const hasOverlapBridge =
    data.loopMode === 'overlap' &&
    !!data.loopBridgeFrames &&
    data.loopBridgeFrames > 0 &&
    data.bridgeContinuation?.length === data.loopBridgeFrames &&
    data.bridgeLeadIn?.length === data.loopBridgeFrames &&
    data.loopBridgeFrames < frameCount;

  const loopStart =
    hasOverlapBridge || data.loopMode === 'warp'
      ? Math.max(0, Math.min(frameCount - 2, data.loopStartFrame ?? 0))
      : 0;

  const isWarpMode =
    data.loopMode === 'warp' &&
    !!data.loopBridgeFrames &&
    data.loopBridgeFrames > 0 &&
    frameCount - loopStart > 6;

  const bridgeCount = hasOverlapBridge ? data.loopBridgeFrames! : 0;
  const bodyCount = frameCount - bridgeCount;

  const times: number[] = frames.map((f) => f.time);
  const hipsPositions: number[] = [];
  const quatTracksData: Record<HumanoidBoneName, number[]> = {} as any;
  HUMANOID_BONES.forEach((k) => (quatTracksData[k] = []));

  // 1. 解算主体帧（包含前导动作 + 循环体）
  const bodyRes = solveSequenceContinuous(
    frames.slice(0, bodyCount),
    scaleFactor,
    ankleBaseY,
    restLm
  );

  for (let i = 0; i < bodyCount; i++) {
    const hp = bodyRes.hipsArr[i];
    hipsPositions.push(hp.x, hp.y, hp.z);
    HUMANOID_BONES.forEach((k) => {
      const q = bodyRes.quatsArr[k][i];
      quatTracksData[k].push(q.x, q.y, q.z, q.w);
    });
  }

  // 2A. 同相位交叠融合模式：Track A (E+1..E+B) -> Track B (S+1..S+B)
  if (hasOverlapBridge) {
    const resA = solveSequenceContinuous(
      data.bridgeContinuation!,
      scaleFactor,
      ankleBaseY,
      restLm,
      bodyRes.lastPrevQuats
    );

    // 若保留了前导动作，Track B 从 bodyRes 在 S 处的四元数半球延续，避免跨半圈符号翻转
    let initResB: Partial<Record<HumanoidBoneName, THREE.Quaternion>> | undefined;
    const safeStartInBody = loopStart - bridgeCount;
    if (loopStart > 0 && safeStartInBody >= 0 && safeStartInBody < bodyCount) {
      initResB = {};
      HUMANOID_BONES.forEach((k) => {
        initResB![k] = bodyRes.quatsArr[k][safeStartInBody].clone();
      });
    }

    const resB = solveSequenceContinuous(
      data.bridgeLeadIn!,
      scaleFactor,
      ankleBaseY,
      restLm,
      initResB
    );

    const prevMergedQuats: Partial<Record<HumanoidBoneName, THREE.Quaternion>> = {
      ...bodyRes.lastPrevQuats,
    };
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
        if (qA.dot(tmpB) < 0) {
          tmpB.set(-tmpB.x, -tmpB.y, -tmpB.z, -tmpB.w);
        }

        tmpQ.copy(qA).slerp(tmpB, w).normalize();

        const qFinal = ensureQuatContinuity(tmpQ, prevMergedQuats[bone]);
        prevMergedQuats[bone] = qFinal.clone();
        quatTracksData[bone].push(qFinal.x, qFinal.y, qFinal.z, qFinal.w);
      });
    }

    // 原地循环：仅对循环区 [loopStart .. frameCount - 1] 扣除残余线性 XZ 偏移，前导动作保持原样
    if (data.loopInPlace && frameCount - loopStart > 1) {
      const startIdx = loopStart * 3;
      const lastIdx = (frameCount - 1) * 3;
      const driftX = hipsPositions[lastIdx] - hipsPositions[startIdx];
      const driftZ = hipsPositions[lastIdx + 2] - hipsPositions[startIdx + 2];
      const span = frameCount - 1 - loopStart;

      for (let i = loopStart; i < frameCount; i++) {
        const frac = (i - loopStart) / span;
        hipsPositions[i * 3] -= driftX * frac;
        hipsPositions[i * 3 + 2] -= driftZ * frac;
      }
    }
  }

  // 2B. Additive Pose Warp 兜底模式（围绕 loopStart 与末尾 frameCount - 1 校准，不损坏前导动作）
  if (isWarpMode) {
    const loopLen = frameCount - loopStart;
    const half = Math.max(
      2,
      Math.min(Math.floor((loopLen - 1) / 2), Math.floor(data.loopBridgeFrames! / 2))
    );
    const qId = new THREE.Quaternion(0, 0, 0, 1);
    const qS = new THREE.Quaternion();
    const qE = new THREE.Quaternion();
    const qDelta = new THREE.Quaternion();
    const qCur = new THREE.Quaternion();
    const qCorr = new THREE.Quaternion();

    HUMANOID_BONES.forEach((k) => {
      const arr = quatTracksData[k];
      const sOff = loopStart * 4;
      qS.set(arr[sOff], arr[sOff + 1], arr[sOff + 2], arr[sOff + 3]).normalize();
      const tail = (frameCount - 1) * 4;
      qE.set(arr[tail], arr[tail + 1], arr[tail + 2], arr[tail + 3]).normalize();
      if (qS.dot(qE) < 0) qE.set(-qE.x, -qE.y, -qE.z, -qE.w);

      qDelta.copy(qE).invert().premultiply(qS); // qDelta * qE = qS

      if (loopStart === 0 || loopStart >= 4) {
        const qHalfDelta = new THREE.Quaternion().copy(qId).slerp(qDelta, 0.5);
        const qHalfInv = qHalfDelta.clone().invert();

        // 若有前导动作，同步在 loopStart 左侧过渡缓冲，防止前导->循环切点跳变
        if (loopStart >= 4) {
          const leftSpan = Math.min(half, loopStart);
          for (let i = 0; i < leftSpan; i++) {
            const idx = loopStart - leftSpan + i;
            const u = i / leftSpan;
            const w = u * u * (3 - 2 * u);
            qCur.set(arr[idx * 4], arr[idx * 4 + 1], arr[idx * 4 + 2], arr[idx * 4 + 3]);
            qCorr.copy(qId).slerp(qHalfInv, w);
            qCur.premultiply(qCorr).normalize();
            arr[idx * 4] = qCur.x;
            arr[idx * 4 + 1] = qCur.y;
            arr[idx * 4 + 2] = qCur.z;
            arr[idx * 4 + 3] = qCur.w;
          }
        }

        // 循环起点 [loopStart .. loopStart + half - 1]
        for (let i = 0; i < half; i++) {
          const idx = loopStart + i;
          const u = 1 - i / half;
          const w = u * u * (3 - 2 * u);
          qCur.set(arr[idx * 4], arr[idx * 4 + 1], arr[idx * 4 + 2], arr[idx * 4 + 3]);
          qCorr.copy(qId).slerp(qHalfInv, w);
          qCur.premultiply(qCorr).normalize();
          arr[idx * 4] = qCur.x;
          arr[idx * 4 + 1] = qCur.y;
          arr[idx * 4 + 2] = qCur.z;
          arr[idx * 4 + 3] = qCur.w;
        }

        // 循环尾部 [frameCount - half .. frameCount - 1]
        for (let i = 0; i < half; i++) {
          const idx = frameCount - half + i;
          const u = (i + 1) / half;
          const w = u * u * (3 - 2 * u);
          qCur.set(arr[idx * 4], arr[idx * 4 + 1], arr[idx * 4 + 2], arr[idx * 4 + 3]);
          qCorr.copy(qId).slerp(qHalfDelta, w);
          qCur.premultiply(qCorr).normalize();
          arr[idx * 4] = qCur.x;
          arr[idx * 4 + 1] = qCur.y;
          arr[idx * 4 + 2] = qCur.z;
          arr[idx * 4 + 3] = qCur.w;
        }
      } else {
        // 前导极短（1~3帧）时，只向尾部平滑吸收全部残差，完全不动第 0..loopStart 帧
        const tailSpan = Math.min(loopLen - 1, half * 2);
        for (let i = 0; i < tailSpan; i++) {
          const idx = frameCount - tailSpan + i;
          const u = (i + 1) / tailSpan;
          const w = u * u * (3 - 2 * u);
          qCur.set(arr[idx * 4], arr[idx * 4 + 1], arr[idx * 4 + 2], arr[idx * 4 + 3]);
          qCorr.copy(qId).slerp(qDelta, w);
          qCur.premultiply(qCorr).normalize();
          arr[idx * 4] = qCur.x;
          arr[idx * 4 + 1] = qCur.y;
          arr[idx * 4 + 2] = qCur.z;
          arr[idx * 4 + 3] = qCur.w;
        }
      }
    });

    // Hips Y 首尾差平滑校准
    const h0y = hipsPositions[loopStart * 3 + 1];
    const hNy = hipsPositions[(frameCount - 1) * 3 + 1];
    const dy = h0y - hNy;
    if (loopStart === 0 || loopStart >= 4) {
      if (loopStart >= 4) {
        const leftSpan = Math.min(half, loopStart);
        for (let i = 0; i < leftSpan; i++) {
          const idx = loopStart - leftSpan + i;
          const u = i / leftSpan;
          hipsPositions[idx * 3 + 1] -= 0.5 * dy * u * u * (3 - 2 * u);
        }
      }
      for (let i = 0; i < half; i++) {
        const wStart = 1 - i / half;
        hipsPositions[(loopStart + i) * 3 + 1] -= 0.5 * dy * wStart * wStart * (3 - 2 * wStart);
        const tailIdx = frameCount - half + i;
        const wEnd = (i + 1) / half;
        hipsPositions[tailIdx * 3 + 1] += 0.5 * dy * wEnd * wEnd * (3 - 2 * wEnd);
      }
    } else {
      const tailSpan = Math.min(loopLen - 1, half * 2);
      for (let i = 0; i < tailSpan; i++) {
        const idx = frameCount - tailSpan + i;
        const u = (i + 1) / tailSpan;
        hipsPositions[idx * 3 + 1] += dy * u * u * (3 - 2 * u);
      }
    }
  }

  // 3. 闭环环形轻微平滑与闭合契约（前导段 0..loopStart-1 不回绕，仅 loopStart..frameCount-1 闭环）
  const isLoop = hasOverlapBridge || isWarpMode;
  const activeCount = isLoop ? frameCount - 1 : frameCount;
  const loopPeriod = Math.max(1, frameCount - 1 - loopStart);

  const resolveIndex = (i: number, offset: number): number => {
    if (isLoop && i >= loopStart) {
      return loopStart + (((i - loopStart + offset) % loopPeriod + loopPeriod) % loopPeriod);
    }
    return Math.max(0, Math.min(frameCount - 1, i + offset));
  };

  if (frameCount > 4) {
    for (let axis = 0; axis < 3; axis++) {
      const smoothed = new Float32Array(frameCount);
      for (let i = 0; i < activeCount; i++) {
        const p0 = hipsPositions[resolveIndex(i, -1) * 3 + axis];
        const p1 = hipsPositions[i * 3 + axis];
        const p2 = hipsPositions[resolveIndex(i, 1) * 3 + axis];
        smoothed[i] = (p0 + p1 * 2 + p2) / 4;
      }
      if (isLoop) {
        smoothed[frameCount - 1] = smoothed[loopStart];
      }
      for (let i = 0; i < frameCount; i++) {
        hipsPositions[i * 3 + axis] = smoothed[i];
      }
    }

    const weights = [1, 2, 1];
    HUMANOID_BONES.forEach((k) => {
      const arr = quatTracksData[k];
      const out = new Float32Array(frameCount * 4);

      for (let i = 0; i < activeCount; i++) {
        const cx = arr[i * 4];
        const cy = arr[i * 4 + 1];
        const cz = arr[i * 4 + 2];
        const cw = arr[i * 4 + 3];

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let sw = 0;

        for (let offset = -1; offset <= 1; offset++) {
          const idx = resolveIndex(i, offset);
          const w = weights[offset + 1];
          let qx = arr[idx * 4];
          let qy = arr[idx * 4 + 1];
          let qz = arr[idx * 4 + 2];
          let qw = arr[idx * 4 + 3];

          if (qx * cx + qy * cy + qz * cz + qw * cw < 0) {
            qx = -qx;
            qy = -qy;
            qz = -qz;
            qw = -qw;
          }

          sx += qx * w;
          sy += qy * w;
          sz += qz * w;
          sw += qw * w;
        }

        const len = Math.hypot(sx, sy, sz, sw) || 1;
        out[i * 4] = sx / len;
        out[i * 4 + 1] = sy / len;
        out[i * 4 + 2] = sz / len;
        out[i * 4 + 3] = sw / len;
      }

      for (let i = 1; i < activeCount; i++) {
        const px = out[(i - 1) * 4];
        const py = out[(i - 1) * 4 + 1];
        const pz = out[(i - 1) * 4 + 2];
        const pw = out[(i - 1) * 4 + 3];

        const cx = out[i * 4];
        const cy = out[i * 4 + 1];
        const cz = out[i * 4 + 2];
        const cw = out[i * 4 + 3];

        if (px * cx + py * cy + pz * cz + pw * cw < 0) {
          out[i * 4] = -cx;
          out[i * 4 + 1] = -cy;
          out[i * 4 + 2] = -cz;
          out[i * 4 + 3] = -cw;
        }
      }

      if (isLoop) {
        const lastPrevIdx = (activeCount - 1) * 4;
        const loopBase = loopStart * 4;
        let qLx = out[loopBase];
        let qLy = out[loopBase + 1];
        let qLz = out[loopBase + 2];
        let qLw = out[loopBase + 3];

        const dot =
          out[lastPrevIdx] * qLx +
          out[lastPrevIdx + 1] * qLy +
          out[lastPrevIdx + 2] * qLz +
          out[lastPrevIdx + 3] * qLw;

        if (dot < 0) {
          qLx = -qLx;
          qLy = -qLy;
          qLz = -qLz;
          qLw = -qLw;
        }

        const tailIdx = (frameCount - 1) * 4;
        out[tailIdx] = qLx;
        out[tailIdx + 1] = qLy;
        out[tailIdx + 2] = qLz;
        out[tailIdx + 3] = qLw;
      }

      for (let j = 0; j < out.length; j++) {
        arr[j] = out[j];
      }
    });
  }

  return { times, hipsPositions, quatTracksData };
}
