// src/App.tsx
import { useMemo, useRef, useState } from 'react';
import './App.css';
import { ClipSection } from './components/ClipSection';
import { DownloadSection } from './components/DownloadSection';
import { DropZoneSection } from './components/DropZoneSection';
import { MetadataSection } from './components/MetadataSection';
import { ThreeCanvas } from './components/ThreeCanvas';
import { useExpressionTracks } from './hooks/useExpressionTracks';
import { useMmdPipeline } from './hooks/useMmdPipeline';
import { useThreeScene } from './hooks/useThreeScene';
import { useVrmaMetadata } from './hooks/useVrmaMetadata';
import { detectInitialLanguage, I18N, Lang } from './i18n';

const BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const DEFAULT_PMX_PATH = `${BASE}ganyu_by_原神/甘雨.pmx`;
const DEFAULT_VMD_PATH = `${BASE}motion.vmd`;

export default function App() {
  const [lang, setLang] = useState<Lang>(detectInitialLanguage);
  const t = useMemo(() => I18N[lang], [lang]);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const threeBridge = useThreeScene(canvasContainerRef);

  const exprState = useExpressionTracks();
  const pipeline = useMmdPipeline(
    threeBridge,
    DEFAULT_PMX_PATH,
    DEFAULT_VMD_PATH,
    lang,
    exprState.tracks
  );
  const meta = useVrmaMetadata();

  const switchLanguage = (newLang: Lang) => {
    setLang(newLang);
    localStorage.setItem('app_lang', newLang);
  };

  return (
    <div className="mmd-page">
      <div className="mmd-shell">
        <div className="mmd-header">
          <h2 className="mmd-header-title">{t.title}</h2>
          <div className="mmd-lang-switch">
            {(['zh', 'en', 'ja'] as const).map((l) => (
              <button
                key={l}
                onClick={() => switchLanguage(l)}
                className="mmd-lang-btn"
                style={{
                  background: lang === l ? '#1677ff' : 'transparent',
                  color: lang === l ? '#ffffff' : '#4b5563',
                  fontWeight: lang === l ? 600 : 400,
                }}
              >
                {l === 'zh' ? '中文' : l === 'en' ? 'English' : '日本語'}
              </button>
            ))}
          </div>
        </div>

        <div className="mmd-workspace">
          <div className="mmd-col-left">
            <div className="mmd-slot-dropzone">
              <DropZoneSection t={t} pipeline={pipeline} />
            </div>
          </div>

          <div className="mmd-col-center">
            <div className="mmd-slot-canvas">
              <ThreeCanvas
                t={t}
                containerRef={canvasContainerRef}
                viewMode={threeBridge.viewMode}
                onToggleViewMode={threeBridge.setViewMode}
                isCameraMode={pipeline.bakeTargetType === 'camera'}
              />
            </div>

            <div className="mmd-slot-clip">
              <ClipSection t={t} pipeline={pipeline} exprState={exprState} />
            </div>
          </div>

          <div className="mmd-col-right">
            <div className="mmd-slot-meta">
              <MetadataSection t={t} meta={meta} disabled={pipeline.processing} />
            </div>

            <div className="mmd-slot-download">
              <DownloadSection t={t} pipeline={pipeline} meta={meta} />
            </div>
          </div>
        </div>

        <footer className="mmd-footer">
          <a
            href="https://github.com/SUXUING-star/mmd-motion-baker-gltf"
            target="_blank"
            rel="noopener noreferrer"
            className="mmd-footer-link"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>GitHub: SUXUING-star/mmd-motion-baker-gltf</span>
          </a>
        </footer>
      </div>
    </div>
  );
}
