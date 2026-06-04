import { ChangeEvent, DragEvent, KeyboardEvent, useMemo, useRef, useState } from 'react';
import './DragUpload.css';

export const defaultAllowedExtensions = [
  'glb',
  'gltf',
  'ply',
  'stl',
  'obj',
  'off',
  'dae',
  'fbx',
  'dxf',
  'ifc',
  'xyz',
  'pcd',
  'las',
  'laz',
  'stp',
  'step',
  '3dxml',
  'iges',
  'igs',
  'shp',
  'geojson',
  'xaml',
  'pts',
  'asc',
  'brep',
  'fcstd',
  'bim',
  'usdz',
  'pdb',
  'vtk',
  'svg',
  'wrl',
  '3dm',
  '3ds',
  'amf',
  '3mf',
  'dwg',
  'json',
  'rfa',
  'rvt',
  'cvs',
  'gpkg',
  'ac',
  'zgl',
  'x',
  'ter',
  'smd',
  'sib',
  'q3o',
  'q3s',
  'ogex',
  'nff',
  'ms3d',
  'mdl',
  'md5mesh',
  'md2',
  'lws',
  'hmp',
  'irrmesh',
  'x3d',
  'vrml',
  'b3dm',
  'xyzrgb',
  'x3dv',
  'vtu',
  'urdf',
  'ugrid',
  'su2',
  'babylon',
  'ac3d',
  'bvh',
  'ase',
  'wkt',
  'facet',
];

export type DragUploadProps = {
  allowedExtensions?: string[];
  onFilesSelected: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  title?: string;
  description?: string;
  className?: string;
};

function DragUpload({
  allowedExtensions = defaultAllowedExtensions,
  onFilesSelected,
  multiple = true,
  disabled = false,
  title = 'Select or drop files',
  description = 'Supported 3D model and geospatial file formats are checked by extension.',
  className = '',
}: DragUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const normalizedExtensions = useMemo(
    () => new Set(allowedExtensions.map(normalizeExtension)),
    [allowedExtensions],
  );

  function openFilePicker() {
    if (!disabled) {
      inputRef.current?.click();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    handleFiles(event.target.files);
    event.target.value = '';
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    if (!disabled) {
      handleFiles(event.dataTransfer.files);
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) {
      return;
    }

    const files = Array.from(fileList);
    const acceptedFiles = files.filter((file) => normalizedExtensions.has(getFileExtension(file.name)));
    const rejectedFiles = files.filter((file) => !normalizedExtensions.has(getFileExtension(file.name)));

    if (rejectedFiles.length > 0) {
      setError(`Unsupported file type: ${rejectedFiles.map((file) => file.name).join(', ')}`);
    } else {
      setError('');
    }

    const outputFiles = multiple ? acceptedFiles : acceptedFiles.slice(0, 1);
    if (outputFiles.length > 0) {
      setSelectedNames(outputFiles.map((file) => file.name));
      onFilesSelected(outputFiles);
    }
  }

  const acceptValue = Array.from(normalizedExtensions)
    .map((extension) => `.${extension}`)
    .join(',');

  return (
    <div className={`drag-upload ${className}`.trim()}>
      <div
        className={`drag-upload__zone ${isDragging ? 'drag-upload__zone--dragging' : ''} ${
          disabled ? 'drag-upload__zone--disabled' : ''
        }`}
        onClick={openFilePicker}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptValue}
          multiple={multiple}
          disabled={disabled}
          onChange={handleFileInput}
        />
        <div className="drag-upload__badge">3D</div>
        <strong>{title}</strong>
        <span>{selectedNames.length > 0 ? selectedNames.join(', ') : description}</span>
      </div>

      {error && <p className="drag-upload__error">{error}</p>}
    </div>
  );
}

function normalizeExtension(extension: string) {
  return extension.replace(/^\./, '').trim().toLowerCase();
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

export default DragUpload;
