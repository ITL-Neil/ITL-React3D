// FileClassifier.ts — Main file identification & auxiliary file classification
// Shared logic for frontend DragUpload validation and backend processing.

// ══════════════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════════════

/** All 3D model main-file extensions (ordered by priority — higher index = higher priority) */
const MAIN_EXTENSIONS: readonly string[] = [
  'obj', 'gltf', 'shp', 'fbx', 'dae', '3ds', 'ply', 'stl',
  'glb', 'off', 'dxf', 'ifc', 'xyz', 'pcd', 'las', 'laz',
  'stp', 'step', '3dxml', 'iges', 'igs', 'geojson', 'xaml',
  'pts', 'asc', 'brep', 'fcstd', 'bim', 'usdz', 'pdb', 'vtk',
  'svg', 'wrl', '3dm', 'amf', '3mf', 'dwg', 'json', 'rfa',
  'rvt', 'cvs', 'gpkg', 'ac', 'zgl', 'x', 'ter', 'smd',
  'sib', 'q3o', 'q3s', 'ogex', 'nff', 'ms3d', 'mdl', 'md5mesh',
  'md2', 'lws', 'hmp', 'irrmesh', 'x3d', 'vrml', 'b3dm', 'xyzrgb',
  'x3dv', 'vtu', 'urdf', 'ugrid', 'su2', 'babylon', 'ac3d',
  'bvh', 'ase', 'wkt', 'facet',
];

/** Auxiliary file extensions recognized by the system */
const AUX_EXTENSIONS: readonly string[] = [
  'mtl',          // OBJ material library
  'bin',          // glTF binary buffer
  'shx', 'dbf', 'prj', 'cpg', 'sbn', 'sbx', 'qix', 'lyr', // Shapefile companions
  'xml', 'kml',   // Metadata / spatial
  'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga', 'tif', 'tiff', // Textures
  'hdr', 'exr',   // HDR environment / textures
];

/** Shapefile-mandatory companion extensions (without these, the shapefile is likely broken) */
const SHP_MANDATORY: readonly string[] = ['shx', 'dbf'];
const SHP_RECOMMENDED: readonly string[] = ['prj', 'cpg'];

export interface ClassifiedFile {
  file: File;
  ext: string;
  category: 'main' | 'auxiliary' | 'unknown';
}

export interface ClassificationResult {
  /** All files, tagged with category */
  classified: ClassifiedFile[];
  /** ALL identified main model files (multiple supported, e.g. 8 OBJ parts) */
  mainFiles: ClassifiedFile[];
  /** @deprecated First main file for backward compat */
  mainFile: ClassifiedFile | null;
  /** Files recognized as auxiliary (textures, MTL, BIN, etc.) */
  auxiliaryFiles: ClassifiedFile[];
  /** Files that don't match any known extension */
  unknownFiles: ClassifiedFile[];
  /** Human-readable warnings */
  warnings: string[];
  /** Human-readable info messages */
  infos: string[];
  /** Primary detection status */
  status: 'ok' | 'multiple_mains' | 'no_main' | 'no_files';
}

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

export function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

function getBaseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return filename;
  return filename.slice(0, dot);
}

function priority(ext: string): number {
  // Higher-priority formats appear earlier in the MAIN_EXTENSIONS list
  // We give glb first priority since it's the target format
  const idx = MAIN_EXTENSIONS.indexOf(ext.toLowerCase());
  return idx === -1 ? -1 : MAIN_EXTENSIONS.length - idx;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Classification Function
// ══════════════════════════════════════════════════════════════════════════════

export function classifyFiles(files: File[]): ClassificationResult {
  if (files.length === 0) {
    return {
      classified: [],
      mainFiles: [],
      mainFile: null,
      auxiliaryFiles: [],
      unknownFiles: [],
      warnings: [],
      infos: [],
      status: 'no_files',
    };
  }

  // Phase 1: Tag each file
  const classified: ClassifiedFile[] = files.map((file) => {
    const ext = getExt(file.name);
    let category: ClassifiedFile['category'] = 'unknown';
    if (MAIN_EXTENSIONS.includes(ext)) {
      category = 'main';
    } else if (AUX_EXTENSIONS.includes(ext)) {
      category = 'auxiliary';
    }
    return { file, ext, category };
  });

  // Phase 2: Identify main file
  const mainCandidates = classified.filter((c) => c.category === 'main');
  const auxiliaryFiles = classified.filter((c) => c.category === 'auxiliary');
  const unknownFiles = classified.filter((c) => c.category === 'unknown');

  const warnings: string[] = [];
  const infos: string[] = [];

  let mainFiles: ClassifiedFile[] = [];
  let status: ClassificationResult['status'] = 'ok';

  if (mainCandidates.length === 0) {
    status = 'no_main';
    warnings.push('No recognized 3D model file found. Please include at least one model file (OBJ, FBX, GLTF, etc.).');
  } else if (mainCandidates.length === 1) {
    mainFiles = mainCandidates;
    status = 'ok';
  } else {
    // Multiple main files: keep ALL — they may be parts of one model
    mainCandidates.sort((a, b) => priority(b.ext) - priority(a.ext));
    mainFiles = mainCandidates;
    status = 'multiple_mains';
    infos.push(
      `Detected ${mainFiles.length} model files. ` +
      `All will be converted together. Shared auxiliary files (textures, materials) are listed below.`
    );
  }

  // Phase 3: Check auxiliary file completeness (for each main file type)
  if (mainFiles.length > 0) {
    const auxExts = new Set(auxiliaryFiles.map((a) => a.ext));
    const mainExts = new Set(mainFiles.map((m) => m.ext));

    // ----- .obj -----
    if (mainExts.has('obj')) {
      if (!auxExts.has('mtl')) {
        warnings.push('Missing .mtl file — the model may lose material definitions.');
      }
      const hasTextures = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga'].some((t) => auxExts.has(t));
      if (!hasTextures) {
        infos.push('No texture files detected. The model may appear without textures.');
      }
    }

    // ----- .gltf -----
    if (mainExts.has('gltf')) {
      if (!auxExts.has('bin')) {
        warnings.push('Missing .bin file — the glTF model may be incomplete without its binary buffer.');
      }
      const hasTextures = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga'].some((t) => auxExts.has(t));
      if (!hasTextures) {
        infos.push('No texture files detected. The model may appear without textures.');
      }
    }

    // ----- .shp -----
    if (mainExts.has('shp')) {
      const missingMandatory = SHP_MANDATORY.filter((e) => !auxExts.has(e));
      if (missingMandatory.length > 0) {
        warnings.push(
          `Critical shapefile companions missing: ${missingMandatory.map((e) => `.${e}`).join(', ')}. ` +
          'Conversion may fail or produce incomplete results.'
        );
      }
      const missingRecommended = SHP_RECOMMENDED.filter((e) => !auxExts.has(e));
      if (missingRecommended.length > 0) {
        infos.push(
          `Recommended shapefile companions missing: ${missingRecommended.map((e) => `.${e}`).join(', ')}.`
        );
      }
    }

    // ----- Other model formats (.fbx / .dae / .3ds / .ply / .stl / etc.) -----
    const otherFormats = ['fbx', 'dae', '3ds', 'ply', 'stl'];
    if (otherFormats.some((f) => mainExts.has(f)) && !['obj', 'gltf', 'shp'].some((f) => mainExts.has(f))) {
      const hasTextures = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga'].some((t) => auxExts.has(t));
      if (!hasTextures) {
        infos.push('No texture files detected. If the model references external textures, they may be missing.');
      }
    }
  }

  // Phase 4: Flag unused (unknown) files
  if (unknownFiles.length > 0) {
    infos.push(
      `The following files are unrecognized and will be ignored: ${unknownFiles.map((u) => u.file.name).join(', ')}`
    );
  }

  return {
    classified,
    mainFiles,
    mainFile: mainFiles[0] ?? null,
    auxiliaryFiles,
    unknownFiles,
    warnings,
    infos,
    status,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Export the allowed extension sets (for DragUpload accept attribute)
// ══════════════════════════════════════════════════════════════════════════════

/** All extensions that should be accepted in the file picker (main + aux) */
export const ALL_ALLOWED_EXTENSIONS: readonly string[] = [
  ...MAIN_EXTENSIONS,
  ...AUX_EXTENSIONS,
];

/** Main model extensions only */
export const MAIN_MODEL_EXTENSIONS = MAIN_EXTENSIONS;

/** Auxiliary file extensions only */
export const AUX_FILE_EXTENSIONS = AUX_EXTENSIONS;
