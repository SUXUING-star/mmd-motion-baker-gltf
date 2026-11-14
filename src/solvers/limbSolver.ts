// src/solvers/limbSolver.ts
import * as THREE from 'three';
import { StandardBone, StandardBoneKey } from '../types/boneMapping';
import { clamp, getV, hasBone, inv, makeOrthoBasis, mul } from './mathUtils';

function solveAnatomicalLimb(
  P1: THREE.Vector3,
  P2: THREE.Vector3,
  P3: THREE.Vector3,
  type: 'leftArm' | 'rightArm',
  upRef: THREE.Vector3
) {
  const dUpper = new THREE.Vector3().subVectors(P2, P1).normalize();
  const dLower = new THREE.Vector3().subVectors(P3, P2).normalize();

  if (type === 'leftArm') {
    const axisX = dUpper.clone();
    const axisY = new THREE.Vector3().subVectors(
      upRef,
      axisX.clone().multiplyScalar(upRef.dot(axisX))
    ).normalize();
    const axisZ = new THREE.Vector3().crossVectors(axisX, axisY).normalize();
    const upperWorldQ = makeOrthoBasis(axisX, axisY, axisZ);

    const lowerX = dLower.clone();
    const lowerY = new THREE.Vector3().subVectors(
      upRef,
      lowerX.clone().multiplyScalar(upRef.dot(lowerX))
    ).normalize();
    const lowerZ = new THREE.Vector3().crossVectors(lowerX, lowerY).normalize();
    const lowerWorldQ = makeOrthoBasis(lowerX, lowerY, lowerZ);

    return { upperWorldQ, lowerWorldQ };
  } else {
    const axisX = dUpper.clone().negate();
    const axisY = new THREE.Vector3().subVectors(
      upRef,
      axisX.clone().multiplyScalar(upRef.dot(axisX))
    ).normalize();
    const axisZ = new THREE.Vector3().crossVectors(axisX, axisY).normalize();
    const upperWorldQ = makeOrthoBasis(axisX, axisY, axisZ);

    const lowerX = dLower.clone().negate();
    const lowerY = new THREE.Vector3().subVectors(
      upRef,
      lowerX.clone().multiplyScalar(upRef.dot(lowerX))
    ).normalize();
    const lowerZ = new THREE.Vector3().crossVectors(lowerX, lowerY).normalize();
    const lowerWorldQ = makeOrthoBasis(lowerX, lowerY, lowerZ);

    return { upperWorldQ, lowerWorldQ };
  }
}

function solveShoulderLocal(
  pShoulder: THREE.Vector3,
  pUpperArm: THREE.Vector3,
  chestWorldQ: THREE.Quaternion,
  isLeft: boolean,
  restLm?: Record<string, [number, number, number]>
): THREE.Quaternion {
  const curDirWorld = new THREE.Vector3().subVectors(pUpperArm, pShoulder);
  if (curDirWorld.lengthSq() < 1e-6) {
    return new THREE.Quaternion(0, 0, 0, 1);
  }
  curDirWorld.normalize();

  const chestInv = inv(chestWorldQ);
  const curDirLocal = curDirWorld.clone().applyQuaternion(chestInv).normalize();

  let restDirLocal = new THREE.Vector3(isLeft ? 1 : -1, 0, 0);
  const shoulderKey = isLeft ? StandardBone.LeftShoulder : StandardBone.RightShoulder;
  const armKey = isLeft ? StandardBone.LeftUpperArm : StandardBone.RightUpperArm;
  if (restLm && hasBone(restLm, shoulderKey) && hasBone(restLm, armKey)) {
    const rDiff = new THREE.Vector3().subVectors(getV(restLm, armKey), getV(restLm, shoulderKey));
    if (rDiff.lengthSq() > 1e-6) {
      restDirLocal = rDiff.normalize();
    }
  }

  const deltaQ = new THREE.Quaternion().setFromUnitVectors(restDirLocal, curDirLocal);
  // 适度阻尼 (85%) 避免锁骨过冲
  return new THREE.Quaternion(0, 0, 0, 1).slerp(deltaQ, 0.85).normalize();
}

function computeFootBasis(
  pKnee: THREE.Vector3,
  pAnkle: THREE.Vector3,
  pToes: THREE.Vector3,
  legSide: THREE.Vector3
): THREE.Quaternion | null {
  const dFoot = new THREE.Vector3().subVectors(pToes, pAnkle);
  if (dFoot.lengthSq() < 1e-6) return null;
  dFoot.normalize();

  // 以 legSide 在垂直于 dFoot 平面上的投影作为脚踝侧向约束轴，避免 dFoot 与 shinUp 共线时翻转
  let footSide = legSide.clone().sub(dFoot.clone().multiplyScalar(legSide.dot(dFoot)));
  if (footSide.lengthSq() < 1e-4) {
    const shinUp = new THREE.Vector3().subVectors(pKnee, pAnkle);
    if (shinUp.lengthSq() < 1e-6) {
      shinUp.set(0, 1, 0);
    } else {
      shinUp.normalize();
    }
    footSide = new THREE.Vector3().crossVectors(shinUp, dFoot);
    if (footSide.dot(legSide) < 0) {
      footSide.negate();
    }
  }
  if (footSide.lengthSq() < 1e-5) return null;
  footSide.normalize();

  const footUp = new THREE.Vector3().crossVectors(dFoot, footSide).normalize();
  footSide = new THREE.Vector3().crossVectors(footUp, dFoot).normalize();
  return makeOrthoBasis(footSide, footUp, dFoot);
}

function solveLegAndFoot(
  lm: Record<string, [number, number, number]>,
  hipKey: StandardBoneKey,
  kneeKey: StandardBoneKey,
  ankleKey: StandardBoneKey,
  toesKey: StandardBoneKey,
  hipSideOrtho: THREE.Vector3,
  restLm?: Record<string, [number, number, number]>
) {
  const pHip = getV(lm, hipKey);
  const pKnee = getV(lm, kneeKey);
  const pAnkle = getV(lm, ankleKey);

  const dUpper = new THREE.Vector3().subVectors(pKnee, pHip);
  if (dUpper.lengthSq() < 1e-6) dUpper.set(0, -1, 0);
  else dUpper.normalize();

  const dLower = new THREE.Vector3().subVectors(pAnkle, pKnee);
  if (dLower.lengthSq() < 1e-6) dLower.set(0, -1, 0);
  else dLower.normalize();

  const bendCross = new THREE.Vector3().crossVectors(dUpper, dLower);
  const bendLen = bendCross.length();
  const bendWeight = clamp((bendLen - 0.03) / 0.12, 0, 1);

  let legSide = hipSideOrtho.clone();
  if (bendLen > 1e-4) {
    const bendSide = bendCross.clone().divideScalar(bendLen);
    if (bendSide.dot(hipSideOrtho) >= -0.2) {
      legSide.lerp(bendSide, bendWeight).normalize();
    }
  }

  const upperY = dUpper.clone().negate();
  let upperX = new THREE.Vector3().subVectors(
    legSide,
    upperY.clone().multiplyScalar(legSide.dot(upperY))
  );
  if (upperX.lengthSq() < 1e-6) upperX = hipSideOrtho.clone();
  else upperX.normalize();
  const upperZ = new THREE.Vector3().crossVectors(upperX, upperY).normalize();
  const upperWorldQ = makeOrthoBasis(upperX, upperY, upperZ);

  const lowerY = dLower.clone().negate();
  let lowerX = new THREE.Vector3().subVectors(
    legSide,
    lowerY.clone().multiplyScalar(legSide.dot(lowerY))
  );
  if (lowerX.lengthSq() < 1e-6) lowerX = upperX.clone();
  else lowerX.normalize();
  const lowerZ = new THREE.Vector3().crossVectors(lowerX, lowerY).normalize();
  const lowerWorldQ = makeOrthoBasis(lowerX, lowerY, lowerZ);

  let footWorldQ: THREE.Quaternion | null = null;
  if (hasBone(lm, toesKey)) {
    const pToes = getV(lm, toesKey);
    const rawFootQ = computeFootBasis(pKnee, pAnkle, pToes, legSide);
    if (rawFootQ) {
      if (restLm && hasBone(restLm, toesKey) && hasBone(restLm, ankleKey) && hasBone(restLm, kneeKey)) {
        const rKnee = getV(restLm, kneeKey);
        const rAnkle = getV(restLm, ankleKey);
        const rToes = getV(restLm, toesKey);
        const restFootQ = computeFootBasis(rKnee, rAnkle, rToes, new THREE.Vector3(1, 0, 0));
        if (restFootQ) {
          footWorldQ = rawFootQ.clone().multiply(inv(restFootQ)).normalize();
        } else {
          footWorldQ = rawFootQ;
        }
      } else {
        footWorldQ = rawFootQ;
      }
    }
  }

  let footLocal = footWorldQ ? mul(inv(lowerWorldQ), footWorldQ) : new THREE.Quaternion(0, 0, 0, 1);

  // 修复 VMD IK 导致的反人体力学过度背屈（脚面被强行压平贴近小腿前侧）
  // 仅对负向背屈（pitch < -18°）做平滑软限位至 -28°；正向跖屈（蹬伸/绷脚背）完全不限制
  const localFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(footLocal);
  const pitch = Math.atan2(-localFwd.y, localFwd.z);
  const dorsiStart = -0.31; // -18°
  const dorsiMax = -0.49;   // -28°
  if (pitch < dorsiStart) {
    const excess = dorsiStart - pitch;
    const range = dorsiStart - dorsiMax;
    const clampedPitch = dorsiStart - range * Math.tanh(excess / range);
    const corrQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      clampedPitch - pitch
    );
    footLocal = corrQ.multiply(footLocal).normalize();
    footWorldQ = lowerWorldQ.clone().multiply(footLocal).normalize();
  }

  return {
    upperWorldQ,
    lowerWorldQ,
    footWorldQ: footWorldQ || lowerWorldQ.clone(),
  };
}

function solveHandWorldQ(
  pWrist: THREE.Vector3,
  pIndex1: THREE.Vector3,
  pPinky1: THREE.Vector3,
  pMiddle1: THREE.Vector3,
  isLeft: boolean,
  fallbackArmQ: THREE.Quaternion
): THREE.Quaternion {
  const dir = new THREE.Vector3().subVectors(pMiddle1, pWrist);
  if (dir.lengthSq() < 1e-4) {
    return fallbackArmQ.clone();
  }
  const boneDir = dir.normalize();

  const axisX = isLeft ? boneDir.clone() : boneDir.clone().negate();

  const sideVecDiff = new THREE.Vector3().subVectors(pIndex1, pPinky1);
  if (sideVecDiff.lengthSq() < 1e-4) {
    return fallbackArmQ.clone();
  }
  const sideVec = sideVecDiff.normalize();

  const axisY = isLeft
    ? new THREE.Vector3().crossVectors(sideVec, boneDir).normalize()
    : new THREE.Vector3().crossVectors(boneDir, sideVec).normalize();

  if (axisY.lengthSq() < 1e-4 || isNaN(axisY.x)) {
    return fallbackArmQ.clone();
  }

  const axisZ = new THREE.Vector3().crossVectors(axisX, axisY).normalize();
  return makeOrthoBasis(axisX, axisY, axisZ);
}

export function solveLimbs(
  lm: Record<string, [number, number, number]>,
  spineWorldQ: THREE.Quaternion,
  hipsWorldQ: THREE.Quaternion,
  hipSideOrtho: THREE.Vector3,
  chestUp: THREE.Vector3,
  restLm?: Record<string, [number, number, number]>
) {
  const pUpperChest = getV(lm, StandardBone.Chest, getV(lm, StandardBone.Spine));

  const pLShoulder = getV(lm, StandardBone.LeftShoulder, pUpperChest);
  const pLArm = getV(lm, StandardBone.LeftUpperArm, pLShoulder);
  const pLElbow = getV(lm, StandardBone.LeftLowerArm);
  const pLWrist = getV(lm, StandardBone.LeftHand);

  const pRShoulder = getV(lm, StandardBone.RightShoulder, pUpperChest);
  const pRArm = getV(lm, StandardBone.RightUpperArm, pRShoulder);
  const pRElbow = getV(lm, StandardBone.RightLowerArm);
  const pRWrist = getV(lm, StandardBone.RightHand);

  // 激活锁骨
  const leftShoulderLocal = solveShoulderLocal(pLShoulder, pLArm, spineWorldQ, true, restLm);
  const rightShoulderLocal = solveShoulderLocal(pRShoulder, pRArm, spineWorldQ, false, restLm);

  const leftShoulderWorldQ = spineWorldQ.clone().multiply(leftShoulderLocal).normalize();
  const rightShoulderWorldQ = spineWorldQ.clone().multiply(rightShoulderLocal).normalize();

  const leftArm = solveAnatomicalLimb(pLArm, pLElbow, pLWrist, 'leftArm', chestUp);
  const rightArm = solveAnatomicalLimb(pRArm, pRElbow, pRWrist, 'rightArm', chestUp);

  const leftLeg = solveLegAndFoot(
    lm,
    StandardBone.LeftUpperLeg,
    StandardBone.LeftLowerLeg,
    StandardBone.LeftFoot,
    StandardBone.LeftToes,
    hipSideOrtho,
    restLm
  );
  const rightLeg = solveLegAndFoot(
    lm,
    StandardBone.RightUpperLeg,
    StandardBone.RightLowerLeg,
    StandardBone.RightFoot,
    StandardBone.RightToes,
    hipSideOrtho,
    restLm
  );

  const pLIndex1 = getV(lm, StandardBone.LeftIndex1, pLWrist);
  const pLPinky1 = getV(lm, StandardBone.LeftLittle1, pLWrist);
  const pLMiddle1 = getV(lm, StandardBone.LeftMiddle1, pLWrist);
  const leftHandWorldQ = solveHandWorldQ(pLWrist, pLIndex1, pLPinky1, pLMiddle1, true, leftArm.lowerWorldQ);

  const pRIndex1 = getV(lm, StandardBone.RightIndex1, pRWrist);
  const pRPinky1 = getV(lm, StandardBone.RightLittle1, pRWrist);
  const pRMiddle1 = getV(lm, StandardBone.RightMiddle1, pRWrist);
  const rightHandWorldQ = solveHandWorldQ(pRWrist, pRIndex1, pRPinky1, pRMiddle1, false, rightArm.lowerWorldQ);

  const hInv = inv(hipsWorldQ);

  return {
    leftHandWorldQ,
    rightHandWorldQ,
    localRotations: {
      leftShoulder: leftShoulderLocal,
      leftUpperArm: mul(inv(leftShoulderWorldQ), leftArm.upperWorldQ),
      leftLowerArm: mul(inv(leftArm.upperWorldQ), leftArm.lowerWorldQ),
      leftHand: mul(inv(leftArm.lowerWorldQ), leftHandWorldQ),

      rightShoulder: rightShoulderLocal,
      rightUpperArm: mul(inv(rightShoulderWorldQ), rightArm.upperWorldQ),
      rightLowerArm: mul(inv(rightArm.upperWorldQ), rightArm.lowerWorldQ),
      rightHand: mul(inv(rightArm.lowerWorldQ), rightHandWorldQ),

      leftUpperLeg: mul(hInv, leftLeg.upperWorldQ),
      leftLowerLeg: mul(inv(leftLeg.upperWorldQ), leftLeg.lowerWorldQ),
      leftFoot: mul(inv(leftLeg.lowerWorldQ), leftLeg.footWorldQ),
      leftToes: new THREE.Quaternion(0, 0, 0, 1),

      rightUpperLeg: mul(hInv, rightLeg.upperWorldQ),
      rightLowerLeg: mul(inv(rightLeg.upperWorldQ), rightLeg.lowerWorldQ),
      rightFoot: mul(inv(rightLeg.lowerWorldQ), rightLeg.footWorldQ),
      rightToes: new THREE.Quaternion(0, 0, 0, 1),
    },
  };
}
