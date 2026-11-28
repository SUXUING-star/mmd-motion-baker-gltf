// src/utils/mathSolver.ts
import * as THREE from 'three';
import { solveFingers } from '../solvers/fingerSolver';
import { solveHips } from '../solvers/hipsSolver';
import { solveLimbs } from '../solvers/limbSolver';
import { SequenceSolveResult, solveHumanoidRotationLoop } from '../solvers/loopSolver';
import { ensureQuatContinuity, getV, hasBone } from '../solvers/mathUtils';
import { solveSpine } from '../solvers/spineSolver';
import { HUMANOID_BONES, HumanoidBoneName, StandardBone } from '../types/boneMapping';
import { LandmarkData, LandmarkFrame } from '../types/types';
import {
    applyRootPostProcessToSolvedHumanoid,
    LandmarkDataWithPostProcess,
    RootPostProcessConfig,
} from './rootPostProcess';

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
): SequenceSolveResult {
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

/**
 * 导出前对 52 根骨骼四元数施加对称高斯 SLERP 平滑，消除 IK/方向解算产生的关节旋转抖动
 */
function applyQuaternionSlerpSmoothing(
  quatTracksData: Record<HumanoidBoneName, number[]>,
  smoothStrength?: number
): void {
  if (!smoothStrength || smoothStrength <= 0) return;

  const alpha = Math.max(0, Math.min(1, smoothStrength / 100));
  const sigma = 0.5 + alpha * 1.1;
  const radius = Math.max(1, Math.ceil(sigma * 2));
  const blend = Math.min(0.85, alpha * 0.65);

  const weights = new Float32Array(radius * 2 + 1);
  for (let d = -radius; d <= radius; d++) {
    weights[d + radius] = Math.exp(-0.5 * (d / sigma) * (d / sigma));
  }

  const qOrig = new THREE.Quaternion();
  const qAvg = new THREE.Quaternion();

  for (const boneName of HUMANOID_BONES) {
    const arr = quatTracksData[boneName];
    if (!arr || arr.length < 12) continue;
    const frameCount = Math.floor(arr.length / 4);
    const out = new Float32Array(arr.length);

    for (let i = 0; i < frameCount; i++) {
      const i4 = i * 4;
      const bx = arr[i4];
      const by = arr[i4 + 1];
      const bz = arr[i4 + 2];
      const bw = arr[i4 + 3];

      let ax = 0, ay = 0, az = 0, aw = 0;
      for (let d = -radius; d <= radius; d++) {
        const idx = Math.max(0, Math.min(frameCount - 1, i + d));
        const j4 = idx * 4;
        const w = weights[d + radius];
        const dot = arr[j4] * bx + arr[j4 + 1] * by + arr[j4 + 2] * bz + arr[j4 + 3] * bw;
        const sgn = dot < 0 ? -1 : 1;
        ax += arr[j4] * sgn * w;
        ay += arr[j4 + 1] * sgn * w;
        az += arr[j4 + 2] * sgn * w;
        aw += arr[j4 + 3] * sgn * w;
      }

      qOrig.set(bx, by, bz, bw).normalize();
      qAvg.set(ax, ay, az, aw).normalize();
      qOrig.slerp(qAvg, blend);

      out[i4] = qOrig.x;
      out[i4 + 1] = qOrig.y;
      out[i4 + 2] = qOrig.z;
      out[i4 + 3] = qOrig.w;
    }

    for (let k = 0; k < arr.length; k++) {
      arr[k] = out[k];
    }
  }
}

export function solveAllHumanoidQuaternions(
  data: LandmarkData | LandmarkDataWithPostProcess,
  rootPostProcessOverride?: RootPostProcessConfig
) {
  const { frames } = data;
  if (frames.length === 0) {
    return { times: [], hipsPositions: [], quatTracksData: {} as any };
  }

  const extData = data as LandmarkDataWithPostProcess;
  const rootPostProcess = rootPostProcessOverride ?? extData.rootPostProcess;
  const smoothStrength = extData.smoothStrength ?? 0;

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

  if (data.loopMode) {
    const loopResult = solveHumanoidRotationLoop(data, (seq, initPrev) =>
      solveSequenceContinuous(seq, scaleFactor, ankleBaseY, restLm, initPrev)
    );
    applyQuaternionSlerpSmoothing(loopResult.quatTracksData, smoothStrength);
    applyRootPostProcessToSolvedHumanoid(
      loopResult.hipsPositions,
      loopResult.quatTracksData,
      rootPostProcess
    );
    return loopResult;
  }

  const frameCount = frames.length;
  const times: number[] = frames.map((f) => f.time);
  const hipsPositions: number[] = [];
  const quatTracksData: Record<HumanoidBoneName, number[]> = {} as any;
  HUMANOID_BONES.forEach((k) => (quatTracksData[k] = []));

  const res = solveSequenceContinuous(frames, scaleFactor, ankleBaseY, restLm);
  for (let i = 0; i < frameCount; i++) {
    const hp = res.hipsArr[i];
    hipsPositions.push(hp.x, hp.y, hp.z);
    HUMANOID_BONES.forEach((k) => {
      const q = res.quatsArr[k][i];
      quatTracksData[k].push(q.x, q.y, q.z, q.w);
    });
  }

  if (frameCount > 4) {
    for (let axis = 0; axis < 3; axis++) {
      const smoothed = new Float32Array(frameCount);
      for (let i = 0; i < frameCount; i++) {
        const p0 = hipsPositions[Math.max(0, i - 1) * 3 + axis];
        const p1 = hipsPositions[i * 3 + axis];
        const p2 = hipsPositions[Math.min(frameCount - 1, i + 1) * 3 + axis];
        smoothed[i] = (p0 + p1 * 2 + p2) * 0.25;
      }
      for (let i = 0; i < frameCount; i++) {
        hipsPositions[i * 3 + axis] = smoothed[i];
      }
    }
  }

  applyQuaternionSlerpSmoothing(quatTracksData, smoothStrength);
  applyRootPostProcessToSolvedHumanoid(hipsPositions, quatTracksData, rootPostProcess);

  return { times, hipsPositions, quatTracksData };
}
