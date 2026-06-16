// compressor.js — GLB File Compression
// Calls gltf-transform CLI for Draco + WebP post-processing of GLB files.
// Depends on: gltf-transform installed globally (npm install -g @gltf-transform/cli)

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';

const GLB_MAGIC = Buffer.from([0x67, 0x6C, 0x54, 0x46]);

export async function compressGlb(inputPath, outputDir, outputBaseName, options = {}) {
  const { enableDraco = false, compressTextureToWebP = false, timeout = 600000 } = options;

  validateInputFile(inputPath);

  const stat = fs.statSync(inputPath);
  const originalSize = stat.size;

  const outDir = outputDir || path.dirname(inputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const baseName = outputBaseName || path.basename(inputPath, '.glb');
  const id = crypto.randomUUID().replace(/-/g, '');
  const outputFileName = `${baseName}_${id}.glb`;
  const outputPath = path.join(outDir, outputFileName);

  // gltf-transform optimize runs textureCompress by default, which enforces a
  // pixel limit. Large textures (e.g. 8K+, or multi-layer PSD-origin JPGs) can
  // exceed this limit and cause the entire optimize pipeline to fail.
  // --no-limit-input-pixels lifts this restriction globally so large-texture
  // models can still benefit from dedup/weld/simplify/resample/prune etc.
  const args = ['optimize', inputPath, outputPath, '--no-limit-input-pixels'];
  if (enableDraco) args.push('--compress', 'draco');
  if (compressTextureToWebP) {
    args.push('--texture-compress', 'webp');
  }

  console.error(`[Compressor] Running: gltf-transform ${args.join(' ')}`);

  await runGltfTransform(args, timeout);

  if (!fs.existsSync(outputPath)) throw new Error('Compression command succeeded but no output file was generated.');

  const compressedSize = fs.statSync(outputPath).size;
  const compressionRatio = originalSize > 0
    ? Math.round((compressedSize / originalSize) * 1000) / 10 : 0;

  return { outputPath, outputFileName, originalSizeBytes: originalSize, compressedSizeBytes: compressedSize, compressionRatio };
}

// ---- Internal helpers ----

function validateInputFile(inputPath) {
  if (!inputPath) throw new Error('Input file path cannot be empty.');
  if (!fs.existsSync(inputPath)) throw new Error(`Input file does not exist: ${inputPath}`);
  if (path.extname(inputPath).toLowerCase() !== '.glb') {
    throw new Error(`Input file must be GLB format (.glb), got: ${path.extname(inputPath)}`);
  }
  const fd = fs.openSync(inputPath, 'r');
  const header = Buffer.alloc(4);
  fs.readSync(fd, header, 0, 4, 0);
  fs.closeSync(fd);
  if (!header.equals(GLB_MAGIC)) throw new Error('File header magic mismatch — not a valid GLB file.');
}

function runGltfTransform(args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const cmd = getGltfCmd();
    console.error(`[Compressor] Using command: ${cmd}`);
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024, shell: true }, (err, stdout, stderr) => {
      if (stderr) console.error(`[Compressor] stderr: ${stderr}`);
      if (stdout) console.error(`[Compressor] stdout: ${stdout}`);
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

  // 2. Local node_modules/.bin (Linux/macOS/Render)
  const localBin = path.join(process.cwd(), 'node_modules', '.bin', 'gltf-transform');
  if (fs.existsSync(localBin)) return localBin;

  // 3. Fallback: system PATH
  return 'gltf-transform';
}
