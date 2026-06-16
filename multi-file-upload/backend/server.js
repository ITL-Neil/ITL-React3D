// server.js — ITL 3D Multi-File Backend API Server
// Supports multi-file uploads (main model + auxiliary files) for 3D format conversion.
// Endpoints: GET /, GET /api/health, POST /api/compress
// Start: node server.js  or  npm start

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import { convertToGlb, convertAllToGlb, isFormatSupported, isGlbFile } from './converter.js';
import { compressGlb } from './compressor.js';
import { classifyUploadedFiles, isModelFormatSupported } from './file-classifier.js';

const PORT = process.env.PORT || 5100;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB total
const MAX_FILE_COUNT = 50; // Max total files per request
const TEMP_DIR_ROOT = path.join(os.tmpdir(), 'glb-compress-api');

const app = express();

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'];

app.use(cors({
  origin: corsOrigin,
  exposedHeaders: ['Content-Disposition', 'X-Original-Size', 'X-Compressed-Size', 'X-Compression-Ratio'],
}));

// Accept any file fields (multi-file), field name is 'files'
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: MAX_FILE_COUNT,
  },
});

app.get('/', (_req, res) => {
  res.json({
    service: 'ITL 3D Multi-File Demo Backend',
    version: '2.0.0',
    runtime: 'Node.js (ESM)',
    endpoints: ['GET /api/health', 'POST /api/compress'],
    features: {
      conversion: 'assimpjs (WebAssembly) — 70+ 3D formats → GLB',
      compression: 'gltf-transform CLI — Draco + WebP',
      multiFile: 'Supports multiple main models + auxiliary files (textures, material, shapefile companions)',
    },
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/api/compress', upload.array('files', MAX_FILE_COUNT), async (req, res) => {
  let workDir = null;
  let outputPath = null;

  try {
    // ── 1. Input Validation ──
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded. Please select at least one model file.' });
    }

    // ── 2. Classify Files ──
    const classification = classifyUploadedFiles(req.files);
    if (classification.status === 'no_main') {
      return res.status(400).json({
        error: 'No recognized 3D model file found in the uploaded files.',
        details: {
          uploadedCount: req.files.length,
          uploadedNames: req.files.map(f => f.originalname),
          warnings: classification.warnings,
        },
      });
    }

    const { mainFiles, auxiliaryFiles, warnings, infos } = classification;

    // Validate all main file formats
    for (const mf of mainFiles) {
      if (!isModelFormatSupported(mf.file.originalname)) {
        return res.status(400).json({ error: `Unsupported file format: ${path.extname(mf.file.originalname)}` });
      }
    }

    // ── 3. Create Per-Request Temp Directory ──
    if (!fs.existsSync(TEMP_DIR_ROOT)) {
      fs.mkdirSync(TEMP_DIR_ROOT, { recursive: true });
    }

    const requestId = crypto.randomUUID().replace(/-/g, '');
    workDir = path.join(TEMP_DIR_ROOT, requestId);
    fs.mkdirSync(workDir, { recursive: true });

    // ── 4. Write ALL Files to Work Directory ──
    // Write all main files (preserve original filenames)
    for (const mf of mainFiles) {
      const fp = path.join(workDir, path.basename(mf.file.originalname));
      fs.writeFileSync(fp, mf.file.buffer);
    }

    // Write auxiliary files (preserve original filenames)
    for (const aux of auxiliaryFiles) {
      const auxPath = path.join(workDir, path.basename(aux.file.originalname));
      fs.writeFileSync(auxPath, aux.file.buffer);
    }

    // Log what we received
    const mainNames = mainFiles.map(m => m.file.originalname).join(', ');
    console.error(`[Server] Request ${requestId}: mains=[${mainNames}], aux=(${auxiliaryFiles.length} files)`);
    if (warnings.length > 0) console.error(`[Server] Warnings:`, warnings);
    if (infos.length > 0) console.error(`[Server] Info:`, infos);

    // ── 5. Convert to GLB ──
    // Strategy: if multiple main files, try batch conversion first
    // (all files → one GLB, for multi-part models sharing auxiliary files).
    // Falls back to individual conversion if batch fails.
    const convertedPaths = [];
    let didBatchConvert = false;

    if (mainFiles.length > 1) {
      const allNeedConvert = mainFiles.every(mf => !isGlbFile(mf.file.originalname));
      if (allNeedConvert) {
        const batchGlbPath = path.join(workDir, 'model_batch.glb');
        console.error(`[Server] Trying batch conversion of ${mainFiles.length} files as single model...`);
        try {
          await convertAllToGlb(workDir, batchGlbPath);
          const firstExt = path.extname(mainFiles[0].file.originalname).toLowerCase();
          const baseName = path.basename(mainFiles[0].file.originalname, firstExt);
          convertedPaths.push({ glbPath: batchGlbPath, baseName });
          didBatchConvert = true;
          console.error(`[Server] Batch conversion OK → single model`);
        } catch (batchErr) {
          console.error(`[Server] Batch conversion failed: ${batchErr.message}, falling back to individual`);
        }
      }
    }

    if (!didBatchConvert) {
      for (const mf of mainFiles) {
        const mainFilePath = path.join(workDir, path.basename(mf.file.originalname));
        const mainExt = path.extname(mf.file.originalname).toLowerCase();
        const originalBaseName = path.basename(mf.file.originalname, mainExt);

        if (isGlbFile(mf.file.originalname)) {
          convertedPaths.push({
            glbPath: mainFilePath,
            baseName: originalBaseName,
          });
        } else {
          const glbPath = path.join(workDir, `${originalBaseName}_converted.glb`);
          console.error(`[Server] Converting: ${mf.file.originalname} → GLB`);
          await convertToGlb(mainFilePath, glbPath);
          console.error(`[Server] Conversion complete: ${mf.file.originalname}`);
          convertedPaths.push({ glbPath, baseName: originalBaseName });
        }
      }
    }

    // ── 6. Compress ALL GLB Files ──
    const compressedPaths = [];
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;

    for (const { glbPath, baseName } of convertedPaths) {
      console.error(`[Server] Compressing: ${glbPath}`);
      const result = await compressGlb(glbPath, workDir, baseName, { enableDraco: false, compressTextureToWebP: false });
      compressedPaths.push({ path: result.outputPath, name: result.outputFileName });
      totalOriginalSize += result.originalSizeBytes;
      totalCompressedSize += result.compressedSizeBytes;
      console.error(`[Server] Compressed: ${result.outputFileName} (${result.compressionRatio}%)`);
    }

    // ── 7. Single GLB or ZIP output ──
    if (compressedPaths.length === 1) {
      // Single model: return the GLB directly
      outputPath = compressedPaths[0].path;
      const compressionRatio = totalOriginalSize > 0
        ? ((totalCompressedSize / totalOriginalSize) * 100).toFixed(1)
        : '100';

      res.setHeader('X-Original-Size', String(totalOriginalSize));
      res.setHeader('X-Compressed-Size', String(totalCompressedSize));
      res.setHeader('X-Compression-Ratio', compressionRatio);
      res.setHeader('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(compressedPaths[0].name)}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(fs.readFileSync(outputPath));
    } else {
      // Multiple models: zip all compressed GLB files
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip();
      for (const cp of compressedPaths) {
        zip.addLocalFile(cp.path, '', cp.name);
      }
      const zipPath = path.join(workDir, 'converted_models.zip');
      zip.writeZip(zipPath);
      outputPath = zipPath;

      const compressionRatio = totalOriginalSize > 0
        ? ((totalCompressedSize / totalOriginalSize) * 100).toFixed(1)
        : '100';

      res.setHeader('X-Original-Size', String(totalOriginalSize));
      res.setHeader('X-Compressed-Size', String(totalCompressedSize));
      res.setHeader('X-Compression-Ratio', compressionRatio);
      res.setHeader('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent('converted_models.zip')}`);
      res.setHeader('Content-Type', 'application/zip');
      res.send(fs.readFileSync(zipPath));
    }

  } catch (err) {
    console.error('[Server] Processing failed:', err);
    const status = /Unsupported|format|upload|file|No file|No recognized/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  } finally {
    // ── 8. Cleanup: Remove entire work directory ──
    if (workDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
        console.error(`[Server] Cleaned up workDir: ${workDir}`);
      } catch (cleanErr) {
        console.error(`[Server] Cleanup warning (non-fatal):`, cleanErr.message);
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`[Server] ITL 3D Multi-File Backend started (ESM)`);
  console.log(`[Server] http://localhost:${PORT}`);
  console.log(`[Server] POST http://localhost:${PORT}/api/compress (multi-file support)`);
});
