// src/components/DropZoneSection.tsx
import React, { useRef } from 'react';
import { MmdPipeline } from '../hooks/useMmdPipeline';
import { I18nTexts } from '../i18n';

interface DropZoneSectionProps {
  t: I18nTexts;
  pipeline: MmdPipeline;
}

const SUPPORTED_MOTION_EXTS = ['.vmd', '.fbx', '.npy', '.bvh', '.anim', '.json'];

const isSupportedMotionFile = (name: string) =>
  SUPPORTED_MOTION_EXTS.some((ext) => name.toLowerCase().endsWith(ext));

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
    selectPmx,
    selectVmd,
    resetPmx,
    processing,
  } = pipeline;

  const pmxInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const vmdInputRef = useRef<HTMLInputElement>(null);

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

  const handleVmdFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const ok =
        bakeTargetType === 'camera'
          ? file.name.toLowerCase().endsWith('.vmd')
          : isSupportedMotionFile(file.name);
      if (ok) {
        selectVmd(file);
      } else {
        alert(t.vmdAlert);
      }
    }
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
    const motion = files.find((f) =>
      bakeTargetType === 'camera'
        ? f.name.toLowerCase().endsWith('.vmd')
        : isSupportedMotionFile(f.name)
    );
    if (motion) {
      selectVmd(motion);
    } else {
      alert(t.vmdNotFoundAlert);
    }
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

      {/* 动作/镜头动画文件嵌入区域 */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
          {bakeTargetType === 'motion' ? t.vmdMotionTitle : t.vmdCameraTitle}
        </div>
        <input
          ref={vmdInputRef}
          type="file"
          accept={bakeTargetType === 'camera' ? '.vmd' : '.vmd,.fbx,.npy,.bvh,.anim,.json'}
          onChange={handleVmdFileChange}
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
            {vmdFile
              ? t.vmdLoaded(vmdFile.name)
              : bakeTargetType === 'motion'
              ? t.vmdPlaceholder
              : t.cameraVmdPlaceholder}
          </div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>{t.vmdHint}</div>
        </div>
      </div>
    </div>
  );
};
