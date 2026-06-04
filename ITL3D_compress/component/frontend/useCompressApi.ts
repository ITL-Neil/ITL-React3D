/// <reference types="vite/client" />

import { useCallback, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 上传与压缩的当前状态 */
export type CompressStatus =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'success'
  | 'error';

/** 压缩统计信息（从响应头提取） */
export interface CompressStats {
  /** 原始文件大小（字节） */
  originalSize: number;
  /** 压缩后文件大小（字节） */
  compressedSize: number;
  /** 压缩率（百分比字符串，如 "35.2"） */
  ratio: string;
  /** 下载文件名 */
  fileName: string;
}

/** useCompressApi 的配置项 */
export interface CompressApiOptions {
  /** 后端 API 地址，默认从 VITE_API_URL 环境变量读取，回退 localhost:5100/api/compress */
  apiUrl?: string;
  /** 上传表单字段名，默认 "file" */
  fieldName?: string;
}

/** useCompressApi 的返回值 */
export interface CompressApiReturn {
  /** 当前状态 */
  status: CompressStatus;
  /** 是否忙碌中（uploading 或 processing） */
  isBusy: boolean;
  /** 错误信息 */
  error: string;
  /** 压缩统计（success 后方有值） */
  stats: CompressStats | null;
  /** 压缩后文件的 Blob URL（success 后方有值，可用于 <a> 下载） */
  downloadUrl: string;
  /** 调用以执行上传+压缩 */
  compress: (file: File) => Promise<void>;
  /** 重置到 idle 状态并释放 Blob URL */
  reset: () => void;
  /** 触发浏览器下载（也可自行使用 downloadUrl） */
  download: () => void;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 将字节数格式化为可读字符串 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React Hook：封装 3D 文件上传 → 格式转换 → GLB 压缩 的完整流程。
 *
 * 零外部依赖，仅需 React 18+。
 *
 * @example
 * ```tsx
 * function MyPage() {
 *   const { status, isBusy, error, stats, downloadUrl, compress, reset, download } = useCompressApi();
 *
 *   async function handleFiles(files: File[]) {
 *     await compress(files[0]);
 *     download(); // 自动触发下载
 *   }
 *
 *   return (
 *     <div>
 *       <DragUpload onFilesSelected={handleFiles} disabled={isBusy} />
 *       {isBusy && <Spinner />}
 *       {status === 'success' && stats && (
 *         <p>压缩完成：{formatBytes(stats.originalSize)} → {formatBytes(stats.compressedSize)}</p>
 *       )}
 *       {status === 'error' && <p className="error">{error}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCompressApi(options: CompressApiOptions = {}): CompressApiReturn {
  const {
    apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5100/api/compress',
    fieldName = 'file',
  } = options;

  const [status, setStatus] = useState<CompressStatus>('idle');
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [stats, setStats] = useState<CompressStats | null>(null);

  const downloadUrlRef = useRef<string>('');

  /** 清理旧的 Blob URL */
  const revoke = useCallback(() => {
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = '';
    }
  }, []);

  /** 重置到初始状态 */
  const reset = useCallback(() => {
    revoke();
    setStatus('idle');
    setError('');
    setDownloadUrl('');
    setStats(null);
  }, [revoke]);

  /** 执行上传 + 压缩 */
  const compress = useCallback(
    async (file: File) => {
      revoke();
      setError('');
      setStats(null);
      setDownloadUrl('');
      setStatus('uploading');

      const formData = new FormData();
      formData.append(fieldName, file);

      try {
        const response = await fetch(apiUrl, { method: 'POST', body: formData });
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
        downloadUrlRef.current = url;

        // 解析文件名（支持 RFC 5987: filename*=UTF-8''xxx 及标准格式）
        const disposition = response.headers.get('content-disposition') ?? '';
        let match = disposition.match(/filename\*=UTF-8''([^;]+)/);
        if (!match) {
          match = disposition.match(/filename[^*;=\n]*=(["']?)([^"';\n]+)\1/);
        }
        const outName = match
          ? decodeURIComponent(match[1] ?? match[2])
          : 'compressed.glb';

        setStats({ originalSize, compressedSize, ratio, fileName: outName });
        setDownloadUrl(url);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : '未知错误');
      }
    },
    [apiUrl, fieldName, revoke]
  );

  /** 触发浏览器下载 */
  const download = useCallback(() => {
    if (!downloadUrl) return;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = stats?.fileName ?? 'compressed.glb';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [downloadUrl, stats?.fileName]);

  return {
    status,
    isBusy: status === 'uploading' || status === 'processing',
    error,
    stats,
    downloadUrl,
    compress,
    reset,
    download,
  };
}
