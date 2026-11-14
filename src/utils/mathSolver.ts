// src/utils/mathSolver.ts
import * as THREE from 'three';
import { solveFingers } from '../solvers/fingerSolver';
import { solveHips } from '../solvers/hipsSolver';
import { solveLimbs } from '../solvers/limbSolver';
import { ensureQuatContinuity, getV, hasBone } from '../solvers/mathUtils';
import { solveSpine } from '../solvers/spineSolver';
import { StandardBone } from '../types/boneMapping';
import { HUMANOID_BONES, HumanoidBoneName, LandmarkData, LandmarkFrame } from '../types/types';

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
  const leftFingers = solveFingers(lm, true);
  const rightFingers = solveFingers(lm, false);

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

  const isWarpMode =
    data.loopMode === 'warp' &&
    !!data.loopBridgeFrames &&
    data.loopBridgeFrames > 0 &&
    frameCount > 6;

  const bridgeCount = hasOverlapBridge ? data.loopBridgeFrames! : 0;
  const bodyCount = frameCount - bridgeCount;

  const times: number[] = frames.map((f) => f.time);
  const hipsPositions: number[] = [];
  const quatTracksData: Record<HumanoidBoneName, number[]> = {} as any;
  HUMANOID_BONES.forEach((k) => (quatTracksData[k] = []));

  // 1. 解算主体帧（Overlap 模式下为 bodyCount 帧；Warp 或无循环下为全部帧）
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

    const resB = solveSequenceContinuous(
      data.bridgeLeadIn!,
      scaleFactor,
      ankleBaseY,
      restLm
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

    // 原地循环：从拼接后的 hipsPositions 扣除线性 XZ 前进斜坡，保留 100% 摇摆和 Y 起伏
    if (data.loopInPlace && frameCount > 1) {
      const firstX = hipsPositions[0];
      const firstZ = hipsPositions[2];
      const lastIdx = (frameCount - 1) * 3;
      const driftX = hipsPositions[lastIdx] - firstX;
      const driftZ = hipsPositions[lastIdx + 2] - firstZ;

      for (let i = 0; i < frameCount; i++) {
        const frac = i / (frameCount - 1);
        hipsPositions[i * 3] -= driftX * frac;
        hipsPositions[i * 3 + 2] -= driftZ * frac;
      }
    }
  }

  // 2B. Additive Pose Warp 兜底模式（结尾无延续帧时，双向加性残差分散，100% 保持原动作摆幅）
  if (isWarpMode) {
    const half = Math.max(2, Math.min(Math.floor((frameCount - 1) / 2), Math.floor(data.loopBridgeFrames! / 2)));
    const qId = new THREE.Quaternion(0, 0, 0, 1);
    const qS = new THREE.Quaternion();
    const qE = new THREE.Quaternion();
    const qDelta = new THREE.Quaternion();
    const qCur = new THREE.Quaternion();
    const qCorr = new THREE.Quaternion();

    HUMANOID_BONES.forEach((k) => {
      const arr = quatTracksData[k];
      qS.set(arr[0], arr[1], arr[2], arr[3]).normalize();
      const tail = (frameCount - 1) * 4;
      qE.set(arr[tail], arr[tail + 1], arr[tail + 2], arr[tail + 3]).normalize();
      if (qS.dot(qE) < 0) qE.set(-qE.x, -qE.y, -qE.z, -qE.w);

      // qMid 为首尾折中点：尾端向前靠向 qMid，首端向后靠向 qMid，均保持原动作全部振荡幅度
      qDelta.copy(qE).invert().premultiply(qS); // qDelta * qE = qS
      const qHalfDelta = new THREE.Quaternion().copy(qId).slerp(qDelta, 0.5);
      const qHalfInv = qHalfDelta.clone().invert();

      // 首部 [0 .. half-1] 从 qHalfInv(满) 平滑衰减至 0
      for (let i = 0; i < half; i++) {
        const u = 1 - i / half;
        const w = u * u * (3 - 2 * u);
        qCur.set(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]);
        qCorr.copy(qId).slerp(qHalfInv, w);
        qCur.premultiply(qCorr).normalize();
        arr[i * 4] = qCur.x;
        arr[i * 4 + 1] = qCur.y;
        arr[i * 4 + 2] = qCur.z;
        arr[i * 4 + 3] = qCur.w;
      }

      // 尾部 [frameCount - half .. frameCount - 1] 从 0 平滑爬升至 qHalfDelta(满)
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
    });

    // Hips Y 首尾差平滑校准
    const h0y = hipsPositions[1];
    const hNy = hipsPositions[(frameCount - 1) * 3 + 1];
    const dy = h0y - hNy;
    for (let i = 0; i < half; i++) {
      const wStart = 1 - i / half;
      hipsPositions[i * 3 + 1] -= 0.5 * dy * wStart * wStart * (3 - 2 * wStart);
      const tailIdx = frameCount - half + i;
      const wEnd = (i + 1) / half;
      hipsPositions[tailIdx * 3 + 1] += 0.5 * dy * wEnd * wEnd * (3 - 2 * wEnd);
    }
  }

  // 3. 闭环环形轻微平滑与 Three.js LoopRepeat 首尾闭合契约
  const isLoop = hasOverlapBridge || isWarpMode;
  const period = isLoop ? frameCount - 1 : frameCount;
  const resolveIndex = (i: number, offset: number): number => {
    if (isLoop) {
      return ((i + offset) % period + period) % period;
    }
    return Math.max(0, Math.min(frameCount - 1, i + offset));
  };

  if (frameCount > 4) {
    for (let axis = 0; axis < 3; axis++) {
      const smoothed = new Float32Array(frameCount);
      for (let i = 0; i < period; i++) {
        const p0 = hipsPositions[resolveIndex(i, -1) * 3 + axis];
        const p1 = hipsPositions[i * 3 + axis];
        const p2 = hipsPositions[resolveIndex(i, 1) * 3 + axis];
        smoothed[i] = (p0 + p1 * 2 + p2) / 4;
      }
      if (isLoop) {
        smoothed[frameCount - 1] = smoothed[0];
      }
      for (let i = 0; i < frameCount; i++) {
        hipsPositions[i * 3 + axis] = smoothed[i];
      }
    }

    const weights = [1, 2, 1];
    HUMANOID_BONES.forEach((k) => {
      const arr = quatTracksData[k];
      const out = new Float32Array(frameCount * 4);

      for (let i = 0; i < period; i++) {
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

      for (let i = 1; i < period; i++) {
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
        const lastPrevIdx = (period - 1) * 4;
        let q0x = out[0];
        let q0y = out[1];
        let q0z = out[2];
        let q0w = out[3];

        const dot =
          out[lastPrevIdx] * q0x +
          out[lastPrevIdx + 1] * q0y +
          out[lastPrevIdx + 2] * q0z +
          out[lastPrevIdx + 3] * q0w;

        if (dot < 0) {
          q0x = -q0x;
          q0y = -q0y;
          q0z = -q0z;
          q0w = -q0w;
        }

        const tailIdx = (frameCount - 1) * 4;
        out[tailIdx] = q0x;
        out[tailIdx + 1] = q0y;
        out[tailIdx + 2] = q0z;
        out[tailIdx + 3] = q0w;
      }

      for (let j = 0; j < out.length; j++) {
        arr[j] = out[j];
      }
    });
  }

  return { times, hipsPositions, quatTracksData };
}
