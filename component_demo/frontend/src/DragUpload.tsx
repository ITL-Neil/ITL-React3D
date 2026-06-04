import { ChangeEvent, DragEvent, KeyboardEvent, useRef, useState } from 'react';
import './DragUpload.css';

export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
  'glb', 'gltf', 'ply', 'stl', 'obj', 'off', 'dae', 'fbx', 'dxf', 'ifc',
  'xyz', 'pcd', 'las', 'laz', 'stp', 'step', '3dxml', 'iges', 'igs', 'shp',
  'geojson', 'xaml', 'pts', 'asc', 'brep', 'fcstd', 'bim', 'usdz', 'pdb',
  'vtk', 'svg', 'wrl', '3dm', '3ds', 'amf', '3mf', 'dwg', 'json', 'rfa',
  'rvt', 'cvs', 'gpkg', 'ac', 'zgl', 'x', 'ter', 'smd', 'sib', 'q3o',
  'q3s', 'ogex', 'nff', 'ms3d', 'mdl', 'md5mesh', 'md2', 'lws', 'hmp',
  'irrmesh', 'x3d', 'vrml', 'b3dm', 'xyzrgb', 'x3dv', 'vtu', 'urdf',
  'ugrid', 'su2', 'babylon', 'ac3d', 'bvh', 'ase', 'wkt', 'facet',
];

export interface DragUploadProps {
  allowedExtensions?: readonly string[];
  onFilesSelected: (files: File[]) => void;
  multiple?: boolean;
  hint?: string;
  subHint?: string;
  disabled?: boolean;
}

export default function DragUpload({
  allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS,
  onFilesSelected,
  multiple = true,
  hint = '选择或拖拽文件上传',
  subHint,
  disabled = false,
}: DragUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rejectedFiles, setRejectedFiles] = useState<string[]>([]);

  function getExt(filename: string): string {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex === -1) return '';
    return filename.slice(dotIndex + 1).toLowerCase();
  }

  function validate(files: FileList | File[]): { accepted: File[]; rejected: string[] } {
    const fileArray = Array.from(files);
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of fileArray) {
      const ext = getExt(file.name);
      if (allowedExtensions.includes(ext)) {
        accepted.push(file);
      } else {
        rejected.push(file.name);
      }
    }
    return { accepted, rejected };
  }

  function processFiles(files: FileList | File[]) {
    const { accepted, rejected } = validate(files);
    setRejectedFiles(rejected);
    if (accepted.length > 0) {
      onFilesSelected(multiple ? accepted : [accepted[0]]);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) setIsDragging(true);
  }

  function handleDragLeave() { setIsDragging(false); }

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

  function handleClick() { if (!disabled) inputRef.current?.click(); }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!disabled && (event.key === 'Enter' || event.key === ' ')) inputRef.current?.click();
  }

  const accept = allowedExtensions.map((ext) => `.${ext}`).join(',');

  return (
    <div className="drag-upload-wrapper">
      <div
        className={[
          'drag-upload-dropzone',
          isDragging ? 'drag-upload-dropzone--dragging' : '',
          disabled ? 'drag-upload-dropzone--disabled' : '',
        ].filter(Boolean).join(' ')}
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
          multiple={multiple}
          onChange={handleChange}
          style={{ display: 'none' }}
          tabIndex={-1}
        />
        <div className="drag-upload-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" width="40" height="40">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.632-8.683 3 3 0 0 1 4.24-3.995A4.502 4.502 0 0 1 16.5 9a3.5 3.5 0 0 1 3.488 3.836 3.5 3.5 0 0 1-2.738 3.157" />
          </svg>
        </div>
        <strong className="drag-upload-hint">{hint}</strong>
        {subHint && <span className="drag-upload-sub-hint">{subHint}</span>}
        <span className="drag-upload-ext-hint">
          支持 {allowedExtensions.length} 种格式 · 以列表中的扩展名为准
        </span>
      </div>

      {rejectedFiles.length > 0 && (
        <div className="drag-upload-error" role="alert">
          <strong>以下文件格式不受支持，已拒绝：</strong>
          <ul>
            {rejectedFiles.map((name) => <li key={name}>{name}</li>)}
          </ul>
          <button type="button" className="drag-upload-error-dismiss"
            onClick={() => setRejectedFiles([])}>
            知道了
          </button>
        </div>
      )}
    </div>
  );
}
