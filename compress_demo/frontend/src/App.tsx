import { ChangeEvent, DragEvent, useRef, useState } from 'react';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api/upload';

type Status = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFile(file: File) {
    setFileName(file.name);
    setError('');
    clearDownloadUrl();
    setStatus('uploading');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });

      setStatus('processing');

      if (!response.ok) {
        const message = await readError(response);
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setStatus('success');
      triggerDownload(url);
    } catch (uploadError) {
      setStatus('error');
      setError(uploadError instanceof Error ? uploadError.message : '上传或压缩失败。');
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void uploadFile(file);
    }
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (file) {
      void uploadFile(file);
    }
  }

  function clearDownloadUrl() {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl('');
    }
  }

  function triggerDownload(url: string) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'compressed.glb';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const isBusy = status === 'uploading' || status === 'processing';
  const statusText = getStatusText(status);

  return (
    <main className="shell">
      <section className="panel">
        <div className="heading">
          <p>GLB Draco + WebP</p>
          <h1>3D 模型文件压缩工具</h1>
        </div>

        <div
          className={`dropzone ${isDragging ? 'dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              inputRef.current?.click();
            }
          }}
        >
          <input ref={inputRef} type="file" onChange={handleFileChange} />
          <div className="uploadIcon">GLB</div>
          <strong>{isBusy ? statusText : '选择或拖拽文件上传'}</strong>
          <span>{fileName || '默认接受任意文件，本工具按 GLB 流程处理。'}</span>
        </div>

        {isBusy && (
          <div className="progress" aria-label={statusText}>
            <div />
          </div>
        )}

        {status === 'success' && downloadUrl && (
          <a className="download" href={downloadUrl} download="compressed.glb">
            下载 compressed.glb
          </a>
        )}

        {status === 'error' && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

async function readError(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body = (await response.json()) as { error?: string };
    return body.error ?? '服务端返回错误。';
  }

  return response.text();
}

function getStatusText(status: Status) {
  switch (status) {
    case 'uploading':
      return '上传中...';
    case 'processing':
      return '压缩处理中...';
    case 'success':
      return '压缩完成';
    case 'error':
      return '处理失败';
    default:
      return '等待上传';
  }
}

export default App;
