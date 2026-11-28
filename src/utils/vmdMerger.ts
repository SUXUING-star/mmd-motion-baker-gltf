// src/utils/vmdMerger.ts
export type VmdTrackRole =
  | 'motion'
  | 'face'
  | 'lip'
  | 'face_lip'
  | 'motion_face'
  | 'camera'
  | 'empty';

export interface VmdFileSummary {
  file: File;
  name: string;
  role: VmdTrackRole;
  boneCount: number;
  morphCount: number;
  cameraCount: number;
  durationFrames: number;
  uniqueBones: number;
  uniqueMorphs: number;
}

const LIP_MORPH_SET = new Set<string>([
  'あ', 'い', 'う', 'え', 'お',
  'あ２', 'あ2', 'い２', 'い2', 'う２', 'う2', 'え２', 'え2', 'お２', 'お2',
  'ワ', 'わ', 'ん', 'えー', 'おお',
  'にやり', 'にやり２', 'にやり2', 'にやり3',
  '口角上げ', '口角下げ', '口広げ', '口横広げ', '口横狭め', '口閉じ', '口開け',
  'へ', 'ぺろっ', 'てへぺろ', 'てへぺろ２', 'てへぺろ2',
  '∧', 'ω', 'ω□', '△', '□', 'はんぐりー', 'むぅ', 'キス',
  'aa', 'ih', 'ou', 'ee', 'oh', 'a', 'i', 'u', 'e', 'o',
  'mouth_a', 'mouth_i', 'mouth_u', 'mouth_e', 'mouth_o',
]);

interface ParsedVmdRaw {
  header50: Uint8Array;
  boneRecords: Array<{ nameBytes: Uint8Array; frame: number; raw: Uint8Array }>;
  morphRecords: Array<{ nameBytes: Uint8Array; nameStr: string; frame: number; raw: Uint8Array }>;
  cameraCount: number;
  maxFrame: number;
}

function decodeShiftJisName(bytes: Uint8Array, decoder: TextDecoder): string {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  return decoder.decode(bytes.subarray(0, end)).trim();
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

function parseVmdBinary(buffer: ArrayBuffer): ParsedVmdRaw {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder('shift-jis');

  const headerTag = decodeShiftJisName(bytes.subarray(0, 30), decoder);
  const isV1 = headerTag.startsWith('Vocaloid Motion Data file');
  const modelNameLen = isV1 ? 10 : 20;
  let offset = 30 + modelNameLen;

  // 统一构造标准的 VMD v2 50 字节头
  const header50 = new Uint8Array(50);
  const v2Sig = new TextEncoder().encode('Vocaloid Motion Data 0002');
  header50.set(v2Sig, 0);
  if (bytes.length >= offset) {
    header50.set(bytes.subarray(30, 30 + Math.min(20, modelNameLen)), 30);
  }

  let maxFrame = 0;
  const boneRecords: ParsedVmdRaw['boneRecords'] = [];
  const morphRecords: ParsedVmdRaw['morphRecords'] = [];
  let cameraCount = 0;

  if (offset + 4 <= bytes.length) {
    const boneCount = view.getUint32(offset, true);
    offset += 4;
    for (let i = 0; i < boneCount; i++) {
      if (offset + 111 > bytes.length) break;
      const raw = bytes.subarray(offset, offset + 111);
      const nameBytes = raw.subarray(0, 15);
      const frame = view.getUint32(offset + 15, true);
      if (frame > maxFrame) maxFrame = frame;
      boneRecords.push({ nameBytes, frame, raw });
      offset += 111;
    }
  }

  if (offset + 4 <= bytes.length) {
    const morphCount = view.getUint32(offset, true);
    offset += 4;
    for (let i = 0; i < morphCount; i++) {
      if (offset + 23 > bytes.length) break;
      const raw = bytes.subarray(offset, offset + 23);
      const nameBytes = raw.subarray(0, 15);
      const nameStr = decodeShiftJisName(nameBytes, decoder);
      const frame = view.getUint32(offset + 15, true);
      if (frame > maxFrame) maxFrame = frame;
      morphRecords.push({ nameBytes, nameStr, frame, raw });
      offset += 23;
    }
  }

  if (offset + 4 <= bytes.length) {
    cameraCount = view.getUint32(offset, true);
    offset += 4;
    for (let i = 0; i < cameraCount; i++) {
      if (offset + 61 > bytes.length) break;
      const frame = view.getUint32(offset, true);
      if (frame > maxFrame) maxFrame = frame;
      offset += 61;
    }
  }

  return { header50, boneRecords, morphRecords, cameraCount, maxFrame };
}

function isLipMorphName(name: string): boolean {
  if (!name) return false;
  if (LIP_MORPH_SET.has(name) || LIP_MORPH_SET.has(name.toLowerCase())) return true;
  const lower = name.toLowerCase();
  return lower.includes('lip') || lower.includes('mouth') || name.startsWith('口');
}

export async function inspectVmdFile(file: File): Promise<VmdFileSummary> {
  const buf = await file.arrayBuffer();
  const parsed = parseVmdBinary(buf);

  const uniqueBoneSet = new Set<string>();
  for (const b of parsed.boneRecords) {
    uniqueBoneSet.add(bytesToHex(b.nameBytes));
  }

  const uniqueMorphSet = new Set<string>();
  for (const m of parsed.morphRecords) {
    if (m.nameStr) uniqueMorphSet.add(m.nameStr);
  }

  let lipMorphTypeCount = 0;
  for (const mName of uniqueMorphSet) {
    if (isLipMorphName(mName)) lipMorphTypeCount++;
  }

  const boneCount = parsed.boneRecords.length;
  const morphCount = parsed.morphRecords.length;
  const cameraCount = parsed.cameraCount;

  let role: VmdTrackRole = 'empty';
  if (boneCount > 0 && morphCount > 0) {
    role = 'motion_face';
  } else if (boneCount > 0) {
    role = 'motion';
  } else if (morphCount > 0) {
    const lipRatio = uniqueMorphSet.size > 0 ? lipMorphTypeCount / uniqueMorphSet.size : 0;
    if (lipRatio >= 0.65) role = 'lip';
    else if (lipRatio < 0.25) role = 'face';
    else role = 'face_lip';
  } else if (cameraCount > 0) {
    role = 'camera';
  }

  return {
    file,
    name: file.name,
    role,
    boneCount,
    morphCount,
    cameraCount,
    durationFrames: parsed.maxFrame,
    uniqueBones: uniqueBoneSet.size,
    uniqueMorphs: uniqueMorphSet.size,
  };
}

/**
 * 将多个分离的 VMD（动作轨 / 面部表情轨 / 口型轨）无损合并为单个标准 VMD 二进制 File
 */
export async function mergeVmdFiles(files: File[]): Promise<File> {
  if (files.length === 0) {
    throw new Error('未提供可合并的 VMD 文件');
  }
  if (files.length === 1) {
    return files[0];
  }

  const parsedList = await Promise.all(
    files.map(async (f) => ({
      file: f,
      parsed: parseVmdBinary(await f.arrayBuffer()),
    }))
  );

  // 骨骼数少的文件先写入，主骨骼动作后写入覆盖（避免纯表情 VMD 自带的第 0 帧空センター覆盖主动作）
  const boneOrdered = [...parsedList].sort(
    (a, b) => a.parsed.boneRecords.length - b.parsed.boneRecords.length
  );

  const boneMap = new Map<string, { frame: number; raw: Uint8Array }>();
  for (const item of boneOrdered) {
    for (const rec of item.parsed.boneRecords) {
      const key = `${bytesToHex(rec.nameBytes)}_${rec.frame}`;
      boneMap.set(key, { frame: rec.frame, raw: rec.raw });
    }
  }

  // 表情轨按用户列表顺序覆盖合并
  const morphMap = new Map<string, { frame: number; raw: Uint8Array }>();
  for (const item of parsedList) {
    for (const rec of item.parsed.morphRecords) {
      const key = `${bytesToHex(rec.nameBytes)}_${rec.frame}`;
      morphMap.set(key, { frame: rec.frame, raw: rec.raw });
    }
  }

  const mergedBones = Array.from(boneMap.values()).sort((a, b) => a.frame - b.frame);
  const mergedMorphs = Array.from(morphMap.values()).sort((a, b) => a.frame - b.frame);

  // 使用主动作文件的 50 字节头
  const primaryHeader =
    boneOrdered[boneOrdered.length - 1]?.parsed.header50 ?? parsedList[0].parsed.header50;

  const totalSize =
    50 +
    4 + mergedBones.length * 111 +
    4 + mergedMorphs.length * 23 +
    4 + // cameraCount = 0
    4 + // lightCount = 0
    4 + // selfShadowCount = 0
    4;  // ikCount = 0

  const outBuf = new ArrayBuffer(totalSize);
  const outBytes = new Uint8Array(outBuf);
  const outView = new DataView(outBuf);

  outBytes.set(primaryHeader, 0);
  let pos = 50;

  outView.setUint32(pos, mergedBones.length, true);
  pos += 4;
  for (const b of mergedBones) {
    outBytes.set(b.raw, pos);
    pos += 111;
  }

  outView.setUint32(pos, mergedMorphs.length, true);
  pos += 4;
  for (const m of mergedMorphs) {
    outBytes.set(m.raw, pos);
    pos += 23;
  }

  outView.setUint32(pos, 0, true); // cameraCount
  outView.setUint32(pos + 4, 0, true); // lightCount
  outView.setUint32(pos + 8, 0, true); // selfShadowCount
  outView.setUint32(pos + 12, 0, true); // ikCount

  const baseName =
    boneOrdered[boneOrdered.length - 1]?.file.name.replace(/\.vmd$/i, '') || 'merged';

  return new File([outBuf], `${baseName}_merged.vmd`, {
    type: 'application/octet-stream',
  });
}
