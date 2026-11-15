// src/types/boneMapping.ts
import * as THREE from 'three';

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


/** 内部统一标准语义骨骼 Key */
export const StandardBone = {
  Root: 'Root',
  Hips: 'Hips',
  Spine: 'Spine',
  Chest: 'Chest',
  Neck: 'Neck',
  Head: 'Head',
  LeftEye: 'LeftEye',
  RightEye: 'RightEye',

  LeftShoulder: 'LeftShoulder',
  LeftUpperArm: 'LeftUpperArm',
  LeftLowerArm: 'LeftLowerArm',
  LeftHand: 'LeftHand',

  RightShoulder: 'RightShoulder',
  RightUpperArm: 'RightUpperArm',
  RightLowerArm: 'RightLowerArm',
  RightHand: 'RightHand',

  LeftUpperLeg: 'LeftUpperLeg',
  LeftLowerLeg: 'LeftLowerLeg',
  LeftFoot: 'LeftFoot',
  LeftToes: 'LeftToes',

  RightUpperLeg: 'RightUpperLeg',
  RightLowerLeg: 'RightLowerLeg',
  RightFoot: 'RightFoot',
  RightToes: 'RightToes',

  // 左手 5 指 (0=根部掌骨, 1=近节, 2=中节, 3=远节)
  LeftThumb0: 'LeftThumb0', LeftThumb1: 'LeftThumb1', LeftThumb2: 'LeftThumb2',
  LeftIndex1: 'LeftIndex1', LeftIndex2: 'LeftIndex2', LeftIndex3: 'LeftIndex3',
  LeftMiddle1: 'LeftMiddle1', LeftMiddle2: 'LeftMiddle2', LeftMiddle3: 'LeftMiddle3',
  LeftRing1: 'LeftRing1', LeftRing2: 'LeftRing2', LeftRing3: 'LeftRing3',
  LeftLittle1: 'LeftLittle1', LeftLittle2: 'LeftLittle2', LeftLittle3: 'LeftLittle3',

  // 右手 5 指
  RightThumb0: 'RightThumb0', RightThumb1: 'RightThumb1', RightThumb2: 'RightThumb2',
  RightIndex1: 'RightIndex1', RightIndex2: 'RightIndex2', RightIndex3: 'RightIndex3',
  RightMiddle1: 'RightMiddle1', RightMiddle2: 'RightMiddle2', RightMiddle3: 'RightMiddle3',
  RightRing1: 'RightRing1', RightRing2: 'RightRing2', RightRing3: 'RightRing3',
  RightLittle1: 'RightLittle1', RightLittle2: 'RightLittle2', RightLittle3: 'RightLittle3',
} as const;

export type StandardBoneKey = (typeof StandardBone)[keyof typeof StandardBone];

// 替换 GARBAGE_BONE_KEYWORDS 及过滤逻辑：避免误杀 bend / extend
const GARBAGE_BONE_KEYWORDS = [
  '_end', 'pole', 'target', 'handle', 'mmd_shadow', 'mmd_dummy',
  'dummy', 'shadow', 'ik_parent', 'eye_control', '_ik', 'effector'
];

function isGarbageBoneName(rawName: string): boolean {
  const lower = rawName.toLowerCase();
  if (GARBAGE_BONE_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  // 仅匹配独立词尾 end（如 HeadEnd / index_end），不误杀 bend / extend
  return /(?:^|[_\.\-\s])end$/i.test(lower) || /End$/.test(rawName);
}


/**
 * 标准骨骼 -> 别名候选词库（按优先级排列）
 * 覆盖：日文原生 MMD、UmaViewer 提取骨骼、英文 Mixamo/VRM 命名
 */
export const BONE_CANDIDATE_MAP: Record<StandardBoneKey, string[]> = {
  [StandardBone.Root]: ['センター', 'center', 'Position', 'Root', '全ての親', 'root'],
  [StandardBone.Hips]: ['下半身', 'Hips', 'Hip', 'hips', 'hip', 'Pelvis', 'pelvis'],
  [StandardBone.Spine]: ['上半身', 'Spine', 'spine', 'Spine1'],
  [StandardBone.Chest]: ['上半身2', 'Chest', 'chest', '胸', 'Spine2', 'upperChest'],
  [StandardBone.Neck]: ['首', 'Neck', 'neck'],
  [StandardBone.Head]: ['頭', 'Head', 'head'],
  [StandardBone.LeftEye]: ['左目', 'EyeL', 'Eye_L', 'leftEye', 'eye.L'],
  [StandardBone.RightEye]: ['右目', 'EyeR', 'Eye_R', 'rightEye', 'eye.R'],

  [StandardBone.LeftShoulder]: ['左肩', 'ShoulderL', 'Shoulder_L', 'leftShoulder', 'shoulder.L'],
  [StandardBone.LeftUpperArm]: ['左腕', 'UpperArmL', 'Arm_L', 'UpperArm_L', 'leftUpperArm', 'arm.L'],
  [StandardBone.LeftLowerArm]: ['左ひじ', 'LowerArmL', 'Elbow_L', 'LowerArm_L', 'leftLowerArm', 'elbow.L'],
  [StandardBone.LeftHand]: ['左手首', 'HandL', 'Wrist_L', 'Hand_L', 'leftHand', 'wrist.L'],

  [StandardBone.RightShoulder]: ['右肩', 'ShoulderR', 'Shoulder_R', 'rightShoulder', 'shoulder.R'],
  [StandardBone.RightUpperArm]: ['右腕', 'UpperArmR', 'Arm_R', 'UpperArm_R', 'rightUpperArm', 'arm.R'],
  [StandardBone.RightLowerArm]: ['右ひじ', 'LowerArmR', 'Elbow_R', 'LowerArm_R', 'rightLowerArm', 'elbow.R'],
  [StandardBone.RightHand]: ['右手首', 'HandR', 'Wrist_R', 'Hand_R', 'rightHand', 'wrist.R'],

  [StandardBone.LeftUpperLeg]: ['左足', 'UpperLegL', 'Leg_L', 'Thigh_L', 'leftUpperLeg', 'leg.L'],
  [StandardBone.LeftLowerLeg]: ['左ひざ', 'LowerLegL', 'Knee_L', 'LowerLeg_L', 'leftLowerLeg', 'knee.L'],
  [StandardBone.LeftFoot]: ['左足首', 'FootL', 'Ankle_L', 'Foot_L', 'leftFoot', 'ankle.L'],
  [StandardBone.LeftToes]: [
      '左つま先', '左足先EX', '左足先', '左つま先先', 'つま先L', 'つま先_L', 'つま先.L',
      'ToesL', 'Toe_L', 'ToeBase_L', 'leftToes', 'LeftToeBase', 'toe.L'
    ],


  [StandardBone.RightUpperLeg]: ['右足', 'UpperLegR', 'Leg_R', 'Thigh_R', 'rightUpperLeg', 'leg.R'],
  [StandardBone.RightLowerLeg]: ['右ひざ', 'LowerLegR', 'Knee_R', 'LowerLeg_R', 'rightLowerLeg', 'knee.R'],
  [StandardBone.RightFoot]: ['右足首', 'FootR', 'Ankle_R', 'Foot_R', 'rightFoot', 'ankle.R'],
  [StandardBone.RightToes]: [
    '右つま先', '右足先EX', '右足先', '右つま先先', 'つま先R', 'つま先_R', 'つま先.R',
    'ToesR', 'Toe_R', 'ToeBase_R', 'rightToes', 'RightToeBase', 'toe.R'
  ],
  // 左手 5 指
    [StandardBone.LeftThumb0]: [
      '左親指０', '左親指0', 'Thumb0L', 'Thumb_0_L', 'Thumb0_L', 'L_Thumb0', 'L_Thumb1',
      'Thumb_01_L', 'thumb_01_l', 'LeftHandThumb1', 'leftThumbMetacarpal', 'leftThumb0'
    ],
    [StandardBone.LeftThumb1]: [
      '左親指１', '左親指1', 'Thumb1L', 'Thumb_1_L', 'Thumb1_L', 'L_Thumb1', 'L_Thumb2',
      'Thumb_02_L', 'thumb_02_l', 'LeftHandThumb2', 'leftThumbProximal', 'leftThumb1'
    ],
    [StandardBone.LeftThumb2]: [
      '左親指２', '左親指2', 'Thumb2L', 'Thumb_2_L', 'Thumb2_L', 'L_Thumb2', 'L_Thumb3',
      'Thumb_03_L', 'thumb_03_l', 'LeftHandThumb3', 'leftThumbDistal', 'leftThumb2'
    ],

    [StandardBone.LeftIndex1]: [
      '左人指１', '左人指1', '左人差し指１', '左人差指１', 'Index1L', 'Index_1_L', 'Index1_L', 'L_Index1',
      'Index_01_L', 'index_01_l', 'LeftHandIndex1', 'leftIndexProximal', 'leftIndex1'
    ],
    [StandardBone.LeftIndex2]: [
      '左人指２', '左人指2', '左人差し指２', '左人差指２', 'Index2L', 'Index_2_L', 'Index2_L', 'L_Index2',
      'Index_02_L', 'index_02_l', 'LeftHandIndex2', 'leftIndexIntermediate', 'leftIndex2'
    ],
    [StandardBone.LeftIndex3]: [
      '左人指３', '左人指3', '左人差し指３', '左人差指３', 'Index3L', 'Index_3_L', 'Index3_L', 'L_Index3',
      'Index_03_L', 'index_03_l', 'LeftHandIndex3', 'leftIndexDistal', 'leftIndex3'
    ],

    [StandardBone.LeftMiddle1]: [
      '左中指１', '左中指1', 'Middle1L', 'Middle_1_L', 'Middle1_L', 'L_Middle1',
      'Middle_01_L', 'middle_01_l', 'LeftHandMiddle1', 'leftMiddleProximal', 'leftMiddle1'
    ],
    [StandardBone.LeftMiddle2]: [
      '左中指２', '左中指2', 'Middle2L', 'Middle_2_L', 'Middle2_L', 'L_Middle2',
      'Middle_02_L', 'middle_02_l', 'LeftHandMiddle2', 'leftMiddleIntermediate', 'leftMiddle2'
    ],
    [StandardBone.LeftMiddle3]: [
      '左中指３', '左中指3', 'Middle3L', 'Middle_3_L', 'Middle3_L', 'L_Middle3',
      'Middle_03_L', 'middle_03_l', 'LeftHandMiddle3', 'leftMiddleDistal', 'leftMiddle3'
    ],

    [StandardBone.LeftRing1]: [
      '左薬指１', '左薬指1', '左藥指１', 'Ring1L', 'Ring_1_L', 'Ring1_L', 'L_Ring1',
      'Ring_01_L', 'ring_01_l', 'LeftHandRing1', 'leftRingProximal', 'leftRing1'
    ],
    [StandardBone.LeftRing2]: [
      '左薬指２', '左薬指2', '左藥指２', 'Ring2L', 'Ring_2_L', 'Ring2_L', 'L_Ring2',
      'Ring_02_L', 'ring_02_l', 'LeftHandRing2', 'leftRingIntermediate', 'leftRing2'
    ],
    [StandardBone.LeftRing3]: [
      '左薬指３', '左薬指3', '左藥指３', 'Ring3L', 'Ring_3_L', 'Ring3_L', 'L_Ring3',
      'Ring_03_L', 'ring_03_l', 'LeftHandRing3', 'leftRingDistal', 'leftRing3'
    ],

    [StandardBone.LeftLittle1]: [
      '左小指１', '左小指1', 'Little1L', 'Pinky1L', 'Little_1_L', 'Pinky_1_L', 'L_Little1', 'L_Pinky1',
      'Pinky_01_L', 'pinky_01_l', 'Little_01_L', 'LeftHandPinky1', 'leftLittleProximal', 'leftLittle1'
    ],
    [StandardBone.LeftLittle2]: [
      '左小指２', '左小指2', 'Little2L', 'Pinky2L', 'Little_2_L', 'Pinky_2_L', 'L_Little2', 'L_Pinky2',
      'Pinky_02_L', 'pinky_02_l', 'Little_02_L', 'LeftHandPinky2', 'leftLittleIntermediate', 'leftLittle2'
    ],
    [StandardBone.LeftLittle3]: [
      '左小指３', '左小指3', 'Little3L', 'Pinky3L', 'Little_3_L', 'Pinky_3_L', 'L_Little3', 'L_Pinky3',
      'Pinky_03_L', 'pinky_03_l', 'Little_03_L', 'LeftHandPinky3', 'leftLittleDistal', 'leftLittle3'
    ],

    // 右手 5 指
    [StandardBone.RightThumb0]: [
      '右親指０', '右親指0', 'Thumb0R', 'Thumb_0_R', 'Thumb0_R', 'R_Thumb0', 'R_Thumb1',
      'Thumb_01_R', 'thumb_01_r', 'RightHandThumb1', 'rightThumbMetacarpal', 'rightThumb0'
    ],
    [StandardBone.RightThumb1]: [
      '右親指１', '右親指1', 'Thumb1R', 'Thumb_1_R', 'Thumb1_R', 'R_Thumb1', 'R_Thumb2',
      'Thumb_02_R', 'thumb_02_r', 'RightHandThumb2', 'rightThumbProximal', 'rightThumb1'
    ],
    [StandardBone.RightThumb2]: [
      '右親指２', '右親指2', 'Thumb2R', 'Thumb_2_R', 'Thumb2_R', 'R_Thumb2', 'R_Thumb3',
      'Thumb_03_R', 'thumb_03_r', 'RightHandThumb3', 'rightThumbDistal', 'rightThumb2'
    ],

    [StandardBone.RightIndex1]: [
      '右人指１', '右人指1', '右人差し指１', '右人差指１', 'Index1R', 'Index_1_R', 'Index1_R', 'R_Index1',
      'Index_01_R', 'index_01_r', 'RightHandIndex1', 'rightIndexProximal', 'rightIndex1'
    ],
    [StandardBone.RightIndex2]: [
      '右人指２', '右人指2', '右人差し指２', '右人差指２', 'Index2R', 'Index_2_R', 'Index2_R', 'R_Index2',
      'Index_02_R', 'index_02_r', 'RightHandIndex2', 'rightIndexIntermediate', 'rightIndex2'
    ],
    [StandardBone.RightIndex3]: [
      '右人指３', '右人指3', '右人差し指３', '右人差指３', 'Index3R', 'Index_3_R', 'Index3_R', 'R_Index3',
      'Index_03_R', 'index_03_r', 'RightHandIndex3', 'rightIndexDistal', 'rightIndex3'
    ],

    [StandardBone.RightMiddle1]: [
      '右中指１', '右中指1', 'Middle1R', 'Middle_1_R', 'Middle1_R', 'R_Middle1',
      'Middle_01_R', 'middle_01_r', 'RightHandMiddle1', 'rightMiddleProximal', 'rightMiddle1'
    ],
    [StandardBone.RightMiddle2]: [
      '右中指２', '右中指2', 'Middle2R', 'Middle_2_R', 'Middle2_R', 'R_Middle2',
      'Middle_02_R', 'middle_02_r', 'RightHandMiddle2', 'rightMiddleIntermediate', 'rightMiddle2'
    ],
    [StandardBone.RightMiddle3]: [
      '右中指３', '右中指3', 'Middle3R', 'Middle_3_R', 'Middle3_R', 'R_Middle3',
      'Middle_03_R', 'middle_03_r', 'RightHandMiddle3', 'rightMiddleDistal', 'rightMiddle3'
    ],

    [StandardBone.RightRing1]: [
      '右薬指１', '右薬指1', '右藥指１', 'Ring1R', 'Ring_1_R', 'Ring1_R', 'R_Ring1',
      'Ring_01_R', 'ring_01_r', 'RightHandRing1', 'rightRingProximal', 'rightRing1'
    ],
    [StandardBone.RightRing2]: [
      '右薬指２', '右薬指2', '右藥指２', 'Ring2R', 'Ring_2_R', 'Ring2_R', 'R_Ring2',
      'Ring_02_R', 'ring_02_r', 'RightHandRing2', 'rightRingIntermediate', 'rightRing2'
    ],
    [StandardBone.RightRing3]: [
      '右薬指３', '右薬指3', '右藥指３', 'Ring3R', 'Ring_3_R', 'Ring3_R', 'R_Ring3',
      'Ring_03_R', 'ring_03_r', 'RightHandRing3', 'rightRingDistal', 'rightRing3'
    ],

    [StandardBone.RightLittle1]: [
      '右小指１', '右小指1', 'Little1R', 'Pinky1R', 'Little_1_R', 'Pinky_1_R', 'R_Little1', 'R_Pinky1',
      'Pinky_01_R', 'pinky_01_r', 'Little_01_R', 'RightHandPinky1', 'rightLittleProximal', 'rightLittle1'
    ],
    [StandardBone.RightLittle2]: [
      '右小指２', '右小指2', 'Little2R', 'Pinky2R', 'Little_2_R', 'Pinky_2_R', 'R_Little2', 'R_Pinky2',
      'Pinky_02_R', 'pinky_02_r', 'Little_02_R', 'RightHandPinky2', 'rightLittleIntermediate', 'rightLittle2'
    ],
    [StandardBone.RightLittle3]: [
      '右小指３', '右小指3', 'Little3R', 'Pinky3R', 'Little_3_R', 'Pinky_3_R', 'R_Little3', 'R_Pinky3',
      'Pinky_03_R', 'pinky_03_r', 'Little_03_R', 'RightHandPinky3', 'rightLittleDistal', 'rightLittle3'
  ],
};

// 替换 normalizeString：增加全角字符（如 ０-９）转半角
function normalizeString(str: string): string {
  const half = str.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
  return half.toLowerCase().replace(/[_\s\.\:\/\-]/g, '');
}

/** 剥离 UmaViewer 等工具导出的各种模型编号、人物前缀与层级路径 */
function getCleanBoneNameVariants(rawName: string): string[] {
  const variants = new Set<string>();
  variants.add(rawName);

  // 1. 若包含 '/'、':'、'|' 等路径分隔符，截取最后一段真实骨骼名
  const lastSegment = rawName.split(/[/|:]/).pop();
  if (lastSegment) {
    variants.add(lastSegment);
  }

  // 2. 去除形如 "chr1048_23_", "cha1048_23_", "1048_23_", "bdy1048_" 等前缀
  const strippedPrefix = rawName.replace(/^([a-zA-Z0-9]+_)+/g, '');
  if (strippedPrefix && strippedPrefix !== rawName) {
    variants.add(strippedPrefix);
  }

  // 3. 提取末尾词段（例如从 "chr1048_23_UpperArm_L" 提取 "UpperArm_L" 或 "Arm_L"）
  const underscoreParts = rawName.split('_');
  if (underscoreParts.length > 2) {
    variants.add(underscoreParts.slice(-2).join('_'));
    variants.add(underscoreParts[underscoreParts.length - 1]);
  }

  return Array.from(variants);
}

/** 智能解析骨骼树，支持单层 Array 与多层嵌套 Object3D 树深度搜刮 */
export function resolveModelBones(bonesOrObject: THREE.Bone[] | THREE.Object3D): Map<StandardBoneKey, THREE.Bone> {
  const result = new Map<StandardBoneKey, THREE.Bone>();
  const rawBones: THREE.Bone[] = [];

  if (Array.isArray(bonesOrObject)) {
    rawBones.push(...bonesOrObject);
  } else if (bonesOrObject && typeof bonesOrObject === 'object') {
    // 全树递归搜刮：遍历所有子节点以及 SkinnedMesh 的 Skeleton
    bonesOrObject.traverse((node) => {
      if ((node as THREE.Bone).isBone || node instanceof THREE.Bone) {
        rawBones.push(node as THREE.Bone);
      }
      if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
        const skinned = node as THREE.SkinnedMesh;
        if (skinned.skeleton && Array.isArray(skinned.skeleton.bones)) {
          rawBones.push(...skinned.skeleton.bones);
        }
      }
    });
  }

  // 去重
  const uniqueBones = Array.from(new Set(rawBones));

  // 建立多重别名索引表
  const boneMapExact = new Map<string, THREE.Bone>();
  const boneMapNorm = new Map<string, THREE.Bone>();

  uniqueBones.forEach((b) => {
    const rawName = b.name.trim();
    const lower = rawName.toLowerCase();
    const isGarbage = GARBAGE_BONE_KEYWORDS.some((kw) => lower.includes(kw));
    if (isGarbage) return;

    // 变体收集
    const variants = getCleanBoneNameVariants(rawName);
    variants.forEach((v) => {
      if (!boneMapExact.has(v)) {
        boneMapExact.set(v, b);
      }
      const norm = normalizeString(v);
      if (!boneMapNorm.has(norm)) {
        boneMapNorm.set(norm, b);
      }
    });
  });

  // 按标准 Key 逐一搜寻
  (Object.keys(BONE_CANDIDATE_MAP) as StandardBoneKey[]).forEach((stdKey) => {
    const candidates = BONE_CANDIDATE_MAP[stdKey];

    // 级联 1: 精确/变体名命中
    for (const cand of candidates) {
      if (boneMapExact.has(cand)) {
        result.set(stdKey, boneMapExact.get(cand)!);
        return;
      }
    }

    // 级联 2: 归一化命中（忽略下划线、大小写、路径）
    for (const cand of candidates) {
      const normCand = normalizeString(cand);
      if (boneMapNorm.has(normCand)) {
        result.set(stdKey, boneMapNorm.get(normCand)!);
        return;
      }
    }
  });

  return result;
}
