// converter.js — 3D Model Format Conversion
// Uses assimpjs (Emscripten WASM) to convert 70+ 3D formats to GLB.
// Strategy: ConvertFileList → direct GLB export; fallback to glTF → gltf-transform CLI pack
// For .obj files, obj2gltf (native Node.js) is used as a more reliable fallback
//   when assimpjs fails (e.g. large files exceeding WASM memory limits).
// Depends on: assimpjs (npm), gltf-transform CLI, obj2gltf (npm)
//
// NOTE: assimpjs v0.0.10 API = factory() → FileList → ConvertFileList → GetFile().GetContent()
//       NOT the older importFile/exportFile API which does not exist in this version.

import fs from 'fs';
import path from 'path';
import { execFile, spawnSync } from 'child_process';

// Cache for obj2gltf bin path (the .cmd wrapper, not the bash script)
let _obj2gltfBin = null;
function getObj2gltfBin() {
  if (_obj2gltfBin && fs.existsSync(_obj2gltfBin)) return _obj2gltfBin;
  // Local node_modules/.bin/obj2gltf.cmd
  const localCmd = path.join(process.cwd(), 'node_modules', '.bin', 'obj2gltf.cmd');
  if (fs.existsSync(localCmd)) { _obj2gltfBin = localCmd; return localCmd; }
  // Direct bin script (Windows-friendly — invoke via `node`)
  const directBin = path.join(process.cwd(), 'node_modules', 'obj2gltf', 'bin', 'obj2gltf.js');
  if (fs.existsSync(directBin)) { _obj2gltfBin = directBin; return directBin; }
  return null;
}

let _assimp = null;
async function getAssimp() {
  if (!_assimp) {
    const assimpFactory = (await import('assimpjs')).default;
    _assimp = await assimpFactory();
  }
  return _assimp;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.glb', '.gltf', '.ply', '.stl', '.obj', '.off', '.dae', '.fbx',
  '.dxf', '.ifc', '.xyz', '.pcd', '.las', '.laz', '.stp', '.step',
  '.3dxml', '.iges', '.igs', '.shp', '.geojson', '.xaml', '.pts', '.asc',
  '.brep', '.fcstd', '.bim', '.usdz', '.pdb', '.vtk', '.svg', '.wrl',
  '.3dm', '.3ds', '.amf', '.3mf', '.dwg', '.json', '.rfa', '.rvt',
  '.cvs', '.gpkg', '.ac', '.zgl', '.x', '.ter', '.smd', '.sib',
  '.q3o', '.q3s', '.ogex', '.nff', '.ms3d', '.mdl', '.md5mesh', '.md2',
  '.lws', '.hmp', '.irrmesh', '.x3d', '.vrml', '.b3dm', '.xyzrgb', '.x3dv',
  '.vtu', '.urdf', '.ugrid', '.su2', '.babylon', '.ac3d', '.bvh', '.ase',
  '.wkt', '.facet'
]);

export function isFormatSupported(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isGlbFile(filePath) {
  return path.extname(filePath).toLowerCase() === '.glb';
}

/**
 * Convert the main model file (and any companion files in the same directory)
 * to a single GLB file.
 *
 * @param {string} inputPath  - path to the main model file
 * @param {string} outputPath - path where the output .glb should be written
 */
export async function convertToGlb(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) throw new Error(`Input file does not exist: ${inputPath}`);

  const ext = path.extname(inputPath).toLowerCase();
  const inputFileName = path.basename(inputPath);
  if (!isFormatSupported(inputPath)) throw new Error(`Unsupported file format: ${ext}`);

  // ── .obj fast-path: use obj2gltf directly if available ──
  // obj2gltf is a native Node.js tool that handles large OBJ files reliably,
  // unlike assimpjs which runs in WASM and may OOM on 100MB+ models.
  if (ext === '.obj') {
    const obj2gltfBin = getObj2gltfBin();
    if (obj2gltfBin) {
      console.error(`[Converter] Using obj2gltf for OBJ file: ${inputFileName}`);
      try {
        await objToGlbViaObj2gltf(inputPath, outputPath);
        console.error(`[Converter] obj2gltf conversion OK`);
        return;
      } catch (obj2gltfErr) {
        console.error(`[Converter] obj2gltf failed: ${obj2gltfErr.message}, falling back to assimpjs`);
      }
    } else {
      console.error(`[Converter] obj2gltf bin not found, using assimpjs for: ${inputFileName}`);
    }
  }

  const workDir = path.dirname(inputPath);
  const ajs = await getAssimp();

  // Build a FileList with ALL files in the work directory.
  // This lets assimp find companion files (MTL/textures/BIN/etc.) by relative path.
  const fileList = new ajs.FileList();
  const dirEntries = fs.readdirSync(workDir);
  for (const entry of dirEntries) {
    const fullPath = path.join(workDir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      const buffer = fs.readFileSync(fullPath);
      fileList.AddFile(entry, buffer);
    }
  }
  console.error(`[Converter] FileList contains ${dirEntries.length} file(s): ${dirEntries.join(', ')}`);

  // ── Strategy 1: ConvertFileList → GLB directly ──
  try {
    const result = ajs.ConvertFileList(fileList, 'glb2');
    if (result.IsSuccess() && result.FileCount() > 0) {
      const resultFile = result.GetFile(0);
      const content = resultFile.GetContent();
      fs.writeFileSync(outputPath, Buffer.from(content));
      console.error(`[Converter] Direct GLB conversion OK (${content.length} bytes)`);
      return;
    }
    const errMsg = result.IsSuccess() ? 'no output files' : result.GetErrorCode();
    console.error(`[Converter] Direct GLB failed: ${errMsg}, trying glTF fallback...`);
  } catch (err) {
    console.error(`[Converter] Direct GLB threw: ${err.message}, trying glTF fallback...`);
  }

  // ── Strategy 2: ConvertFileList → glTF2 → gltf-transform CLI pack to GLB ──
  try {
    const result = ajs.ConvertFileList(fileList, 'gltf2');
    if (result.IsSuccess() && result.FileCount() > 0) {
      const resultFile = result.GetFile(0);
      const gltfContent = resultFile.GetContent();
      if (gltfContent && gltfContent.length > 0) {
        await gltfBufferToGlbViaCli(gltfContent, outputPath);
        return;
      }
    }
    const errMsg = result.IsSuccess() ? 'no output files' : result.GetErrorCode();
    throw new Error(`glTF fallback also failed: ${errMsg}`);
  } catch (fallbackErr) {
    console.error(`[Converter] glTF fallback failed: ${fallbackErr.message}`);
    // ── Strategy 3 (OBJ only): obj2gltf as final fallback ──
    if (ext === '.obj') {
      const obj2gltfBin = getObj2gltfBin();
      if (obj2gltfBin) {
        console.error(`[Converter] Trying obj2gltf as final fallback for: ${inputFileName}`);
        try {
          await objToGlbViaObj2gltf(inputPath, outputPath);
          console.error(`[Converter] obj2gltf fallback OK`);
          return;
        } catch (objErr) {
          console.error(`[Converter] obj2gltf fallback also failed: ${objErr.message}`);
        }
      }
    }
    throw fallbackErr;
  }
}

// ---- Batch conversion helpers ----

/**
 * Batch-convert ALL model files in a directory to a single GLB.
 *
 * Strategy chain (designed for drone photogrammetry multi-OBJ models):
 *   0. Single OBJ         → obj2gltf (fast, native, no WASM limits)
 *   1. Any format(s)      → assimpjs batch (best scene-assembly for mixed formats)
 *   2. Multiple OBJs only → Python merge_objs.py (OBJ-level index-offset merge
 *      with UV-based texture auto-detection + proper MTL) → obj2gltf
 *      (correct approach for drone photogrammetry tile sets)
 *
 * If the entire strategy chain is exhausted, throws an error so the server
 * can fall back to individual-convert-and-zip as a last resort.
 *
 * @param {string} workDir    - directory containing all main + auxiliary files
 * @param {string} outputPath - path where the output .glb should be written
 */
export async function convertAllToGlb(workDir, outputPath) {
  const dirEntries = fs.readdirSync(workDir);
  const mainObjFiles = dirEntries.filter(e => path.extname(e).toLowerCase() === '.obj');
  const obj2gltfBin = getObj2gltfBin();

  // ── Strategy 0: Single OBJ → obj2gltf fast path ──
  if (mainObjFiles.length === 1 && obj2gltfBin) {
    const objPath = path.join(workDir, mainObjFiles[0]);
    console.error(`[Converter] Batch S0: single-OBJ obj2gltf → ${mainObjFiles[0]}`);
    try {
      await objToGlbViaObj2gltf(objPath, outputPath);
      console.error(`[Converter] Batch S0 OK (obj2gltf)`);
      return;
    } catch (e) {
      console.error(`[Converter] Batch S0 failed: ${e.message}, falling through to S1`);
    }
  }

  // ── Strategy 2 (PRIORITY for multi-OBJ): Python OBJ-level merge → obj2gltf ──
  //    For drone photogrammetry tile sets, merging at the OBJ level is the
  //    ONLY correct approach: it properly offsets vertex/texture/normal indices,
  //    auto-detects texture mapping via UV sampling, and produces a unified MTL.
  //    This must run BEFORE assimpjs (S1) because assimpjs often "succeeds" on
  //    multi-OBJ FileList but produces a fragmented/scattered GLB (resets origins,
  //    drops tiles, or treats files as separate unconnected assets).
  if (mainObjFiles.length > 1 && obj2gltfBin) {
    console.error(`[Converter] Batch S2 (primary): Python OBJ-merge → obj2gltf for ${mainObjFiles.length} OBJ files`);
    try {
      await mergeObjsThenConvert(workDir, outputPath);
      console.error(`[Converter] Batch S2 OK (merge_objs+obj2gltf)`);
      return;
    } catch (e) {
      console.error(`[Converter] Batch S2 failed: ${e.message}, falling back to S1`);
    }
  }

  // ── Strategy 1: assimpjs batch → GLB (fallback for mixed formats or when S2 unavailable) ──
  //    Best for non-OBJ formats, single-model + companion files, or when
  //    obj2gltf/Python is not installed. NOT recommended for multi-OBJ tile sets.
  try {
    await convertAllViaAssimp(workDir, outputPath, dirEntries);
    console.error(`[Converter] Batch S1 OK (assimpjs)`);
    return;
  } catch (e) {
    console.error(`[Converter] Batch S1 failed: ${e.message}`);
  }

  // ── Exhausted ──
  throw new Error(
    `All batch strategies exhausted for ${dirEntries.length} files ` +
    `(${mainObjFiles.length} OBJ). Cannot merge into single GLB.`
  );
}

/**
 * Run Python merge_objs.py to do a proper OBJ-level merge with texture
 * auto-detection, then convert the single merged.obj to GLB with obj2gltf.
 *
 * This is the correct approach for drone photogrammetry tile sets because:
 * 1. OBJ-level merge properly offsets vertex/texture/normal indices
 * 2. UV-sampling auto-detects which texture belongs to which tile
 * 3. Single obj2gltf pass produces a self-consistent GLB with all materials
 */
async function mergeObjsThenConvert(workDir, outputPath) {
  const mergeScript = path.join(process.cwd(), 'merge_objs.py');
  if (!fs.existsSync(mergeScript)) {
    throw new Error(`merge_objs.py not found at ${mergeScript}`);
  }

  // Step 1: Run Python merge script → produces merged.obj + merged.mtl
  console.error(`[Converter] S2a: Running Python merge_objs.py on ${workDir}`);
  await runMergeObjsScript(workDir);

  const mergedObjPath = path.join(workDir, 'merged.obj');
  if (!fs.existsSync(mergedObjPath)) {
    throw new Error('merge_objs.py completed but merged.obj was not generated');
  }
  const mergedSize = fs.statSync(mergedObjPath).size;
  console.error(`[Converter] S2a OK: merged.obj created (${mergedSize} bytes)`);

  // Step 2: Convert merged.obj → GLB via obj2gltf
  console.error(`[Converter] S2b: obj2gltf on merged.obj`);
  await objToGlbViaObj2gltf(mergedObjPath, outputPath);
  console.error(`[Converter] S2b OK: ${fs.statSync(outputPath).size} bytes`);
}

/**
 * Execute merge_objs.py as a subprocess with the given work directory.
 */
function runMergeObjsScript(workDir) {
  const mergeScript = path.join(process.cwd(), 'merge_objs.py');

  // Prefer the managed Python (isolated, with Pillow) over system Python.
  // Fall back through PATH resolution.
  const pythonCandidates = [];
  if (process.platform === 'win32') {
    // Managed Python 3.13.12 (has Pillow)
    pythonCandidates.push(path.join(
      process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Neil.Zhen',
      '.workbuddy', 'binaries', 'python', 'versions', '3.13.12', 'python.exe'
    ));
  }
  pythonCandidates.push(process.platform === 'win32' ? 'python' : 'python3');
  pythonCandidates.push('python3');

  const pythonCmd = pythonCandidates.find(cmd => {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const expanded = cmd.startsWith(home) ? cmd : cmd; // already absolute or plain name
    if (fs.existsSync(expanded)) return true;
    // For plain names (python, python3), test via spawnSync
    if (!cmd.includes('\\') && !cmd.includes('/')) {
      const res = spawnSync(cmd, ['--version'], { shell: true });
      return res.status === 0 && !res.error;
    }
    return false;
  }) || pythonCandidates[pythonCandidates.length - 1];

  const timeout = 600000; // 10 minutes for large models with texture analysis

  console.error(`[Converter] Spawning: ${pythonCmd} ${mergeScript} ${workDir}`);

  return new Promise((resolve, reject) => {
    execFile(pythonCmd, [mergeScript, workDir], { timeout, maxBuffer: 10 * 1024 * 1024, shell: true }, (err, stdout, stderr) => {
      if (stdout) console.error(`[merge_objs.py] ${stdout}`);
      if (stderr) console.error(`[merge_objs.py stderr] ${stderr}`);
      if (err) {
        reject(new Error(`merge_objs.py failed: ${stderr || stdout || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Strategy 1: assimpjs batch conversion (WASM).
 * Loads every file in workDir into a FileList for scene-aware multi-file assembly.
 */
async function convertAllViaAssimp(workDir, outputPath, dirEntries) {
  const ajs = await getAssimp();

  const fileList = new ajs.FileList();
  for (const entry of dirEntries) {
    const fullPath = path.join(workDir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      const buffer = fs.readFileSync(fullPath);
      fileList.AddFile(entry, buffer);
    }
  }
  console.error(`[Converter] Assimp batch FileList: ${dirEntries.join(', ')}`);

  // ── S1a: ConvertFileList → GLB directly ──
  try {
    const result = ajs.ConvertFileList(fileList, 'glb2');
    if (result.IsSuccess() && result.FileCount() > 0) {
      const resultFile = result.GetFile(0);
      const content = resultFile.GetContent();
      fs.writeFileSync(outputPath, Buffer.from(content));
      console.error(`[Converter] Assimp batch direct GLB: ${content.length} bytes`);
      return;
    }
    const errMsg = result.IsSuccess() ? 'no output files' : result.GetErrorCode();
    console.error(`[Converter] Assimp batch direct GLB failed: ${errMsg}`);
  } catch (err) {
    console.error(`[Converter] Assimp batch direct GLB threw: ${err.message}`);
  }

  // ── S1b: ConvertFileList → glTF2 → gltf-transform pack ──
  const result = ajs.ConvertFileList(fileList, 'gltf2');
  if (result.IsSuccess() && result.FileCount() > 0) {
    const resultFile = result.GetFile(0);
    const gltfContent = resultFile.GetContent();
    if (gltfContent && gltfContent.length > 0) {
      await gltfBufferToGlbViaCli(gltfContent, outputPath);
      return;
    }
  }
  const errMsg = result.IsSuccess() ? 'no output files' : result.GetErrorCode();
  throw new Error(`Assimp batch glTF fallback failed: ${errMsg}`);
}

// ---- Internal helpers ----

async function objToGlbViaObj2gltf(inputPath, outputPath) {
  const obj2gltfBin = getObj2gltfBin();
  if (!obj2gltfBin) throw new Error('obj2gltf binary not found');

  // obj2gltf uses stdout via `node bin/obj2gltf.js`, which is the Windows-safe path
  const isDirectJs = obj2gltfBin.endsWith('.js');
  const args = isDirectJs
    ? [obj2gltfBin, '-i', inputPath, '-o', outputPath, '-b']
    : ['-i', inputPath, '-o', outputPath, '-b'];

  const cmd = isDirectJs ? process.execPath : obj2gltfBin;
  const timeout = 600000; // 10 min for large files

  console.error(`[Converter] Running obj2gltf: ${cmd} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 50 * 1024 * 1024, shell: true }, (err, stdout, stderr) => {
      if (stderr) console.error(`[Converter] obj2gltf stderr: ${stderr}`);
      if (stdout) console.error(`[Converter] obj2gltf stdout: ${stdout}`);
      if (err) {
        reject(new Error(`obj2gltf failed: ${stderr || stdout || err.message}`));
      } else if (!fs.existsSync(outputPath)) {
        reject(new Error('obj2gltf completed but no output file was generated'));
      } else {
        const size = fs.statSync(outputPath).size;
        console.error(`[Converter] obj2gltf produced ${size} bytes`);
        resolve();
      }
    });
  });
}

async function gltfBufferToGlbViaCli(gltfBuffer, outputPath) {
  const tmpDir = path.dirname(outputPath);
  const tmpGltfPath = path.join(tmpDir, `_conv_${Date.now()}.gltf`);
  try {
    fs.writeFileSync(tmpGltfPath, Buffer.from(gltfBuffer));
    await runGltfTransform(['copy', tmpGltfPath, outputPath], 120000);
    console.error(`[Converter] glTF→GLB pack OK`);
  } finally {
    try { fs.unlinkSync(tmpGltfPath); } catch {}
  }
}

function runGltfTransform(args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const cmd = getGltfCmd();
    console.error(`[Converter] Running: ${cmd} ${args.join(' ')}`);
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024, shell: true }, (err, stdout, stderr) => {
      if (stderr) console.error(`[Converter] stderr: ${stderr}`);
      if (stdout) console.error(`[Converter] stdout: ${stdout}`);
      if (err) {
        reject(new Error(`gltf-transform failed: ${stderr || stdout || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function getGltfCmd() {
  // 1. Windows: globally npm-installed .cmd
  const localAppData = process.env.LOCALAPPDATA || '';
  const cmdPath = path.join(localAppData, 'npm', 'gltf-transform.cmd');
  if (fs.existsSync(cmdPath)) return cmdPath;

  // 2. Local node_modules/.bin (Linux/macOS)
  const localBin = path.join(process.cwd(), 'node_modules', '.bin', 'gltf-transform');
  if (fs.existsSync(localBin)) return localBin;

  // 3. Fallback: system PATH
  return 'gltf-transform';
}
