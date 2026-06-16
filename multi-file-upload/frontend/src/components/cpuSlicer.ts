/**
 * cpuSlicer — 纯CPU高精度等体积切片器（BVH加速 + 射线列求交）
 *
 * 从 coal-slicer 移植。依赖 three-mesh-bvh 的 BVH 空间加速。
 * 必须在调用前确保已 monkey-patch：
 *   THREE.BufferGeometry.prototype.computeBoundsTree  = computeBoundsTree
 *   THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
 *   THREE.Mesh.prototype.raycast                      = acceleratedRaycast
 */
import * as THREE from 'three';

export interface CutResult {
  cutPlanes: number[];
  axis: string;
  sliceVolumes: number[];
  slicePercentages: number[];
  totalVolume: number;
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  voxelSize: number;
  resolution: number;
  // Internal cache for fast re-slicing
  _cdf: Float64Array;
  _boxMin: number;
  _axisLen: number;
  _voxelSize: number;
}

export function cpuExactEqualSlices(
  scene: THREE.Object3D,
  N: number,
  R = 96,
): CutResult | null {
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
  const meshList: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if ((node as THREE.Mesh).isMesh && (node as THREE.Mesh).geometry) {
      const mesh = node as THREE.Mesh;
      const geo = mesh.geometry;
      if (!(geo as any).boundsTree) (geo as any).computeBoundsTree();
      meshList.push(mesh);
    }
  });

  if (meshList.length === 0) return null;

  // 2. 精确体素化 + 边界解析补偿 → 生成沿切割轴的 1D 体积分布
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

      // 沿切割轴发射单条射线，获取所有精确交点
      rayOrigin.setComponent(axi, box.min.getComponent(axi) - voxelSize);
      rayOrigin.setComponent(perpI, valI);
      rayOrigin.setComponent(perpJ, valJ);

      raycaster.set(rayOrigin, rayDir);
      raycaster.firstHitOnly = false; // 必须获取所有交点

      let allHits: number[] = [];
      for (const mesh of meshList) {
        const hits = raycaster.intersectObject(mesh, false);
        for (let h = 0; h < hits.length; h++) allHits.push(hits[h].distance);
      }

      if (allHits.length < 2) continue;
      allHits.sort((a, b) => a - b);

      // 配对交点，精确分配到对应 column
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

          const fraction = len / voxelSize;
          columnVolumes[c] += baseVol * fraction;
        }
      }
    }
  }

  // 3. 构建 CDF（前缀和）
  const cdf = new Float64Array(cutAxisRes);
  cdf[0] = columnVolumes[0];
  for (let i = 1; i < cutAxisRes; i++) cdf[i] = cdf[i - 1] + columnVolumes[i];
  const totalVolume = cdf[cutAxisRes - 1];

  if (totalVolume <= 0) return null;

  // 4. O(N log R) 精确等体积切面求解
  const targetPerSlice = totalVolume / (N + 1);
  const cutPlanes: number[] = [];

  for (let s = 1; s <= N; s++) {
    const target = targetPerSlice * s;

    // 二分查找目标体积所在的 column
    let lo = 0, hi = cutAxisRes - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }

    // 在 column 内部线性插值，达到亚体素级切面定位
    const prevCum = lo > 0 ? cdf[lo - 1] : 0;
    const colVol = columnVolumes[lo];
    const frac = colVol > 1e-12 ? (target - prevCum) / colVol : 0;

    cutPlanes.push(box.min.getComponent(axi) + (lo + frac) * voxelSize);
  }

  // 5. 验证每块实际体积
  const sliceVolumes: number[] = new Array(N + 1).fill(0);
  let sliceIdx = 0;
  for (let i = 0; i < cutAxisRes; i++) {
    while (sliceIdx < N && cdf[i] >= targetPerSlice * (sliceIdx + 1)) sliceIdx++;
    sliceVolumes[sliceIdx] += columnVolumes[i];
  }

  return {
    cutPlanes,
    axis,
    sliceVolumes,
    slicePercentages: sliceVolumes.map((v) => +(v / totalVolume * 100).toFixed(2)),
    totalVolume,
    boxMin: [box.min.x, box.min.y, box.min.z],
    boxMax: [box.max.x, box.max.y, box.max.z],
    voxelSize,
    resolution: cutAxisRes,
    _cdf: cdf,
    _boxMin: box.min.getComponent(axi),
    _axisLen: size.getComponent(axi),
    _voxelSize: voxelSize,
  };
}

/** 极速重切片：利用缓存的 CDF，毫秒级返回新切面 */
export function recomputeCutsFromCache(
  cache: CutResult,
  newN: number,
): number[] {
  const { _cdf, _boxMin, _voxelSize, resolution } = cache;
  const totalVol = _cdf[resolution - 1];
  const targetVol = totalVol / (newN + 1);

  const cuts: number[] = [];
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
