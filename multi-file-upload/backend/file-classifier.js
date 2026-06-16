// file-classifier.js — Server-side file classification for multi-file uploads
// Identifies the main model file and validates auxiliary file completeness.

import path from 'path';

// ══════════════════════════════════════════════════════════════════════════════
// Extension sets
// ══════════════════════════════════════════════════════════════════════════════

const MAIN_EXTENSIONS = new Set([
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
]);

const AUX_EXTENSIONS = new Set([
  'mtl', 'bin', 'shx', 'dbf', 'prj', 'cpg', 'sbn', 'sbx', 'qix', 'lyr',
  'xml', 'kml', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga', 'tif', 'tiff',
  'hdr', 'exr',
]);

// Priority: higher number = pick this one first when multiple mains exist
const MAIN_PRIORITY = {
  obj: 100, gltf: 99, shp: 98, fbx: 97, dae: 96, '3ds': 95,
  ply: 94, stl: 93, glb: 200,  // GLB already handled before conversion
};

function getPriority(ext) {
  return MAIN_PRIORITY[ext.toLowerCase()] ?? 50;
}

// Shapefile companions
const SHP_MANDATORY = ['shx', 'dbf'];
const SHP_RECOMMENDED = ['prj', 'cpg'];

// ══════════════════════════════════════════════════════════════════════════════
// Classification
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Given an array of { originalname, filename } objects (from multer),
 * classify them and return ALL main files + validation messages.
 */
export function classifyUploadedFiles(uploadedFiles) {
  if (!uploadedFiles || uploadedFiles.length === 0) {
    return { mainFiles: [], auxiliaryFiles: [], warnings: [], infos: [], status: 'no_files' };
  }

  const mainFiles = [];
  const auxiliaryFiles = [];
  const unknownFiles = [];
  const warnings = [];
  const infos = [];

  for (const f of uploadedFiles) {
    const ext = path.extname(f.originalname).toLowerCase().replace('.', '');
    if (MAIN_EXTENSIONS.has(ext)) {
      mainFiles.push({ file: f, ext });
    } else if (AUX_EXTENSIONS.has(ext)) {
      auxiliaryFiles.push({ file: f, ext });
    } else {
      unknownFiles.push({ file: f, ext });
    }
  }

  let status = 'ok';

  if (mainFiles.length === 0) {
    status = 'no_main';
    return { mainFiles: [], auxiliaryFiles, warnings: ['No recognized 3D model file found.'], infos, status };
  }

  // Sort main files by priority (for consistent ordering)
  mainFiles.sort((a, b) => getPriority(b.ext) - getPriority(a.ext));

  if (mainFiles.length > 1) {
    status = 'multiple_mains';
    infos.push(
      `Detected ${mainFiles.length} model files. All will be converted together.`
    );
  }

  // Auxiliary file completeness checks (check against all main file types)
  const auxExts = new Set(auxiliaryFiles.map(a => a.ext));
  const mainExts = new Set(mainFiles.map(m => m.ext));

  if (mainExts.has('obj')) {
    if (!auxExts.has('mtl')) {
      warnings.push('Missing .mtl file — model may lose material definitions.');
    }
    const hasTextures = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga'].some(t => auxExts.has(t));
    if (!hasTextures) {
      infos.push('No texture files detected.');
    }
  }

  if (mainExts.has('gltf')) {
    if (!auxExts.has('bin')) {
      warnings.push('Missing .bin file — glTF model may be incomplete.');
    }
    const hasTextures = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga'].some(t => auxExts.has(t));
    if (!hasTextures) {
      infos.push('No texture files detected.');
    }
  }

  if (mainExts.has('shp')) {
    const missingMandatory = SHP_MANDATORY.filter(e => !auxExts.has(e));
    if (missingMandatory.length > 0) {
      warnings.push(
        `Critical shapefile companions missing: ${missingMandatory.map(e => `.${e}`).join(', ')}. ` +
        'Conversion may fail.'
      );
    }
    const missingRecommended = SHP_RECOMMENDED.filter(e => !auxExts.has(e));
    if (missingRecommended.length > 0) {
      infos.push(`Recommended companions missing: ${missingRecommended.map(e => `.${e}`).join(', ')}.`);
    }
  }

  const genericFormats = ['fbx', 'dae', '3ds', 'ply', 'stl'];
  if (genericFormats.some(f => mainExts.has(f))) {
    const hasTextures = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga'].some(t => auxExts.has(t));
    if (!hasTextures) {
      infos.push('No texture files detected. If the model references external textures, they may be missing.');
    }
  }

  if (unknownFiles.length > 0) {
    infos.push(`Unrecognized files (will be placed in work directory): ${unknownFiles.map(u => u.file.originalname).join(', ')}`);
  }

  return { mainFiles, auxiliaryFiles, warnings, infos, status };
}

/**
 * Check if a filename has a supported model extension.
 */
export function isModelFormatSupported(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return MAIN_EXTENSIONS.has(ext);
}
