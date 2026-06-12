/**
 * decompress_glb.js — 使用 @gltf-transform 解压 Meshopt 压缩的 GLB
 *
 * 关键点：
 * 1. readIO 注册 EXTMeshoptCompression + decoder → 读入时自动解码
 * 2. writeIO 不注册任何扩展 → 写出时不会重新压缩
 *
 * 用法：node decompress_glb.js <input.glb> <output.glb>
 */
import { writeFileSync } from 'fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('用法: node decompress_glb.js <input.glb> <output.glb>');
  process.exit(1);
}

try {
  // Step 1: 等待 WASM 解码器就绪
  await MeshoptDecoder.ready;

  // Step 2: 用带扩展的 IO 读入（自动解码 meshopt 压缩数据）
  const readIO = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

  const doc = await readIO.read(inputPath);

  // Step 3: 用裸 IO 写出（不会重新压缩，因为没注册 meshopt 扩展）
  const writeIO = new NodeIO();
  const glb = await writeIO.writeBinary(doc);

  writeFileSync(outputPath, Buffer.from(glb));
  process.exit(0);
} catch (err) {
  console.error('解压失败:', err.message);
  process.exit(1);
}
