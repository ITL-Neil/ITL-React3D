import { useState } from 'react';
import DragUpload from './DragUpload';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5100/api/compress';

type Status = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  ratio: string;
  fileName: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [stats, setStats] = useState<CompressionStats | null>(null);

  const isBusy = status === 'uploading' || status === 'processing';

  async function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;

    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl('');
    setError('');
    setStats(null);
    setFileName(file.name);
    setStatus('uploading');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(API_URL, { method: 'POST', body: formData });
      setStatus('processing');

      if (!response.ok) {
        const ct = response.headers.get('content-type') ?? '';
        let msg = '压缩失败，请检查后端日志。';
        if (ct.includes('application/json')) {
          const body = (await response.json()) as { error?: string };
          msg = body.error ?? msg;
        } else {
          msg = (await response.text()) || msg;
        }
        throw new Error(msg);
      }

      // 提取压缩统计（响应头）
      const originalSize = parseInt(response.headers.get('x-original-size') ?? '0', 10);
      const compressedSize = parseInt(response.headers.get('x-compressed-size') ?? '0', 10);
      const ratio = response.headers.get('x-compression-ratio') ?? '—';

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const disposition = response.headers.get('content-disposition') ?? '';
      // 优先解析 RFC 5987: filename*=UTF-8''xxx
      let match = disposition.match(/filename\*=UTF-8''([^;]+)/);
      if (!match) {
        // 退而解析普通格式: filename="xxx" 或 filename=xxx
        match = disposition.match(/filename[^*;=\n]*=(["']?)([^"';\n]+)\1/);
      }
      const outName = match ? decodeURIComponent(match[1] ?? match[2]) : 'compressed.glb';

      setStats({ originalSize, compressedSize, ratio, fileName: outName });
      setDownloadUrl(url);
      setStatus('success');
      triggerDownload(url, outName);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : '未知错误');
    }
  }

  function triggerDownload(url: string, name: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <main className="demo-shell">
      <section className="demo-panel">
        <div className="demo-heading">
          <p className="demo-subtitle">Component Demo</p>
          <h1>GLB 压缩演示</h1>
          <p className="demo-desc">
            拖拽或选择 <strong>.glb</strong> 文件，前端组件验证格式后发送至后端压缩（Draco + WebP），自动下载结果。
          </p>
        </div>

        <DragUpload
          allowedExtensions={['glb']}
          multiple={false}
          hint="拖拽 GLB 文件到此处，或点击选择"
          subHint="仅接受 .glb 格式"
          disabled={isBusy}
          onFilesSelected={handleFilesSelected}
        />

        {isBusy && (
          <div className="demo-progress">
            <div className="demo-progress-bar" />
            <span>{status === 'uploading' ? '上传中...' : '后端压缩处理中...'}</span>
          </div>
        )}

        {status === 'success' && stats && downloadUrl && (
          <div className="demo-success">
            <div className="demo-success-info">
              <span>✅ 压缩完成</span>
              <div className="demo-stats">
                <div className="demo-stat">
                  <span className="demo-stat-label">原始大小</span>
                  <span className="demo-stat-value">{formatBytes(stats.originalSize)}</span>
                </div>
                <div className="demo-stat-arrow">→</div>
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
            <a href={downloadUrl} download={stats.fileName} className="demo-download-btn">
              重新下载
            </a>
          </div>
        )}

        {status === 'error' && (
          <div className="demo-error">
            <strong>❌ 错误：</strong>{error}
          </div>
        )}

        {fileName && !isBusy && (
          <p className="demo-file-name">文件：{fileName}</p>
        )}
      </section>
    </main>
  );
}

export default App;
