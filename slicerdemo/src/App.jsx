import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
// BVH 空间加速：让射线检测从 O(N) 降到 O(log N)
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import ModelViewer from './ModelViewer.jsx';
import './App.css';

// 【必须】替换 Three.js 原生 raycast 为 BVH 加速版
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/* ── GLTF/GLB 加载器 ── */
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

/* ── 格式化体积 ── */
function formatVolume(v) {
  if (v < 1e-6) return `${(v * 1e9).toFixed(2)} mm³`;
  if (v < 1e-3) return `${(v * 1e6).toFixed(2)} cm³`;
  if (v < 1) return `${(v * 1e3).toFixed(2)} L`;
  return `${v.toFixed(4)} m³`;
}

/* ── 颜色方案 ── */
function sliceColorHex(index, total) {
  const hue = (index / total) * 360;
  const l = 0.52, s = 0.75;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/* ── 计算场景包围盒 ── */
function getSceneBounds(scene) {
  const box = new THREE.Box3();
  scene.updateWorldMatrix(true, true);
  scene.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geo = node.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const nodeBox = geo.boundingBox.clone();
    nodeBox.applyMatrix4(node.matrixWorld);
    box.expandByPoint(nodeBox.min);
    box.expandByPoint(nodeBox.max);
  });
  return box.isEmpty() ? null : box;
}

/* ═══════════════════════════════════════════
   自动对齐：PCA → quaternion 直接旋转 → 底面贴 y=0
═══════════════════════════════════════════ */

function alignModelToGround(scene) {
  scene.updateWorldMatrix(true, true);

  const meshList = [];
  scene.traverse((n) => { if (n.isMesh && n.geometry) meshList.push(n); });
  if (meshList.length === 0) return null;

  // ── 收集世界坐标采样顶点 ──
  const pts = [];
  const v = new THREE.Vector3();
  for (const m of meshList) {
    const pos = m.geometry.attributes.position;
    if (!pos) continue;
    const step = Math.max(1, Math.floor(pos.count / 8000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      v.applyMatrix4(m.matrixWorld);
      pts.push(v.x, v.y, v.z);
    }
  }

  const n = pts.length / 3;
  if (n < 50) return null;

  // ── 质心 ──
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < pts.length; i += 3) { cx += pts[i]; cy += pts[i + 1]; cz += pts[i + 2]; }
  cx /= n; cy /= n; cz /= n;

  // ── 协方差矩阵 ──
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const dx = pts[i] - cx, dy = pts[i + 1] - cy, dz = pts[i + 2] - cz;
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }
  cxx /= n; cxy /= n; cxz /= n; cyy /= n; cyz /= n; czz /= n;

  // ── 幂迭代 ──
  const powerIter = (start) => {
    let vv = start.clone();
    for (let k = 0; k < 15; k++) {
      vv.copy(new THREE.Vector3(
        cxx * vv.x + cxy * vv.y + cxz * vv.z,
        cxy * vv.x + cyy * vv.y + cyz * vv.z,
        cxz * vv.x + cyz * vv.y + czz * vv.z
      )).normalize();
    }
    return vv;
  };
  const ev1 = powerIter(new THREE.Vector3(1, 0, 0));
  const s2 = new THREE.Vector3(0, 1, 0).sub(ev1.clone().multiplyScalar(ev1.dot(new THREE.Vector3(0, 1, 0)))).normalize();
  const ev2 = powerIter(s2.length() > 0.1 ? s2 : new THREE.Vector3(0, 0, 1));
  const ev3 = new THREE.Vector3().crossVectors(ev1, ev2).normalize();

  const ray = (vv) => { const x = vv.x, y = vv.y, z = vv.z; return cxx * x * x + cyy * y * y + czz * z * z + 2 * (cxy * x * y + cxz * x * z + cyz * y * z); };
  const pairs = [{ v: ev1 }, { v: ev2 }, { v: ev3 }];
  pairs.forEach(p => { p.val = ray(p.v); });
  pairs.sort((a, b) => a.val - b.val);

  // pairs[0] = 最小方差方向 ≈ 底面法线（煤堆是扁平形状，最短轴垂直于底面）
  const bottomNormal = pairs[0].v.clone();

  // ── 旋转：底面法线 → 世界 Y 轴（用 quaternion 直接设置，避免 applyMatrix4 分解副作用）──
  const worldUp = new THREE.Vector3(0, 1, 0);
  const target = bottomNormal.dot(worldUp) > 0 ? worldUp : new THREE.Vector3(0, -1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(bottomNormal, target);

  // 直接设置 scene 四元数（不经过 applyMatrix4 分解循环）
  scene.quaternion.copy(quat);
  scene.updateMatrix();
  scene.updateWorldMatrix(true, true);

  // ── 平移：直接采样顶点世界坐标找最低 Y（不依赖 bounding box）──
  let minY = Infinity;
  let maxY = -Infinity;
  {
    const vv = new THREE.Vector3();
    for (const m of meshList) {
      const pos = m.geometry.attributes.position;
      if (!pos) continue;
      // 采样（大模型跳过大部分顶点）
      const step = Math.max(1, Math.floor(pos.count / 10000));
      for (let i = 0; i < pos.count; i += step) {
        vv.fromBufferAttribute(pos, i);
        vv.applyMatrix4(m.matrixWorld);
        if (vv.y < minY) minY = vv.y;
        if (vv.y > maxY) maxY = vv.y;
      }
    }
  }
  if (!isFinite(minY)) return null;

  scene.position.y -= minY;
  scene.updateMatrix();
  scene.updateWorldMatrix(true, true);

  const h = maxY - minY;
  console.log(`[Align] quat ${quat.x.toFixed(3)},${quat.y.toFixed(3)},${quat.z.toFixed(3)},${quat.w.toFixed(3)}  |  minY=${minY.toFixed(4)} → shifted by ${(-minY).toFixed(4)}  |  height=${h.toFixed(2)}`);

  return true;
}

/* ═══════════════════════════════════════════
   纯CPU高精度等体积切片器（BVH加速 + 射线列求交）
   R：体素分辨率（推荐 64~128，纯CPU下256可能较慢）
═══════════════════════════════════════════ */

function cpuExactEqualSlices(scene, N, R = 96) {
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return null;

  const size = new THREE.Vector3();
  box.getSize(size);
  const voxelSize = Math.max(size.x, size.y, size.z) / R;

  // 实际各轴体素数（保持体素为正方体，确保精度一致）
  const resX = Math.ceil(size.x / voxelSize);
  const resY = Math.ceil(size.y / voxelSize);
  const resZ = Math.ceil(size.z / voxelSize);

  // 确定切割轴（最长水平轴）
  const axi = size.x >= size.z ? 0 : 2;
  const axis = axi === 0 ? 'x' : 'z';
  const cutAxisRes = axi === 0 ? resX : resZ;
  const perpI = axi === 0 ? 1 : 0;
  const perpJ = axi === 0 ? 2 : 1;
  const perpResI = axi === 0 ? resY : resX;
  const perpResJ = axi === 0 ? resZ : resY;

  // 1. 构建 BVH（一次性开销，纯CPU加速的关键）
  console.time('[CPU-Slice] BVH Build');
  const meshList = [];
  scene.traverse((node) => {
    if (node.isMesh && node.geometry) {
      if (!node.geometry.boundsTree) node.geometry.computeBoundsTree();
      meshList.push(node);
    }
  });
  console.timeEnd('[CPU-Slice] BVH Build');

  // 2. 精确体素化 + 边界解析补偿 → 生成沿切割轴的 1D 体积分布
  console.time('[CPU-Slice] Exact Voxelization');
  const columnVolumes = new Float64Array(cutAxisRes);
  const baseVol = voxelSize * voxelSize * voxelSize;

  // 预分配复用对象，零 GC
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3().setComponent(axi, 1);
  const raycaster = new THREE.Raycaster();

  for (let ip1 = 0; ip1 < perpResI; ip1++) {
    const valI = box.min.getComponent(perpI) + (ip1 + 0.5) * voxelSize;
    for (let ip2 = 0; ip2 < perpResJ; ip2++) {
      const valJ = box.min.getComponent(perpJ) + (ip2 + 0.5) * voxelSize;

      // 【核心优化】沿切割轴发射单条射线，获取所有精确交点
      rayOrigin.setComponent(axi, box.min.getComponent(axi) - voxelSize);
      rayOrigin.setComponent(perpI, valI);
      rayOrigin.setComponent(perpJ, valJ);

      raycaster.set(rayOrigin, rayDir);
      raycaster.firstHitOnly = false; // 必须获取所有交点

      let allHits = [];
      for (const mesh of meshList) {
        const hits = raycaster.intersectObject(mesh, false);
        for (let h = 0; h < hits.length; h++) allHits.push(hits[h].distance);
      }

      if (allHits.length < 2) continue;
      allHits.sort((a, b) => a - b);

      // 【精度保障】配对交点，精确分配到对应 column
      for (let k = 0; k < allHits.length - 1; k += 2) {
        const enterDist = allHits[k];
        const exitDist = allHits[k + 1];

        const startCol = Math.max(0, Math.floor(enterDist / voxelSize));
        const endCol = Math.min(cutAxisRes - 1, Math.floor(exitDist / voxelSize));

        for (let c = startCol; c <= endCol; c++) {
          const colWorldStart = c * voxelSize;
          const colWorldEnd = (c + 1) * voxelSize;

          // 计算该体素内射线穿过的精确长度
          const segStart = Math.max(enterDist, colWorldStart);
          const segEnd = Math.min(exitDist, colWorldEnd);
          const len = Math.max(0, segEnd - segStart);

          // 对于完全在内部的体素 len ≈ voxelSize，fraction ≈ 1.0
          // 对于边界体素，fraction 精确反映了被表面切割的真实体积占比
          const fraction = len / voxelSize;
          columnVolumes[c] += baseVol * fraction;
        }
      }
    }
  }
  console.timeEnd('[CPU-Slice] Exact Voxelization');

  // 3. 构建 CDF（前缀和），后续所有切片操作均基于此数组
  const cdf = new Float64Array(cutAxisRes);
  cdf[0] = columnVolumes[0];
  for (let i = 1; i < cutAxisRes; i++) cdf[i] = cdf[i - 1] + columnVolumes[i];
  const totalVolume = cdf[cutAxisRes - 1];

  if (totalVolume <= 0) return null;

  // 4. O(N log R) 精确等体积切面求解
  const targetPerSlice = totalVolume / (N + 1);
  const cutPlanes = [];

  for (let s = 1; s <= N; s++) {
    const target = targetPerSlice * s;

    // 二分查找目标体积所在的 column
    let lo = 0, hi = cutAxisRes - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1; else hi = mid;
    }

    // 【精度保障】在 column 内部线性插值，达到亚体素级切面定位
    const prevCum = lo > 0 ? cdf[lo - 1] : 0;
    const colVol = columnVolumes[lo];
    const frac = colVol > 1e-12 ? (target - prevCum) / colVol : 0;

    cutPlanes.push(box.min.getComponent(axi) + (lo + frac) * voxelSize);
  }

  // 5. 验证每块实际体积
  const sliceVolumes = new Array(N + 1).fill(0);
  let sliceIdx = 0;
  for (let i = 0; i < cutAxisRes; i++) {
    while (sliceIdx < N && cdf[i] >= targetPerSlice * (sliceIdx + 1)) sliceIdx++;
    sliceVolumes[sliceIdx] += columnVolumes[i];
  }

  console.log(`[CPU-Slice] axis=${axis} totalVol=${totalVolume.toFixed(4)} R=${R} res=${cutAxisRes}`);
  console.log(`[CPU-Slice] cuts=[${cutPlanes.map(c => c.toFixed(3)).join(', ')}]`);
  console.log(`[CPU-Slice] volumes=[${sliceVolumes.map(v => v.toFixed(4)).join(', ')}]`);

  return {
    cutPlanes,
    axis,
    sliceVolumes,
    slicePercentages: sliceVolumes.map(v => +(v / totalVolume * 100).toFixed(2)),
    totalVolume,
    boxMin: [box.min.x, box.min.y, box.min.z],
    boxMax: [box.max.x, box.max.y, box.max.z],
    voxelSize,
    resolution: cutAxisRes,
    // 暴露 CDF，后续调整 N 时无需重新体素化
    _cdf: cdf,
    _boxMin: box.min.getComponent(axi),
    _axisLen: size.getComponent(axi),
    _voxelSize: voxelSize,
  };
}

/** 极速重切片：利用缓存的 CDF，毫秒级返回新切面 */
function recomputeCutsFromCache(cache, newN) {
  const { _cdf, _boxMin, _voxelSize, resolution } = cache;
  const totalVol = _cdf[resolution - 1];
  const targetVol = totalVol / (newN + 1);

  const cuts = [];
  for (let s = 1; s <= newN; s++) {
    const t = targetVol * s;
    let lo = 0, hi = resolution - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (_cdf[m] < t) lo = m + 1;
      else hi = m;
    }
    const prev = lo > 0 ? _cdf[lo - 1] : 0;
    const vol = _cdf[lo] - prev;
    const f = vol > 1e-12 ? (t - prev) / vol : 0;
    cuts.push(_boxMin + (lo + f) * _voxelSize);
  }
  return cuts;
}

/* ═══════════════════════════════════════════
   App
═══════════════════════════════════════════ */

export default function App() {
  const [fileName, setFileName] = useState('');
  const [gltfScene, setGltfScene] = useState(null);
  const [aligned, setAligned] = useState(false);
  const [sliceCount, setSliceCount] = useState(4);
  const [sampleRes, setSampleRes] = useState(96);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [cutResult, setCutResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [tooltip, setTooltip] = useState(null);
  const containerRef = useRef(null);

  /* ── 初始化 MeshoptDecoder ── */
  useEffect(() => {
    loader.setMeshoptDecoder(MeshoptDecoder);
    MeshoptDecoder.ready
      .then(() => console.log('[MeshoptDecoder] WASM ready'))
      .catch((err) => console.warn('[MeshoptDecoder] WASM failed:', err.message));
  }, []);

  /* ── 文件上传 ── */
  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCutResult(null);
    setGltfScene(null);
    setAligned(false);
    setStatus('loading');
    setProgress(0);
    setErrorMsg('');

    console.log('[App] loading:', file.name, file.size, 'bytes');

    const url = URL.createObjectURL(file);
    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        console.log('[App] GLB loaded, scene children:', gltf.scene.children.length);

        // 自动对齐
        const result = alignModelToGround(gltf.scene);
        if (result) {
          setAligned(true);
          console.log('[App] aligned to ground');
        }

        setGltfScene(gltf.scene);
        setStatus('idle');
      },
      (e) => {
        if (e.total > 0) setProgress(Math.round((e.loaded / e.total) * 100));
      },
      (err) => {
        URL.revokeObjectURL(url);
        console.error('[App] GLB load error:', err);
        setErrorMsg('GLB 加载失败：' + (err.message || err));
        setStatus('error');
      }
    );
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile({ target: { files: [file] } });
  }, [handleFile]);

  /* ── 前端计算等体积切割（BVH 加速）── */
  const handleCompute = useCallback(() => {
    if (!gltfScene) return;
    setStatus('computing');
    setProgress(0);
    setCutResult(null);
    setErrorMsg('');

    setTimeout(() => {
      try {
        setProgress(5);
        const result = cpuExactEqualSlices(gltfScene, sliceCount, sampleRes);
        if (!result) {
          setErrorMsg('计算失败：未能获取模型几何数据');
          setStatus('error');
          return;
        }
        setProgress(100);
        setCutResult(result);
        setStatus('done');
      } catch (err) {
        setErrorMsg('计算失败：' + err.message);
        setStatus('error');
      }
    }, 50);
  }, [gltfScene, sliceCount, sampleRes]);

  /* ── 鼠标悬停 ── */
  const handleTooltip = useCallback(({ sliceIndex, volume, event }) => {
    if (!cutResult) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const x = event.clientX - (rect?.left ?? 0);
    const y = event.clientY - (rect?.top ?? 0);
    setTooltip({ x, y, sliceIndex, volumeStr: formatVolume(volume) });
  }, [cutResult]);

  const handleNoTooltip = useCallback(() => setTooltip(null), []);

  const handleMouseMove = useCallback((e) => {
    if (!tooltip) return;
    const rect = containerRef.current?.getBoundingClientRect();
    setTooltip((prev) => prev ? { ...prev, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) } : null);
  }, [tooltip]);

  /* ── 模型尺寸（直接采样世界坐标，与 alignModelToGround 保持一致）── */
  const sceneBox = useMemo(() => {
    if (!gltfScene) return null;
    gltfScene.updateWorldMatrix(true, true);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    const v = new THREE.Vector3();

    gltfScene.traverse((n) => {
      if (!n.isMesh || !n.geometry?.attributes.position) return;
      const pos = n.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 10000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld);
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
        if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
      }
    });

    if (!isFinite(minX)) return null;

    const sx = maxX - minX; // X 跨度
    const sy = maxY - minY; // Y 跨度（= 垂直高度）
    const sz = maxZ - minZ; // Z 跨度

    console.log(`[sceneBox] raw X=${sx.toFixed(2)}  Y=${sy.toFixed(2)}(height)  Z=${sz.toFixed(2)}  |  minY=${minY.toFixed(4)} maxY=${maxY.toFixed(4)}`);

    const length = sx >= sz ? sx : sz;
    const width = sx >= sz ? sz : sx;
    return {
      length: length.toFixed(2),
      width: width.toFixed(2),
      height: sy.toFixed(2),
    };
  }, [gltfScene]);

  const totalSlices = cutResult ? cutResult.cutPlanes.length + 1 : 0;

  return (
    <div className="app-root">
      <aside className="side-panel">
        <div className="panel-header">
          <span className="panel-icon">⛏️</span>
          <h1>等体积切割</h1>
          <small style={{ color: '#6080c0', marginTop: 2 }}>纯前端 · BVH 加速 · 精确体素</small>
        </div>

        {/* 文件上传 */}
        <div
          className={`upload-zone ${fileName ? 'has-file' : ''}`}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => document.getElementById('file-input').click()}
        >
          <input id="file-input" type="file" accept=".glb,.gltf" style={{ display: 'none' }} onChange={handleFile} />
          {fileName ? (
            <div className="file-info">
              <span className="file-icon">📦</span>
              <span className="file-name">{fileName}</span>
              {gltfScene && <span className="file-ok">✓ 已加载 {aligned ? '· 已对齐' : ''}</span>}
            </div>
          ) : (
            <div className="upload-prompt">
              <span className="upload-icon">☁️</span>
              <p>拖拽或点击上传 GLB 文件</p>
              <small>.glb / .gltf</small>
            </div>
          )}
        </div>

        {/* 模型信息 */}
        {sceneBox && (
          <div style={{ fontSize: 11, color: '#556080', padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
            📐 长 {sceneBox.length} × 宽 {sceneBox.width} × 高 {sceneBox.height}
          </div>
        )}

        {/* 参数 */}
        <div className="param-section">
          <div className="param-row">
            <label>切割刀数 <span className="param-badge">N</span></label>
            <div className="param-control">
              <input type="range" min={1} max={20} value={sliceCount} onChange={(e) => setSliceCount(Number(e.target.value))} />
              <span className="param-value">{sliceCount}</span>
            </div>
            <small>切 N 刀 = {sliceCount + 1} 块等体积</small>
          </div>

          <div className="param-row">
            <label>采样精度 <span className="param-badge">R</span></label>
            <div className="param-control">
              <input type="range" min={48} max={256} step={16} value={sampleRes} onChange={(e) => setSampleRes(Number(e.target.value))} />
              <span className="param-value">{sampleRes}</span>
            </div>
            <small>越高越精确（默认 96，推荐 64~128）</small>
          </div>
        </div>

        {/* 计算按钮 */}
        <button
          className={`compute-btn ${!gltfScene || status === 'computing' ? 'disabled' : ''}`}
          onClick={handleCompute}
          disabled={!gltfScene || status === 'computing' || status === 'loading'}
        >
          {status === 'computing' ? <><span className="spinner" /> 计算中…</> : '▶ 开始等体积切割'}
        </button>

        {status === 'computing' && (
          <div className="progress-wrap">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
            <span>BVH 体素化中…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="error-box">⚠️ {errorMsg}</div>
        )}

        {/* 结果 */}
        {cutResult && status === 'done' && (
          <div className="result-section">
            <h3>📊 切割结果</h3>
            <div className="result-meta">
              <span>总体积：<b>{formatVolume(cutResult.totalVolume)}</b></span>
              <span>切割轴：<b>{cutResult.axis.toUpperCase()} 轴</b></span>
              <span>切割面：<b>{cutResult.cutPlanes.length}</b></span>
            </div>
            <div className="slice-list">
              {cutResult.sliceVolumes.map((vol, i) => (
                <div key={i} className="slice-item">
                  <span className="slice-dot" style={{ background: sliceColorHex(i, totalSlices) }} />
                  <span>第 {i + 1} 块</span>
                  <span className="slice-vol">{formatVolume(vol)}</span>
                  {cutResult.slicePercentages && (
                    <span className="slice-pct">{cutResult.slicePercentages[i]}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="panel-footer">
          <small>Three.js · BVH 加速 · 精确等体积切割</small>
        </div>
      </aside>

      {/* 3D 视口 */}
      <main className="viewport" ref={containerRef} onMouseMove={handleMouseMove}>
        {!gltfScene && (
          <div className="viewport-empty">
            <div className="viewport-hint">
              <span>🏔️</span>
              <p>上传 GLB 模型后开始可视化</p>
            </div>
          </div>
        )}

        {gltfScene && (
          <ModelViewer
            gltfScene={gltfScene}
            cutResult={cutResult}
            tooltip={tooltip}
            onTooltip={handleTooltip}
            onNoTooltip={handleNoTooltip}
          />
        )}
      </main>
    </div>
  );
}
