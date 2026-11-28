// src/components/DropZoneSection.tsx
import React, { useRef } from 'react';
import { MmdPipeline } from '../hooks/useMmdPipeline';
import { I18nTexts } from '../i18n';
import type { VmdTrackRole } from '../utils/vmdMerger';

interface DropZoneSectionProps {
  t: I18nTexts;
  pipeline: MmdPipeline;
}

const SUPPORTED_MOTION_EXTS = ['.vmd', '.fbx', '.npy', '.bvh', '.anim', '.json'];

const isSupportedMotionFile = (name: string) =>
  SUPPORTED_MOTION_EXTS.some((ext) => name.toLowerCase().endsWith(ext));

const ROLE_BADGE_STYLE: Record<VmdTrackRole, { bg: string; color: string; border: string }> = {
  motion: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  motion_face: { bg: '#eef2ff', color: '#4338ca', border: '#c7d2fe' },
  face: { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' },
  lip: { bg: '#fff1f2', color: '#be123c', border: '#fecdd3' },
  face_lip: { bg: '#fdf4ff', color: '#a21caf', border: '#f5d0fe' },
  camera: { bg: '#fffbeb', color: '#b45309', border: '#fde68a' },
  empty: { bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
};

function readDirectoryEntries(dirReader: any): Promise<any[]> {
  return new Promise((resolve) => {
    const entries: any[] = [];
    const readBatch = () => {
      dirReader.readEntries(
        (batch: any[]) => {
          if (!batch || batch.length === 0) {
            resolve(entries);
          } else {
            entries.push(...batch);
            readBatch();
          }
        },
        () => resolve(entries)
      );
    };
    readBatch();
  });
}

function readFileSystemEntry(entry: any): Promise<File[]> {
  return new Promise((resolve) => {
    if (!entry) {
      resolve([]);
      return;
    }
    if (entry.isFile) {
      entry.file(
        (file: File) => resolve([file]),
        () => resolve([])
      );
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      readDirectoryEntries(dirReader).then(async (subEntries) => {
        const subPromises = subEntries.map((sub) => readFileSystemEntry(sub));
        const subFilesArrays = await Promise.all(subPromises);
        resolve(subFilesArrays.flat());
      });
    } else {
      resolve([]);
    }
  });
}

async function scanFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = dataTransfer.items;

  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    const entries: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }

    const allArrays = await Promise.all(entries.map((e) => readFileSystemEntry(e)));
    return allArrays.flat();
  }

  const files: File[] = [];
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      files.push(dataTransfer.files[i]);
    }
  }

  return files;
}

export const DropZoneSection: React.FC<DropZoneSectionProps> = ({ t, pipeline }) => {
  const {
    bakeTargetType,
    setBakeTargetType,
    customPmxFile,
    vmdFile,
    vmdEntries,
    skippedCameraNames,
    selectPmx,
    selectMotionFiles,
    removeVmdEntry,
    clearVmdFiles,
    resetPmx,
    processing,
  } = pipeline;

  const pmxInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const vmdInputRef = useRef<HTMLInputElement>(null);
  const appendVmdInputRef = useRef<HTMLInputElement>(null);

  const processPmxFileList = (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    let pmxFile: File | null = null;
    const extraFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.name.toLowerCase().endsWith('.pmx')) {
        if (!pmxFile) pmxFile = f;
        else extraFiles.push(f);
      } else {
        extraFiles.push(f);
      }
    }

    if (pmxFile) {
      selectPmx(pmxFile, extraFiles);
    } else {
      alert(t.pmxAlert);
    }
  };

  const handlePmxFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processPmxFileList(e.target.files);
    }
  };

  const handleIncomingMotionFiles = async (
    rawFiles: File[],
    mode: 'auto' | 'replace' | 'append'
  ) => {
    const matched = rawFiles.filter((f) =>
      bakeTargetType === 'camera'
        ? f.name.toLowerCase().endsWith('.vmd')
        : isSupportedMotionFile(f.name)
    );
    if (matched.length === 0) {
      alert(mode === 'auto' ? t.vmdAlert : t.vmdNotFoundAlert);
      return;
    }
    await selectMotionFiles(matched, bakeTargetType, mode);
  };

  const handleVmdFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    mode: 'auto' | 'append'
  ) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      await handleIncomingMotionFiles(Array.from(fileList), mode);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDropPmx = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (processing) return;

    const files = await scanFilesFromDataTransfer(e.dataTransfer);
    processPmxFileList(files);
  };

  const handleDropVmd = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (processing) return;

    const files = await scanFilesFromDataTransfer(e.dataTransfer);
    const matched = files.filter((f) =>
      bakeTargetType === 'camera'
        ? f.name.toLowerCase().endsWith('.vmd')
        : isSupportedMotionFile(f.name)
    );
    if (matched.length > 0) {
      await selectMotionFiles(matched, bakeTargetType, 'auto');
    } else {
      alert(t.vmdNotFoundAlert);
    }
  };

  const renderPlaceholderTitle = () => {
    if (bakeTargetType === 'motion' && vmdEntries.length > 1) {
      return t.vmdMultiLoaded(vmdEntries.length);
    }
    if (vmdFile) {
      return t.vmdLoaded(vmdFile.name);
    }
    return bakeTargetType === 'motion' ? t.vmdPlaceholder : t.cameraVmdPlaceholder;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 烘焙类型切换：角色动作 vs 镜头动画 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', paddingBottom: 6, gap: 12 }}>
        <button
          type="button"
          onClick={() => setBakeTargetType('motion')}
          disabled={processing}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px 2px',
            fontSize: 13,
            fontWeight: bakeTargetType === 'motion' ? 600 : 400,
            color: bakeTargetType === 'motion' ? '#1677ff' : '#6b7280',
            borderBottom: bakeTargetType === 'motion' ? '2px solid #1677ff' : '2px solid transparent',
            cursor: processing ? 'not-allowed' : 'pointer',
            marginBottom: -7,
          }}
        >
          {t.bakeModeMotion}
        </button>
        <button
          type="button"
          onClick={() => setBakeTargetType('camera')}
          disabled={processing}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px 2px',
            fontSize: 13,
            fontWeight: bakeTargetType === 'camera' ? 600 : 400,
            color: bakeTargetType === 'camera' ? '#1677ff' : '#6b7280',
            borderBottom: bakeTargetType === 'camera' ? '2px solid #1677ff' : '2px solid transparent',
            cursor: processing ? 'not-allowed' : 'pointer',
            marginBottom: -7,
          }}
        >
          {t.bakeModeCamera}
        </button>
      </div>

      {/* PMX 模型嵌入区域 */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
          {t.baseModel}
        </div>

        <div
          onDragOver={handleDragOver}
          onDrop={handleDropPmx}
          onClick={() => !processing && pmxInputRef.current?.click()}
          style={{
            padding: '12px 10px',
            border: '1px dashed #d1d5db',
            borderRadius: 4,
            background: 'transparent',
            marginBottom: 8,
            textAlign: 'center',
            cursor: processing ? 'not-allowed' : 'pointer',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1677ff', marginBottom: 2 }}>
            {customPmxFile ? customPmxFile.name : t.defaultModelName}
          </div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>{t.pmxDropSubHint}</div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={pmxInputRef}
            type="file"
            accept=".pmx"
            onChange={handlePmxFileChange}
            style={{ display: 'none' }}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-ignore
            webkitdirectory=""
            directory=""
            onChange={handlePmxFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => pmxInputRef.current?.click()}
            disabled={processing}
            style={{
              flex: 1,
              padding: '5px 8px',
              fontSize: 11,
              border: '1px solid #d9d9d9',
              borderRadius: 3,
              cursor: processing ? 'not-allowed' : 'pointer',
              background: '#ffffff',
            }}
          >
            {t.customModel}
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={processing}
            style={{
              flex: 1,
              padding: '5px 8px',
              fontSize: 11,
              border: '1px solid #d9d9d9',
              borderRadius: 3,
              cursor: processing ? 'not-allowed' : 'pointer',
              background: '#ffffff',
            }}
          >
            {t.selectFolder}
          </button>
          {customPmxFile && (
            <button
              type="button"
              onClick={resetPmx}
              disabled={processing}
              style={{
                padding: '5px 8px',
                fontSize: 11,
                border: '1px solid #ff4d4f',
                color: '#ff4d4f',
                borderRadius: 3,
                cursor: processing ? 'not-allowed' : 'pointer',
                background: '#ffffff',
              }}
            >
              {t.resetDefaultModel}
            </button>
          )}
        </div>
      </div>

      {/* 动作/镜头动画文件嵌入区域（支持多 VMD 自动识别） */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
          {bakeTargetType === 'motion' ? t.vmdMotionTitle : t.vmdCameraTitle}
        </div>
        <input
          ref={vmdInputRef}
          type="file"
          multiple={bakeTargetType === 'motion'}
          accept={bakeTargetType === 'camera' ? '.vmd' : '.vmd,.fbx,.npy,.bvh,.anim,.json'}
          onChange={(e) => void handleVmdFileChange(e, 'auto')}
          style={{ display: 'none' }}
        />
        <input
          ref={appendVmdInputRef}
          type="file"
          multiple
          accept=".vmd"
          onChange={(e) => void handleVmdFileChange(e, 'append')}
          style={{ display: 'none' }}
        />
        <div
          onClick={() => !processing && vmdInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDropVmd}
          style={{
            padding: '16px 12px',
            border: '1px dashed #1677ff',
            borderRadius: 4,
            background: 'transparent',
            cursor: processing ? 'not-allowed' : 'pointer',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1677ff', marginBottom: 4 }}>
            {renderPlaceholderTitle()}
          </div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>{t.vmdHint}</div>
        </div>

        {/* 已识别的多 VMD 轨道列表 */}
        {bakeTargetType === 'motion' && vmdEntries.length > 0 && (
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            {vmdEntries.map((entry, idx) => {
              const badgeStyle = ROLE_BADGE_STYLE[entry.role] || ROLE_BADGE_STYLE.empty;
              return (
                <div
                  key={`${entry.name}-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '5px 7px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        flexShrink: 0,
                        padding: '1px 5px',
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: 700,
                        background: badgeStyle.bg,
                        color: badgeStyle.color,
                        border: `1px solid ${badgeStyle.border}`,
                      }}
                    >
                      {t.vmdRoleLabels[entry.role] || entry.role}
                    </span>
                    <span
                      title={entry.name}
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: '#1e293b',
                        fontWeight: 500,
                      }}
                    >
                      {entry.name}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>
                      {entry.uniqueBones > 0 ? `${entry.uniqueBones}骨 ` : ''}
                      {entry.uniqueMorphs > 0 ? `${entry.uniqueMorphs}表情` : ''}
                    </span>
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() => removeVmdEntry(idx)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#94a3b8',
                        cursor: processing ? 'not-allowed' : 'pointer',
                        padding: '0 2px',
                        fontSize: 13,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}

            {skippedCameraNames.length > 0 && (
              <div style={{ fontSize: 10, color: '#b45309', padding: '2px 4px' }}>
                {t.vmdSkippedCameraTip(skippedCameraNames.join(', '))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                type="button"
                disabled={processing}
                onClick={() => appendVmdInputRef.current?.click()}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#1677ff',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: 3,
                  cursor: processing ? 'not-allowed' : 'pointer',
                }}
              >
                {t.vmdAppendBtn}
              </button>
              <button
                type="button"
                disabled={processing}
                onClick={clearVmdFiles}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  color: '#64748b',
                  background: '#ffffff',
                  border: '1px solid #d1d5db',
                  borderRadius: 3,
                  cursor: processing ? 'not-allowed' : 'pointer',
                }}
              >
                {t.vmdClearAllBtn}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
