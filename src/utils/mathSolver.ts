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

  // 若启用了循环模式，直接交由专属循环解算器统一完成旋转空间闭环并返回
  if (data.loopMode) {
    return solveHumanoidRotationLoop(data, (seq, initPrev) =>
      solveSequenceContinuous(seq, scaleFactor, ankleBaseY, restLm, initPrev)
    );
  }

  // 非循环普通片段：纯运动学连续解算 + Hips 轻平滑
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

  return { times, hipsPositions, quatTracksData };
}
