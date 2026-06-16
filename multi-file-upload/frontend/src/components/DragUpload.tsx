import {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  useRef,
  useState,
} from 'react';
import { classifyFiles, ALL_ALLOWED_EXTENSIONS, getExt } from './FileClassifier';
import './DragUpload.css';

// ══════════════════════════════════════════════════════════════════════════════
// Props
// ══════════════════════════════════════════════════════════════════════════════
export interface DragUploadProps {
  /**
   * Allowed file extensions (lowercase, without dot).
   * Defaults to ALL_ALLOWED_EXTENSIONS (main model + auxiliary formats).
   */
  allowedExtensions?: readonly string[];

  /**
   * Callback after files are selected (passes ALL files for classification upstream).
   */
  onFilesSelected: (files: File[]) => void;

  /**
   * Drop zone placeholder hint text (main line).
   */
  hint?: string;

  /**
   * Drop zone subtitle hint text.
   */
  subHint?: string;

  /**
   * Disable the component (non-interactive when true).
   */
  disabled?: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════════════════════════════
export default function DragUpload({
  allowedExtensions = ALL_ALLOWED_EXTENSIONS,
  onFilesSelected,
  hint = 'Choose or drag files here',
  subHint = 'Upload main model + auxiliary files (textures, materials) together',
  disabled = false,
}: DragUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rejectedFiles, setRejectedFiles] = useState<string[]>([]);

  // ── Validate: only reject files that match NEITHER main nor auxiliary extensions ──
  function validate(files: FileList | File[]): { accepted: File[]; rejected: string[] } {
    const fileArray = Array.from(files);
    const accepted: File[] = [];
    const rejected: string[] = [];

    for (const file of fileArray) {
      const ext = getExt(file.name);
      if (ext === '' || allowedExtensions.includes(ext)) {
        accepted.push(file);
      } else {
        rejected.push(file.name);
      }
    }

    return { accepted, rejected };
  }

  // ── Process results (pass everything to parent for classification) ──
  function processFiles(files: FileList | File[]) {
    const { accepted, rejected } = validate(files);

    setRejectedFiles(rejected);

    if (accepted.length > 0) {
      onFilesSelected(accepted);
    }
  }

  // ── Event handlers ──
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const files = event.dataTransfer.files;
    if (files && files.length > 0) processFiles(files);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files && files.length > 0) processFiles(files);
    event.target.value = '';
  }

  function handleClick() {
    if (!disabled) inputRef.current?.click();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
      inputRef.current?.click();
    }
  }

  const accept = allowedExtensions.map((ext) => `.${ext}`).join(',');

  return (
    <div className="drag-upload-wrapper">
      <div
        className={[
          'drag-upload-dropzone',
          isDragging ? 'drag-upload-dropzone--dragging' : '',
          disabled ? 'drag-upload-dropzone--disabled' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          onChange={handleChange}
          style={{ display: 'none' }}
          tabIndex={-1}
        />

        <div className="drag-upload-icon" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            width="40"
            height="40"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.632-8.683 3 3 0 0 1 4.24-3.995A4.502 4.502 0 0 1 16.5 9a3.5 3.5 0 0 1 3.488 3.836 3.5 3.5 0 0 1-2.738 3.157"
            />
          </svg>
        </div>

        <strong className="drag-upload-hint">{hint}</strong>

        {subHint && (
          <span className="drag-upload-sub-hint">{subHint}</span>
        )}

        <span className="drag-upload-ext-hint">
          Supports {allowedExtensions.length}+ formats &middot; Multi-file upload enabled
        </span>
      </div>

      {rejectedFiles.length > 0 && (
        <div className="drag-upload-error" role="alert">
          <strong>The following files are not supported and were rejected:</strong>
          <ul>
            {rejectedFiles.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <button
            type="button"
            className="drag-upload-error-dismiss"
            onClick={() => setRejectedFiles([])}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
