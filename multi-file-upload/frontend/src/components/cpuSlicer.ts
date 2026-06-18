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
  sliceNormal?: [number, number, number]; // non-null when slicing parallel to pre-cut plane
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

const UP = new THREE.Vector3(0, 1, 0);

export function cpuExactEqualSlices(
  scene: THREE.Object3D,
  N: number,
  R = 96,
  preClipPlane?: THREE.Plane | null,
  sliceNormal?: THREE.Vector3 | null,
): CutResult | null {
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return null;

  const hasPreCut = !!preClipPlane;

  // 1. 构建 BVH
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

  // Determine whether to use rotated (parallel-to-pre-cut) or axis-aligned slicing
  const useRotated = sliceNormal && !isAxisAligned(sliceNormal);

  if (useRotated) {
    return computeRotatedSlices(box, meshList, N, R, preClipPlane, sliceNormal, hasPreCut);
  }

  // === Axis-aligned path (original) ===
  const size = new THREE.Vector3();
  box.getSize(size);
  const voxelSize = Math.max(size.x, size.y, size.z) / R;
  const resX = Math.ceil(size.x / voxelSize);
  const resY = Math.ceil(size.y / voxelSize);
  const resZ = Math.ceil(size.z / voxelSize);

  // When sliceNormal is provided and axis-aligned, force axis to match it
  // (otherwise the auto-pick may choose wrong axis and slices appear perpendicular)
  let axi: number;
  let axis: string;
  if (sliceNormal) {
    if (Math.abs(sliceNormal.x) > 0.999) { axi = 0; axis = 'x'; }
    else if (Math.abs(sliceNormal.z) > 0.999) { axi = 2; axis = 'z'; }
    else { axi = size.x >= size.z ? 0 : 2; axis = axi === 0 ? 'x' : 'z'; }
  } else {
    axi = size.x >= size.z ? 0 : 2;
    axis = axi === 0 ? 'x' : 'z';
  }
  const cutAxisRes = axi === 0 ? resX : resZ;
  const perpI = axi === 0 ? 1 : 0;
  const perpJ = axi === 0 ? 2 : 1;
  const perpResI = axi === 0 ? resY : resX;
  const perpResJ = axi === 0 ? resZ : resY;

  const columnVolumes = new Float64Array(cutAxisRes);
  const baseVol = voxelSize * voxelSize * voxelSize;

  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3().setComponent(axi, 1);
  const raycaster = new THREE.Raycaster();

  for (let ip1 = 0; ip1 < perpResI; ip1++) {
    const valI = box.min.getComponent(perpI) + (ip1 + 0.5) * voxelSize;
    for (let ip2 = 0; ip2 < perpResJ; ip2++) {
      const valJ = box.min.getComponent(perpJ) + (ip2 + 0.5) * voxelSize;
      rayOrigin.setComponent(axi, box.min.getComponent(axi) - voxelSize);
      rayOrigin.setComponent(perpI, valI);
      rayOrigin.setComponent(perpJ, valJ);
      raycaster.set(rayOrigin, rayDir);
      raycaster.firstHitOnly = false;

      let allHits: number[] = [];
      for (const mesh of meshList) {
        const hits = raycaster.intersectObject(mesh, false);
        for (let h = 0; h < hits.length; h++) allHits.push(hits[h].distance);
      }
      if (allHits.length < 2) continue;
      allHits.sort((a, b) => a - b);

      for (let k = 0; k < allHits.length - 1; k += 2) {
        const enterDist = allHits[k];
        const exitDist = allHits[k + 1];
        const startCol = Math.max(0, Math.floor(enterDist / voxelSize));
        const endCol = Math.min(cutAxisRes - 1, Math.floor(exitDist / voxelSize));
        for (let c = startCol; c <= endCol; c++) {
          const colWorldStart = c * voxelSize;
          const colWorldEnd = (c + 1) * voxelSize;
          const segStart = Math.max(enterDist, colWorldStart);
          const segEnd = Math.min(exitDist, colWorldEnd);
          const len = Math.max(0, segEnd - segStart);
          const fraction = len / voxelSize;

          if (hasPreCut) {
            const voxelCenter = new THREE.Vector3();
            voxelCenter.setComponent(axi, box.min.getComponent(axi) + colWorldStart + voxelSize * 0.5);
            voxelCenter.setComponent(perpI, valI);
            voxelCenter.setComponent(perpJ, valJ);
            if (preClipPlane!.distanceToPoint(voxelCenter) >= 0) continue;
          }
          columnVolumes[c] += baseVol * fraction;
        }
      }
    }
  }

  return buildCutResult(
    columnVolumes, cutAxisRes, box, axis, axi, size, voxelSize, N,
    sliceNormal ? [sliceNormal.x, sliceNormal.y, sliceNormal.z] as [number, number, number] : undefined,
  );
}

// ── Rotated-coordinate voxelization (slice planes parallel to pre-cut) ──

function computeRotatedSlices(
  box: THREE.Box3,
  meshList: THREE.Mesh[],
  N: number,
  R: number,
  preClipPlane: THREE.Plane | undefined | null,
  normalDir: THREE.Vector3,
  hasPreCut: boolean,
): CutResult | null {
  // perpXZ: in XZ plane, perpendicular to normalDir
  const perpXZ = new THREE.Vector3().crossVectors(normalDir, UP).normalize();

  // Project 8 box corners onto the rotated basis {normalDir, Y, perpXZ}
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];

  let nMin = Infinity, nMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let pMin = Infinity, pMax = -Infinity;
  for (const c of corners) {
    const nd = normalDir.dot(c);
    const yd = c.y;
    const pd = perpXZ.dot(c);
    if (nd < nMin) nMin = nd; if (nd > nMax) nMax = nd;
    if (yd < yMin) yMin = yd; if (yd > yMax) yMax = yd;
    if (pd < pMin) pMin = pd; if (pd > pMax) pMax = pd;
  }

  const nLen = nMax - nMin;
  const yLen = yMax - yMin;
  const pLen = pMax - pMin;
  const voxelSize = Math.max(nLen, yLen, pLen) / R;
  const nRes = Math.ceil(nLen / voxelSize);
  const yRes = Math.ceil(yLen / voxelSize);
  const pRes = Math.ceil(pLen / voxelSize);

  const columnVolumes = new Float64Array(nRes);
  const baseVol = voxelSize * voxelSize * voxelSize;

  const rayOrigin = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const _tmpVoxelCenter = new THREE.Vector3();

  for (let iy = 0; iy < yRes; iy++) {
    const y = yMin + (iy + 0.5) * voxelSize;
    for (let ip = 0; ip < pRes; ip++) {
      const p = pMin + (ip + 0.5) * voxelSize;

      // ray origin = one voxel behind nMin, at cell (y, p) position
      rayOrigin.copy(normalDir).multiplyScalar(nMin - voxelSize)
        .addScaledVector(UP, y)
        .addScaledVector(perpXZ, p);

      raycaster.set(rayOrigin, normalDir);
      raycaster.firstHitOnly = false;

      let allHits: number[] = [];
      for (const mesh of meshList) {
        const hits = raycaster.intersectObject(mesh, false);
        for (let h = 0; h < hits.length; h++) allHits.push(hits[h].distance);
      }
      if (allHits.length < 2) continue;
      allHits.sort((a, b) => a - b);

      for (let k = 0; k < allHits.length - 1; k += 2) {
        const enterDist = allHits[k];
        const exitDist = allHits[k + 1];
        const startCol = Math.max(0, Math.floor(enterDist / voxelSize));
        const endCol = Math.min(nRes - 1, Math.floor(exitDist / voxelSize));

        for (let c = startCol; c <= endCol; c++) {
          const colWorldStart = c * voxelSize;
          const colWorldEnd = (c + 1) * voxelSize;
          const segStart = Math.max(enterDist, colWorldStart);
          const segEnd = Math.min(exitDist, colWorldEnd);
          const len = Math.max(0, segEnd - segStart);
          const fraction = len / voxelSize;

          if (hasPreCut) {
            // Voxel center in world space
            const nCenter = nMin + (c + 0.5) * voxelSize;
            _tmpVoxelCenter.copy(normalDir).multiplyScalar(nCenter)
              .addScaledVector(UP, y)
              .addScaledVector(perpXZ, p);
            if (preClipPlane!.distanceToPoint(_tmpVoxelCenter) >= 0) continue;
          }
          columnVolumes[c] += baseVol * fraction;
        }
      }
    }
  }

  // Build CDF
  const cdf = new Float64Array(nRes);
  cdf[0] = columnVolumes[0];
  for (let i = 1; i < nRes; i++) cdf[i] = cdf[i - 1] + columnVolumes[i];
  const totalVolume = cdf[nRes - 1];
  if (totalVolume <= 0) return null;

  // Compute cut planes along normalDir
  const targetPerSlice = totalVolume / (N + 1);
  const cutPlanes: number[] = [];
  for (let s = 1; s <= N; s++) {
    const target = targetPerSlice * s;
    let lo = 0, hi = nRes - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const prevCum = lo > 0 ? cdf[lo - 1] : 0;
    const colVol = columnVolumes[lo];
    const frac = colVol > 1e-12 ? (target - prevCum) / colVol : 0;
    // Position along normalDir in world space
    cutPlanes.push(nMin + (lo + frac) * voxelSize);
  }

  // Validate slice volumes
  const sliceVolumes: number[] = new Array(N + 1).fill(0);
  let sliceIdx = 0;
  for (let i = 0; i < nRes; i++) {
    while (sliceIdx < N && cdf[i] >= targetPerSlice * (sliceIdx + 1)) sliceIdx++;
    sliceVolumes[sliceIdx] += columnVolumes[i];
  }

  return {
    cutPlanes,
    axis: 'custom',
    sliceNormal: [normalDir.x, normalDir.y, normalDir.z],
    sliceVolumes,
    slicePercentages: sliceVolumes.map((v) => +(v / totalVolume * 100).toFixed(2)),
    totalVolume,
    boxMin: [box.min.x, box.min.y, box.min.z],
    boxMax: [box.max.x, box.max.y, box.max.z],
    voxelSize,
    resolution: nRes,
    _cdf: cdf,
    _boxMin: nMin,
    _axisLen: nLen,
    _voxelSize: voxelSize,
  };
}

// ── Shared helper: build CutResult from column volumes (axis-aligned case) ──

function buildCutResult(
  columnVolumes: Float64Array,
  cutAxisRes: number,
  box: THREE.Box3,
  axis: string,
  axi: number,
  size: THREE.Vector3,
  voxelSize: number,
  N: number,
  sliceNormal?: [number, number, number],
): CutResult {
  const cdf = new Float64Array(cutAxisRes);
  cdf[0] = columnVolumes[0];
  for (let i = 1; i < cutAxisRes; i++) cdf[i] = cdf[i - 1] + columnVolumes[i];
  const totalVolume = cdf[cutAxisRes - 1];
  if (totalVolume <= 0) return { cutPlanes: [], axis, sliceVolumes: [], slicePercentages: [], totalVolume: 0, boxMin: [0,0,0], boxMax: [0,0,0], voxelSize, resolution: cutAxisRes, _cdf: cdf, _boxMin: 0, _axisLen: 0, _voxelSize: voxelSize };

  const targetPerSlice = totalVolume / (N + 1);
  const cutPlanes: number[] = [];
  for (let s = 1; s <= N; s++) {
    const target = targetPerSlice * s;
    let lo = 0, hi = cutAxisRes - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const prevCum = lo > 0 ? cdf[lo - 1] : 0;
    const colVol = columnVolumes[lo];
    const frac = colVol > 1e-12 ? (target - prevCum) / colVol : 0;
    cutPlanes.push(box.min.getComponent(axi) + (lo + frac) * voxelSize);
  }

  const sliceVolumes: number[] = new Array(N + 1).fill(0);
  let sliceIdx = 0;
  for (let i = 0; i < cutAxisRes; i++) {
    while (sliceIdx < N && cdf[i] >= targetPerSlice * (sliceIdx + 1)) sliceIdx++;
    sliceVolumes[sliceIdx] += columnVolumes[i];
  }

  return {
    cutPlanes,
    axis,
    sliceNormal,
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

function isAxisAligned(v: THREE.Vector3): boolean {
  const eps = 0.001;
  return (Math.abs(v.x) > 1 - eps && Math.abs(v.z) < eps) ||
         (Math.abs(v.z) > 1 - eps && Math.abs(v.x) < eps);
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
