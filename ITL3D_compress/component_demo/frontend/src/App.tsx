import DragUpload, { DEFAULT_ALLOWED_EXTENSIONS } from '@component/DragUpload';
import { useCompressApi, formatBytes } from '@component/useCompressApi';
import type { CompressStats } from '@component/useCompressApi';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5100/api/compress';

function App() {
  const { compress, download, isBusy, status, error, stats } = useCompressApi({
    apiUrl: API_URL,
  });

  async function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;
    await compress(file);
    download();
  }

  const statusLabels: Record<string, string> = {
    uploading: '上传中...',
    processing: '后端压缩处理中...',
  };

  return (
    <main className="demo-shell">
      <section className="demo-panel">
        <div className="demo-heading">
          <p className="demo-subtitle">Component Demo</p>
          <h1>3D 模型转换 &amp; 压缩演示</h1>
          <p className="demo-desc">
            拖拽或选择任意支持的 3D 文件，后端自动转换为 GLB 并压缩（Draco + WebP），自动下载结果。
            <br />
            前端组件来自 <code>@glb-compress/frontend</code>，后端来自 <code>GlbCompressLib</code>。
          </p>
        </div>

        <DragUpload
          allowedExtensions={DEFAULT_ALLOWED_EXTENSIONS}
          multiple={false}
          hint="拖拽 3D 文件到此处，或点击选择"
          subHint="支持 OBJ、FBX、STL、PLY、GLB 等 84 种格式"
          disabled={isBusy}
          onFilesSelected={handleFilesSelected}
        />

        {isBusy && (
          <div className="demo-progress">
            <div className="demo-progress-bar" />
            <span>{statusLabels[status] ?? '处理中...'}</span>
          </div>
        )}

        {status === 'success' && stats && (
          <CompressResult stats={stats} onDownload={download} />
        )}

        {status === 'error' && (
          <div className="demo-error">
            <strong>错误：</strong>{error}
          </div>
        )}
      </section>
    </main>
  );
}

function CompressResult({ stats, onDownload }: { stats: CompressStats; onDownload: () => void }) {
  return (
    <div className="demo-success">
      <div className="demo-success-info">
        <span>压缩完成</span>
        <div className="demo-stats">
          <div className="demo-stat">
            <span className="demo-stat-label">原始大小</span>
            <span className="demo-stat-value">{formatBytes(stats.originalSize)}</span>
          </div>
          <div className="demo-stat-arrow"></div>
          <div className="demo-stat">
            <span className="demo-stat-label">压缩后</span>
            <span className="demo-stat-value">{formatBytes(stats.compressedSize)}</span>
          </div>
          <div className="demo-stat">
            <span className="demo-stat-label">压缩率</span>
            <span className="demo-stat-value demo-stat-ratio">{stats.ratio}%</span>
          </div>
        </div>
        <code className="demo-filename">{stats.fileName}</code>
      </div>
      <button className="demo-download-btn" onClick={onDownload}>
        下载压缩文件
      </button>
    </div>
  );
}

export default App;
