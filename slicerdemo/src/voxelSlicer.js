/**
 * VoxelSlicer - 体素化等体积垂直切割算法
 *
 * 工作流程：
 * 1. 从 BufferGeometry 提取三角面数据
 * 2. 建立轴对齐包围盒 (AABB)
 * 3. 体素化：射线法判断体素中心是否在模型内部
 * 4. 沿切割轴累积体积，找到等体积切割面坐标
 * 5. 返回切割面 X/Y 坐标列表及总体积
 */

import * as THREE from 'three';

/* ─────────────────────────────────────────────
   工具：收集场景中所有 mesh 的世界空间三角形
───────────────────────────────────────────── */
export function collectTriangles(object) {
  const triangles = [];
  object.updateWorldMatrix(true, true);

  object.traverse((node) => {
    if (!node.isMesh) return;
    const geo = node.geometry;
    if (!geo) return;
    const posAttr = geo.attributes.position;
    if (!posAttr) return;

    // 克隆到世界空间
    const worldMatrix = node.matrixWorld;
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();

    const getVertex = (i) => {
      return new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(worldMatrix);
    };

    if (geo.index) {
      const idx = geo.index;
      for (let i = 0; i < idx.count; i += 3) {
        triangles.push([
          getVertex(idx.getX(i)),
          getVertex(idx.getX(i + 1)),
          getVertex(idx.getX(i + 2)),
        ]);
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        triangles.push([getVertex(i), getVertex(i + 1), getVertex(i + 2)]);
      }
    }
  });

  return triangles;
}

/* ─────────────────────────────────────────────
   包围盒计算
───────────────────────────────────────────── */
export function computeBoundingBox(triangles) {
  const box = new THREE.Box3();
  for (const [a, b, c] of triangles) {
    box.expandByPoint(a);
    box.expandByPoint(b);
    box.expandByPoint(c);
  }
  return box;
}

/* ─────────────────────────────────────────────
   射线-三角形相交（Möller–Trumbore）
   返回是否相交及 t（沿射线距离）
───────────────────────────────────────────── */
const EPSILON = 1e-7;

function rayTriangleIntersect(rayOrigin, rayDir, A, B, C) {
  const edge1 = B.clone().sub(A);
  const edge2 = C.clone().sub(A);
  const h = new THREE.Vector3().crossVectors(rayDir, edge2);
  const a = edge1.dot(h);
  if (Math.abs(a) < EPSILON) return null;
  const f = 1.0 / a;
  const s = rayOrigin.clone().sub(A);
  const u = f * s.dot(h);
  if (u < 0 || u > 1) return null;
  const q = new THREE.Vector3().crossVectors(s, edge1);
  const v = f * rayDir.dot(q);
  if (v < 0 || u + v > 1) return null;
  const t = f * edge2.dot(q);
  if (t < EPSILON) return null;
  return t;
}

/* ─────────────────────────────────────────────
   判断点是否在封闭网格内部（射线法，计算交叉次数奇偶性）
   方向：+Z 方向射出
───────────────────────────────────────────── */
function isPointInsideMesh(point, triangles) {
  const rayDir = new THREE.Vector3(0, 0, 1);
  let count = 0;
  for (const [A, B, C] of triangles) {
    const t = rayTriangleIntersect(point, rayDir, A, B, C);
    if (t !== null) count++;
  }
  return count % 2 === 1;
}

/* ─────────────────────────────────────────────
   主函数：体素化 + 等体积切割面计算
   
   @param {THREE.Object3D} object  - 已加载的 GLB 场景根节点
   @param {number} N               - 切割数量（切 N 刀 = N+1 块）
   @param {number} voxelDivisions  - 沿最长轴的体素分辨率（默认 60）
   @param {function} onProgress    - 进度回调 (0~1)
   @returns {Promise<{cutPlanes: number[], axis: string, voxelSize: number, totalVolume: number, sliceVolumes: number[]}>}
───────────────────────────────────────────── */
export async function computeEqualVolumeCuts(object, N, voxelDivisions = 60, onProgress) {
  onProgress?.(0.02);

  // 1. 收集三角形
  const triangles = collectTriangles(object);
  if (triangles.length === 0) throw new Error('模型中未找到可用三角面');

  onProgress?.(0.05);

  // 2. 计算包围盒
  const box = computeBoundingBox(triangles);
  const size = new THREE.Vector3();
  box.getSize(size);

  // 3. 确定切割轴（选最长的水平轴，Z 认为是垂直轴）
  //    如果 Y 比 X 长则沿 Y 轴切
  let axis, axisMin, axisMax, axisLen;
  if (size.x >= size.y) {
    axis = 'x'; axisMin = box.min.x; axisMax = box.max.x; axisLen = size.x;
  } else {
    axis = 'y'; axisMin = box.min.y; axisMax = box.max.y; axisLen = size.y;
  }

  // 4. 计算体素尺寸（让最长轴有 voxelDivisions 个体素）
  const voxelSize = axisLen / voxelDivisions;
  const nX = Math.max(1, Math.ceil(size.x / voxelSize));
  const nY = Math.max(1, Math.ceil(size.y / voxelSize));
  const nZ = Math.max(1, Math.ceil(size.z / voxelSize));
  const totalVoxels = nX * nY * nZ;

  onProgress?.(0.08);

  // 5. 体素化
  //    为了不阻塞 UI，分批 yield
  const BATCH = 2000;

  // 构建沿切割轴的体素列（column）计数数组
  // column[i] = 沿切割轴第 i 列中处于模型内部的体素数量
  const nCut = axis === 'x' ? nX : nY;
  const columnCount = new Float64Array(nCut);

  let processed = 0;

  for (let ix = 0; ix < nX; ix++) {
    for (let iy = 0; iy < nY; iy++) {
      for (let iz = 0; iz < nZ; iz++) {
        const px = box.min.x + (ix + 0.5) * voxelSize;
        const py = box.min.y + (iy + 0.5) * voxelSize;
        const pz = box.min.z + (iz + 0.5) * voxelSize;
        const pt = new THREE.Vector3(px, py, pz);

        if (isPointInsideMesh(pt, triangles)) {
          const col = axis === 'x' ? ix : iy;
          columnCount[col]++;
        }

        processed++;
        if (processed % BATCH === 0) {
          onProgress?.(0.08 + 0.82 * (processed / totalVoxels));
          // 让出主线程
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
  }

  onProgress?.(0.92);

  // 6. 计算总内部体素数 / 总体积
  const voxelVolume = voxelSize ** 3;
  let totalCount = 0;
  for (let i = 0; i < nCut; i++) totalCount += columnCount[i];
  const totalVolume = totalCount * voxelVolume;

  // 7. 确定切割面坐标
  const targetPerSlice = totalCount / (N + 1);
  const cutPlanes = []; // 切割面在 axis 方向的世界坐标
  let cumulative = 0;

  for (let i = 0; i < nCut; i++) {
    cumulative += columnCount[i];
    if (cutPlanes.length < N && cumulative >= targetPerSlice * (cutPlanes.length + 1)) {
      // 线性插值：在第 i 列末端插值
      const excess = cumulative - targetPerSlice * (cutPlanes.length + 1);
      const frac = columnCount[i] > 0 ? excess / columnCount[i] : 0;
      const coord = axisMin + (i + 1 - frac) * voxelSize;
      cutPlanes.push(coord);
    }
  }

  // 补足不足的切割面（极端情况）
  while (cutPlanes.length < N) {
    const prev = cutPlanes.length > 0 ? cutPlanes[cutPlanes.length - 1] : axisMin;
    cutPlanes.push((prev + axisMax) / 2);
  }

  // 8. 计算每块的体积
  const sliceVolumes = Array(N + 1).fill(0);
  let sliceIdx = 0;
  cumulative = 0;
  for (let i = 0; i < nCut; i++) {
    cumulative += columnCount[i];
    while (sliceIdx < N && cumulative >= targetPerSlice * (sliceIdx + 1)) {
      sliceIdx++;
    }
    sliceVolumes[sliceIdx] += columnCount[i] * voxelVolume;
  }

  onProgress?.(1.0);

  return {
    cutPlanes,
    axis,
    voxelSize,
    totalVolume,
    sliceVolumes,
    box,
    nCut,
    axisMin,
    axisMax,
  };
}

/* ─────────────────────────────────────────────
   格式化体积显示
───────────────────────────────────────────── */
export function formatVolume(v) {
  if (v < 1e-6) return `${(v * 1e9).toFixed(2)} mm³`;
  if (v < 1e-3) return `${(v * 1e6).toFixed(2)} cm³`;
  if (v < 1) return `${(v * 1e3).toFixed(2)} L`;
  return `${v.toFixed(4)} m³`;
}
