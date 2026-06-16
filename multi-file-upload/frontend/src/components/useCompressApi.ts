/// <reference types="vite/client" />

import { useCallback, useRef, useState } from 'react';

// ══════════════════════════════════════════════════════════════════════════════
// Type Definitions
// ══════════════════════════════════════════════════════════════════════════════

/** Current state of upload & compression */
export type CompressStatus =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'success'
  | 'error';

/** Compression statistics (extracted from response headers) */
export interface CompressStats {
  /** Original file size in bytes */
  originalSize: number;
  /** Compressed file size in bytes */
  compressedSize: number;
  /** Compression ratio as percentage string (e.g., "35.2") */
  ratio: string;
  /** Download filename */
  fileName: string;
}

/** Options for useCompressApi */
export interface CompressApiOptions {
  /** Backend API URL */
  apiUrl?: string;
  /** Upload form field name for files array, default "files" */
  fieldName?: string;
}

/** Return value of useCompressApi */
export interface CompressApiReturn {
  /** Current status */
  status: CompressStatus;
  /** Whether busy (uploading or processing) */
  isBusy: boolean;
  /** Error message */
  error: string;
  /** Compression stats (populated after success) */
  stats: CompressStats | null;
  /** Blob URL of compressed file (populated after success) — single GLB */
  downloadUrl: string;
  /** Whether the result is a ZIP (multi-model output) */
  isZip: boolean;
  /** Trigger upload + compression with ALL main files + auxiliary files */
  compress: (mainFiles: File[], auxiliaryFiles?: File[]) => Promise<void>;
  /** Reset to idle state and release blob URL */
  reset: () => void;
  /** Trigger browser download */
  download: () => void;
}

// ══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ══════════════════════════════════════════════════════════════════════════════

/** Format bytes to a human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Hook
// ══════════════════════════════════════════════════════════════════════════════

/**
 * React Hook: Encapsulates the multi-file 3D upload  format conversion
 *  GLB compression pipeline.
 *
 * Now supports: compress(mainFile, auxiliaryFiles[]) for multi-file uploads.
 * All files (main + aux) are sent in a single FormData request so the backend
 * can place them all in the same temp directory for proper relative-path resolution.
 *
 * @example
 * ```tsx
 * function MyPage() {
 *   const { status, isBusy, error, stats, downloadUrl, compress, download } = useCompressApi();
 *
 *   async function handleConvert(main: File, aux: File[]) {
 *     await compress(main, aux);
 *     download();
 *   }
 * }
 * ```
 */
export function useCompressApi(options: CompressApiOptions = {}): CompressApiReturn {
  const {
    apiUrl = 'http://localhost:5100/api/compress',
    fieldName = 'files',
  } = options;

  const [status, setStatus] = useState<CompressStatus>('idle');
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [isZip, setIsZip] = useState(false);
  const [stats, setStats] = useState<CompressStats | null>(null);

  const downloadUrlRef = useRef<string>('');

  /** Clean up old blob URL */
  const revoke = useCallback(() => {
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = '';
    }
  }, []);

  /** Reset to initial state */
  const reset = useCallback(() => {
    revoke();
    setStatus('idle');
    setError('');
    setDownloadUrl('');
    setIsZip(false);
    setStats(null);
  }, [revoke]);

  /** Execute upload + compression (multi-file, multi-main) */
  const compress = useCallback(
    async (mainFiles: File[], auxiliaryFiles: File[] = []) => {
      revoke();
      setError('');
      setStats(null);
      setDownloadUrl('');
      setIsZip(false);
      setStatus('uploading');

      const formData = new FormData();

      // Append ALL main files first
      for (const mainFile of mainFiles) {
        formData.append(fieldName, mainFile);
      }

      // Append all auxiliary files
      for (const auxFile of auxiliaryFiles) {
        formData.append(fieldName, auxFile);
      }

      try {
        const response = await fetch(apiUrl, { method: 'POST', body: formData });
        setStatus('processing');

        if (!response.ok) {
          const ct = response.headers.get('content-type') ?? '';
          let msg = 'Compression failed, check backend logs.';
          if (ct.includes('application/json')) {
            const body = (await response.json()) as { error?: string };
            msg = body.error ?? msg;
          } else {
            msg = (await response.text()) || msg;
          }
          throw new Error(msg);
        }

        // Detect ZIP vs single GLB response
        const contentType = response.headers.get('content-type') ?? '';
        const isZipResponse = contentType.includes('application/zip') || contentType.includes('application/x-zip');

        // Extract compression stats (response headers)
        const originalSize = parseInt(response.headers.get('x-original-size') ?? '0', 10);
        const compressedSize = parseInt(response.headers.get('x-compressed-size') ?? '0', 10);
        const ratio = response.headers.get('x-compression-ratio') ?? '';

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        downloadUrlRef.current = url;

        // Parse filename
        const disposition = response.headers.get('content-disposition') ?? '';
        let match = disposition.match(/filename\*=UTF-8''([^;]+)/);
        if (!match) {
          match = disposition.match(/filename[^*;=\n]*=(["']?)([^"';\n]+)\1/);
        }
        const outName = match
          ? decodeURIComponent(match[1] ?? match[2])
          : (isZipResponse ? 'converted_models.zip' : 'compressed.glb');

        setStats({ originalSize, compressedSize, ratio, fileName: outName });
        setDownloadUrl(url);
        setIsZip(isZipResponse);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [apiUrl, fieldName, revoke]
  );

  /** Trigger browser download */
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
    isZip,
    compress,
    reset,
    download,
  };
}
