// FileListPanel.tsx — Displays classified files (main + auxiliary) before conversion
// Shows warnings, suggestions, and provides a "Start Conversion" button.

import './FileListPanel.css';

interface ClassifiedFileEntry {
  name: string;
  ext: string;
  size: number;
  category: 'main' | 'auxiliary' | 'unknown';
}

interface FileListPanelProps {
  /** ALL identified main model files (multiple supported for multi-part models) */
  mainFiles: ClassifiedFileEntry[];
  /** All auxiliary files (textures, materials, etc.) */
  auxiliaryFiles: ClassifiedFileEntry[];
  /** Unrecognized/unknown files */
  unknownFiles: ClassifiedFileEntry[];
  /** Warning messages */
  warnings: string[];
  /** Informational messages */
  infos: string[];
  /** Whether multiple main model files were detected */
  hasMultipleMains: boolean;
  /** Callback: user wants to go back and re-upload */
  onBack: () => void;
  /** Callback: user confirms and starts conversion */
  onStartConversion: () => void;
  /** Whether conversion is currently in progress (disables button) */
  isConverting?: boolean;
}

/** Format bytes to human-readable */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Get icon for file extension */
function getFileIcon(ext: string): string {
  const modelIcons: Record<string, string> = {
    obj: '\u{1F4D0}', gltf: '\u{1F310}', shp: '\u{1F5FA}', fbx: '\u{1F3AC}',
    dae: '\u{1F3D7}', '3ds': '\u{1F4A0}', ply: '\u{1F4E6}', stl: '\u{1F527}',
    glb: '\u{1F310}',
  };
  return modelIcons[ext] ?? '\u{1F4CE}';
}

/** Get icon class for file category */
function getCategoryIconClass(ext: string): string {
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga', 'hdr', 'exr', 'tif', 'tiff'].includes(ext)) {
    return 'flp-icon-texture';
  }
  if (['mtl'].includes(ext)) {
    return 'flp-icon-material';
  }
  if (['shx', 'dbf', 'prj', 'cpg', 'sbn', 'sbx', 'qix', 'lyr', 'xml', 'kml'].includes(ext)) {
    return 'flp-icon-data';
  }
  if (['bin'].includes(ext)) {
    return 'flp-icon-data';
  }
  return 'flp-icon-unknown';
}

export default function FileListPanel({
  mainFiles,
  auxiliaryFiles,
  unknownFiles,
  warnings,
  infos,
  hasMultipleMains,
  onBack,
  onStartConversion,
  isConverting = false,
}: FileListPanelProps) {
  const totalFiles = mainFiles.length + auxiliaryFiles.length + unknownFiles.length;

  return (
    <div className="file-list-panel">
      {/* ── Summary Header ── */}
      <div className="flp-section-title">
        File Summary
        <span className="flp-badge">{totalFiles}</span>
      </div>

      {/* ── Main File Cards (all of them) ── */}
      {mainFiles.length > 0 && (
        <>
          <div className="flp-section-title">
            {mainFiles.length > 1 ? `Model Files` : `Model File`}
            <span className="flp-badge">{mainFiles.length}</span>
          </div>
          <div className="flp-scroll-area flp-scroll-main">
            {mainFiles.map((mf, i) => (
              <div key={i} className={`flp-card flp-card-main`}>
                <div className="flp-card-icon flp-icon-model">
                  {getFileIcon(mf.ext)}
                </div>
                <div className="flp-card-info">
                  <span className="flp-card-name">{mf.name}</span>
                  <span className="flp-card-meta">
                    .{mf.ext} <span className="flp-card-meta-dot" /> {formatSize(mf.size)}
                  </span>
                </div>
                <div className="flp-card-status flp-status-main">
                  {i === 0 ? 'Main File' : `Part ${i + 1}`}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Auxiliary Files ── */}
      {auxiliaryFiles.length > 0 && (
        <>
          <div className="flp-section-title">
            Auxiliary Files
            <span className="flp-badge">{auxiliaryFiles.length}</span>
          </div>
          <div className="flp-scroll-area flp-scroll-aux">
            <div className="flp-aux-grid">
              {auxiliaryFiles.map((f, i) => (
                <div key={i} className="flp-aux-chip">
                  <span className={`flp-aux-chip-icon ${getCategoryIconClass(f.ext)}`} style={{ fontSize: 14 }}>
                    {getFileIcon(f.ext)}
                  </span>
                  <span>{f.name}</span>
                  <span style={{ color: '#80868b', fontSize: 11 }}>.{f.ext}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Unknown Files ── */}
      {unknownFiles.length > 0 && (
        <>
          <div className="flp-section-title">
            Unrecognized
            <span className="flp-badge">{unknownFiles.length}</span>
          </div>
          <div className="flp-scroll-area flp-scroll-unknown">
            <div className="flp-aux-grid">
              {unknownFiles.map((f, i) => (
                <div key={i} className="flp-aux-chip" style={{ opacity: 0.65 }}>
                  <span className="flp-aux-chip-icon flp-icon-unknown" style={{ fontSize: 14 }}>
                    {'\u2753'}
                  </span>
                  <span>{f.name}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Warnings ── */}
      {warnings.length > 0 && (
        <div className="flp-warnings">
          {warnings.map((w, i) => (
            <div key={i} className="flp-warn-item">
              <span className="flp-warn-icon">{'\u26A0\uFE0F'}</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Info ── */}
      {infos.length > 0 && (
        <div className="flp-warnings">
          {infos.map((info, i) => (
            <div key={i} className="flp-info-item">
              <span className="flp-info-icon">{'\u2139\uFE0F'}</span>
              <span>{info}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── No main file error state ── */}
      {mainFiles.length === 0 && (
        <div className="flp-empty">
          <div style={{ fontSize: 40, marginBottom: 8 }}>{'\u{1F50D}'}</div>
          <strong style={{ display: 'block', marginBottom: 4, color: '#202124' }}>
            No model file detected
          </strong>
          <p style={{ color: '#5f6368', fontSize: 13 }}>
            Please upload at least one 3D model file (OBJ, FBX, GLTF, STL, PLY, etc.).
            <br />
            You can also include auxiliary files like textures (.png, .jpg) and materials (.mtl).
          </p>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flp-actions">
        <button className="flp-btn flp-btn-back" onClick={onBack} disabled={isConverting}>
          {'\u2190'} Re-upload
        </button>
        <button
          className="flp-btn flp-btn-convert"
          onClick={onStartConversion}
          disabled={mainFiles.length === 0 || isConverting}
        >
          {isConverting ? (
            <>
              <span className="compress-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              Converting...
            </>
          ) : (
            <>
              {'\u2728'} Start Conversion
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export type { ClassifiedFileEntry, FileListPanelProps };
