import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import DragUpload from './components/DragUpload';
import FileListPanel from './components/FileListPanel';
import { useCompressApi, formatBytes } from './components/useCompressApi';
import { classifyFiles, ALL_ALLOWED_EXTENSIONS, getExt } from './components/FileClassifier';
import type { ClassifiedFileEntry } from './components/FileListPanel';
// import { ITL3D } from './components/ITL3D';  // ⬅️ replaced by modelviewer
import Itlmodelviewer from './components/Itlmodelviewer';
import LevaPanel, { DEFAULT_CONFIG } from './components/LevaPanel';
import type { LevaConfig } from './components/LevaPanel';
import './App.css';

// ══════════════════════════════════════════════════════════════════════════════
// App — Multi-File Demo Flow
// ══════════════════════════════════════════════════════════════════════════════

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5100/api/compress';

/**
 * Extended phases for multi-file workflow:
 *   'upload'       → Initial drop zone
 *   'classifying'  → Show file classification results + warnings
 *   'compressing'  → Show spinner while backend processes
 *   'preview'      → Show 3D viewer with compressed result
 */
type AppPhase = 'upload' | 'classifying' | 'compressing' | 'preview';

export default function App() {
  // ── Upload & Compress ──
  const { compress, download, status, error, stats, downloadUrl, isZip } = useCompressApi({ apiUrl: API_URL });
  const isBusy = status === 'uploading' || status === 'processing';

  // ── Multi-File State ──
  const [phase, setPhase] = useState<AppPhase>('upload');
  const [rawFiles, setRawFiles] = useState<File[]>([]);

  // Classification result (computed from rawFiles)
  const classification = useMemo(() => classifyFiles(rawFiles), [rawFiles]);

  // Convert classification result to props for FileListPanel
  const classifiedProps = useMemo(() => {
    const toEntry = (file: File): ClassifiedFileEntry => ({
      name: file.name,
      ext: getExt(file.name),
      size: file.size,
      category: 'unknown' as const,
    });

    const mainEntries = classification.mainFiles.map((f) => ({
      ...toEntry(f.file),
      category: f.category,
    }));

    const auxEntries = classification.auxiliaryFiles.map((f) => ({
      ...toEntry(f.file),
      category: f.category,
    }));

    const unknownEntries = classification.unknownFiles.map((f) => ({
      ...toEntry(f.file),
      category: f.category,
    }));

    return {
      mainFiles: mainEntries,
      auxiliaryFiles: auxEntries,
      unknownFiles: unknownEntries,
      warnings: classification.warnings,
      infos: classification.infos,
      hasMultipleMains: classification.status === 'multiple_mains',
    };
  }, [classification]);

  // ── Preview State ──
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  // ── Leva Config ──
  const [levaConfig, setLevaConfig] = useState<LevaConfig>(DEFAULT_CONFIG);
  const [levaOpen, setLevaOpen] = useState(false);
  const screenshotRef = useRef<(() => void) | null>(null);

  // ── File select → classify ──
  const handleFilesSelected = useCallback((files: File[]) => {
    setRawFiles(files);
    setPhase('classifying');
    // Reset preview state
    setModelUrl(null);
    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl);
      setLocalPreviewUrl(null);
    }
  }, [localPreviewUrl]);

  // ── Start Conversion (from classification phase) ──
  const handleStartConversion = useCallback(async () => {
    if (classification.mainFiles.length === 0) return;

    // Set local preview from first main file (for "uploading" phase)
    const localUrl = URL.createObjectURL(classification.mainFiles[0].file);
    setLocalPreviewUrl(localUrl);
    setModelUrl(null);
    setLevaOpen(false);
    setPhase('compressing');

    // Upload ALL main files + all auxiliary files
    await compress(
      classification.mainFiles.map((f) => f.file),
      classification.auxiliaryFiles.map((a) => a.file)
    );
  }, [classification, compress]);

  // ── Back to upload (from classification phase) ──
  const handleBackToUpload = useCallback(() => {
    setPhase('upload');
    setRawFiles([]);
  }, []);

  // Switch to compressed model once done
  useEffect(() => {
    if (phase === 'compressing' && status === 'success' && downloadUrl) {
      setPhase('preview');
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
        setLocalPreviewUrl(null);
      }
      setModelUrl(downloadUrl);
    }
    if (phase === 'compressing' && status === 'error') {
      setPhase('preview');
    }
  }, [phase, status, downloadUrl, localPreviewUrl]);

  // ── Current model source ──
  const displayUrl = modelUrl ?? localPreviewUrl;

  // ── Retry ──
  const handleRetry = useCallback(() => {
    setPhase('upload');
    setRawFiles([]);
    setModelUrl(null);
    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl);
      setLocalPreviewUrl(null);
    }
    setLevaOpen(false);
  }, [localPreviewUrl]);

  // ── Reset ──
  const handleReset = useCallback(() => {
    setPhase('upload');
    setRawFiles([]);
    setModelUrl(null);
    setLocalPreviewUrl(null);
    setLevaOpen(false);
    setLevaConfig(DEFAULT_CONFIG);
  }, []);

  // ── Screenshot ──
  const handleScreenshot = useCallback(() => {
    screenshotRef.current?.();
  }, []);

  // ── Export Config ──
  const handleExportConfig = useCallback(() => {
    const json = JSON.stringify(levaConfig, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      alert('Config copied to clipboard');
    });
  }, [levaConfig]);

  // ── Download result ──
  const handleDownload = useCallback(() => {
    download();
  }, [download]);

  // ══════════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="app-shell">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-logo-row">
          <div className="app-logo" onClick={() => window.open('https://itlogica.com/', '_blank', 'noopener,noreferrer')}>
            <img src="/itlogica-logo.svg" alt="ITLogica" width="60" height="28" />
            <span>3D Model</span>
          </div>
          <div className="app-phase-tags">
            {phase === 'upload' && <span className="tag tag-idle">Ready</span>}
            {phase === 'classifying' && <span className="tag tag-idle">Review Files</span>}
            {phase === 'compressing' && <span className="tag tag-active">Compressing</span>}
            {phase === 'preview' && <span className="tag tag-done">Preview</span>}
          </div>
        </div>
        <div className="app-actions">
          {phase === 'preview' && (
            <button className="app-btn app-btn-secondary" onClick={handleReset}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 1 9 9"/><path d="M3 3v6h6"/></svg>
              Re-upload
            </button>
          )}
        </div>
      </header>

      {/* ── Main Area ── */}
      <main className="app-main">
        {/* ═══ Upload Phase ═══ */}
        {phase === 'upload' && (
          <section className="app-upload-section">
            <div className="upload-hero">
              <h1 className="upload-title">
                Conversion &amp; Compression
              </h1>
              {/* <p className="upload-desc">
                Drop your 3D model file + auxiliary files (textures, materials) together.
                We'll automatically identify the main file and process everything correctly.
              </p> */}
            </div>
            <div className="upload-card">
              <DragUpload
                allowedExtensions={ALL_ALLOWED_EXTENSIONS}
                hint="Drop 3D model + auxiliary files here, or click to browse"
                subHint="Supports OBJ with MTL/textures, glTF with BIN/textures, Shapefile with companions, and 80+ formats"
                onFilesSelected={handleFilesSelected}
              />
            </div>
          </section>
        )}

        {/* ═══ Classifying Phase ═══ */}
        {phase === 'classifying' && (
          <section className="app-upload-section">
            <div className="upload-hero">
              <h2 className="upload-title" style={{ fontSize: 24, marginBottom: 8 }}>
                Review &amp; Confirm Files
              </h2>
            </div>
            <FileListPanel
              mainFiles={classifiedProps.mainFiles}
              auxiliaryFiles={classifiedProps.auxiliaryFiles}
              unknownFiles={classifiedProps.unknownFiles}
              warnings={classifiedProps.warnings}
              infos={classifiedProps.infos}
              hasMultipleMains={classifiedProps.hasMultipleMains}
              onBack={handleBackToUpload}
              onStartConversion={handleStartConversion}
              isConverting={isBusy}
            />
          </section>
        )}

        {/* ═══ Compressing Phase ═══ */}
        {phase === 'compressing' && (
          <section className="app-upload-section">
            <div className="compress-progress">
              <div className="compress-spinner" />
              <span className="compress-label">
                {status === 'uploading' ? 'Uploading files...' : 'Processing on server...'}
              </span>
              <span className="compress-hint">
                {classification.mainFiles.length > 1
                  ? `Converting ${classification.mainFiles.length} model files to GLB`
                  : classification.mainFiles.length === 1
                    ? `Converting ${classification.mainFiles[0].file.name} to GLB`
                    : 'File will be auto-converted to GLB'}
              </span>
              {classification.auxiliaryFiles.length > 0 && (
                <span className="compress-hint" style={{ fontSize: 11 }}>
                  Including {classification.auxiliaryFiles.length} auxiliary file{classification.auxiliaryFiles.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </section>
        )}

        {/* ═══ Error State ═══ */}
        {phase === 'preview' && error && (
          <section className="app-upload-section">
            <div className="compress-error">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <strong>Compression failed</strong>
              <p>{error}</p>
              <button className="app-btn app-btn-primary" onClick={handleRetry}>Retry</button>
            </div>
          </section>
        )}

        {/* ═══ Preview Phase ═══ */}
        {(phase === 'preview' && !error) && (
          <div className="app-preview-area">
            {/* Canvas */}
            <div className="app-canvas">
              {/* ═══ Original ITL3D component (replaced by itlmodelviewer) ═══ */}
              {/* <ITL3D
                modelUrl={displayUrl || undefined}
                mode={levaConfig.cutMode}
                cutDepth={levaConfig.cutDepth}
                cutAngle={levaConfig.cutAngle}
                cutN={levaConfig.cutN}
                cutR={levaConfig.cutR}
                showCuttingSurface={levaConfig.showCuttingSurface}
                cutFaceMaskColor={levaConfig.cutFaceMaskColor}
                cutBodyMaskColor={levaConfig.cutBodyMaskColor}
                showCutBodyWireframe={levaConfig.showCutBodyWireframe}
                faceNCutsView={levaConfig.faceNCutsView}
                modelOpacityForFaceOrBoth={levaConfig.modelOpacityForFaceOrBoth}
                overlayOpacityForBodyOrBoth={levaConfig.overlayOpacityForBodyOrBoth}
                cutBodyDepthOpacity={levaConfig.cutBodyDepthOpacity}
                cutBodyNCutsOpacity={levaConfig.cutBodyNCutsOpacity}
                orientation={levaConfig.orientation}
                canRotate={levaConfig.canRotate}
                canDrag={levaConfig.canDrag}
                autoRotate={levaConfig.autoRotate}
                background={levaConfig.background}
                shadows={levaConfig.shadows}
                preset={levaConfig.preset}
                lightIntensity={levaConfig.lightIntensity}
                contactShadow={levaConfig.contactShadow}
                style={{ width: '100%', height: '100%' }}
              /> */}

              {/* ═══ itlmodelviewer — coal-slicer style model display ═══ */}
              {displayUrl && (
                <Itlmodelviewer
                  modelUrl={displayUrl}
                  config={{
                    shadows: levaConfig.shadows,
                    contactShadow: levaConfig.contactShadow,
                    lightIntensity: levaConfig.lightIntensity,
                    preset: levaConfig.preset,
                    background: levaConfig.background,
                    orientation: levaConfig.orientation,
                    autoRotate: levaConfig.autoRotate,
                    canRotate: levaConfig.canRotate,
                    canDrag: levaConfig.canDrag,
                    cutN: levaConfig.cutN,
                    cutR: levaConfig.cutR,
                  }}
                  style={{ width: '100%', height: '100%' }}
                />
              )}

              {/* Leva floating button + panel */}
              <LevaPanel
                config={levaConfig}
                onChange={(patch) => setLevaConfig({ ...levaConfig, ...patch })}
                onScreenshot={handleScreenshot}
                onDownload={downloadUrl ? handleDownload : undefined}
                onExportConfig={handleExportConfig}
                isOpen={levaOpen}
                onToggle={() => setLevaOpen(!levaOpen)}
              />
            </div>

            {/* Bottom Toolbar */}
            {phase === 'preview' && stats && (
              <div className="app-toolbar">
                <div className="app-stats">
                  <div className="app-stat">
                    <span className="app-stat-label">Original</span>
                    <span className="app-stat-value">{formatBytes(stats.originalSize)}</span>
                  </div>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="app-stat-arrow">
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                  <div className="app-stat">
                    <span className="app-stat-label">Compressed</span>
                    <span className="app-stat-value">{formatBytes(stats.compressedSize)}</span>
                  </div>
                  <div className="app-stat app-stat-highlight">
                    <span className="app-stat-label">Ratio</span>
                    <span className="app-stat-value">{stats.ratio}%</span>
                  </div>
                  <code className="app-stat-filename">{stats.fileName}</code>
                </div>
                <div className="app-toolbar-actions">
                  <button className="app-btn app-btn-primary" onClick={handleDownload}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
                    {isZip ? 'Download All (ZIP)' : 'Download Compressed'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
