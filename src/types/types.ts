// src/types/types.ts

// 需录制 3D 点云的 MMD 节点清单 (包含双手 15 节指骨点)
export const MMD_POINT_NAMES = [
  'センター', '下半身', '上半身', '上半身2', '首', '頭',
  '左足', '左ひざ', '左足首', '左つま先',
  '右足', '右ひざ', '右足首', '右つま先',
  '左肩', '左腕', '左ひじ', '左手首',
  '右肩', '右腕', '右ひじ', '右手首',
  // 左手 5 指
  '左親指０', '左親指１', '左親指２',
  '左人指１', '左人指２', '左人指３',
  '左中指１', '左中指２', '左中指３',
  '左薬指１', '左薬指２', '左薬指３',
  '左小指１', '左小指２', '左小指３',
  // 右手 5 指
  '右親指０', '右親指１', '右親指２',
  '右人指１', '右人指２', '右人指３',
  '右中指１', '右中指２', '右中指３',
  '右薬指１', '右薬指２', '右薬指３',
  '右小指１', '右小指２', '右小指３'
] as const;

// 52 根标准 Humanoid 骨骼
export const HUMANOID_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
] as const;

export type HumanoidBoneName = typeof HUMANOID_BONES[number];

export interface ModelMorphInfo {
  rawName: string;
  targetKey: string;
  isPreset: boolean;
}

export interface LandmarkFrame {
  time: number;
  landmarks: Record<string, [number, number, number]>;
  expressions?: Record<string, number>;
  /** 用于 3D 视口预览时精确映射原始 VMD 动画时间 */
  previewTime?: number;
  /** 用于 3D 视口预览过渡帧时的 MMD 姿态混合目标 */
  previewBlendTarget?: { startTime: number; weight: number };
}

export interface LandmarkData {
  fps: number;
  totalFrames: number;
  duration: number;
  frames: LandmarkFrame[];
  restLandmarks?: Record<string, [number, number, number]>;
  availableMorphs?: ModelMorphInfo[];
  /** 尾部插入的循环过渡帧数量（>0 时 mathSolver 将在四元数空间执行 C1 无缝缝合） */
  loopBridgeFrames?: number;
}
