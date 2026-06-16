import React, { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'

// ── BVH 空间加速：替换 Three.js 原生 raycast 为 BVH 加速版 ──
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

// ══════════════════════════════════════════════════════════════
//   coal-slicer 完整迁移：模型水平矫正 + 等体积切割
// ══════════════════════════════════════════════════════════════

// ── 从 coal-slicer/App.jsx 完整迁移：PCA 水平矫正算法 ──
function alignModelToGround(scene: THREE.Group): boolean {
  scene.updateWorldMatrix(true, true)

  const meshList: THREE.Mesh[] = []
  scene.traverse((n) => {
    if ((n as THREE.Mesh).isMesh && (n as THREE.Mesh).geometry) {
      meshList.push(n as THREE.Mesh)
    }
  })
  if (meshList.length === 0) return false

  // 采样顶点
  const pts: number[] = []
  const v = new THREE.Vector3()
  for (const m of meshList) {
    const pos = m.geometry.attributes.position
    if (!pos) continue
    const step = Math.max(1, Math.floor(pos.count / 8000))
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i)
      v.applyMatrix4(m.matrixWorld)
      pts.push(v.x, v.y, v.z)
    }
  }

  const numPts = pts.length / 3
  if (numPts < 50) return false

  // 质心
  let cx = 0, cy = 0, cz = 0
  for (let i = 0; i < pts.length; i += 3) { cx += pts[i]; cy += pts[i + 1]; cz += pts[i + 2] }
  cx /= numPts; cy /= numPts; cz /= numPts

  // 协方差矩阵
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0
  for (let i = 0; i < pts.length; i += 3) {
    const dx = pts[i] - cx, dy = pts[i + 1] - cy, dz = pts[i + 2] - cz
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz
  }
  cxx /= numPts; cxy /= numPts; cxz /= numPts; cyy /= numPts; cyz /= numPts; czz /= numPts

  // 幂迭代求特征向量
  const powerIter = (start: THREE.Vector3): THREE.Vector3 => {
    let vv = start.clone()
    for (let k = 0; k < 15; k++) {
      vv.set(
        cxx * vv.x + cxy * vv.y + cxz * vv.z,
        cxy * vv.x + cyy * vv.y + cyz * vv.z,
        cxz * vv.x + cyz * vv.y + czz * vv.z
      ).normalize()
    }
    return vv
  }
  const ev1 = powerIter(new THREE.Vector3(1, 0, 0))
  const s2 = new THREE.Vector3(0, 1, 0).sub(ev1.clone().multiplyScalar(ev1.dot(new THREE.Vector3(0, 1, 0)))).normalize()
  const ev2 = powerIter(s2.length() > 0.1 ? s2 : new THREE.Vector3(0, 0, 1))
  const ev3 = new THREE.Vector3().crossVectors(ev1, ev2).normalize()

  const rayleigh = (vv: THREE.Vector3): number => {
    const { x, y, z } = vv
    return cxx * x * x + cyy * y * y + czz * z * z + 2 * (cxy * x * y + cxz * x * z + cyz * y * z)
  }
  const pairs = [
    { v: ev1, val: 0 },
    { v: ev2, val: 0 },
    { v: ev3, val: 0 },
  ]
  pairs.forEach(p => { p.val = rayleigh(p.v) })
  pairs.sort((a, b) => a.val - b.val)

  // 9 候选"上"方向
  const worldUp = new THREE.Vector3(0, 1, 0)
  const worldDown = new THREE.Vector3(0, -1, 0)
  const allCandidates = [
    pairs[0].v.clone(), pairs[1].v.clone(), pairs[2].v.clone(),
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
  ]

  let bestHeight = Infinity
  let bestQuat = new THREE.Quaternion()
  let bestMinY = 0
  let bestLabel = '?'

  for (let t = 0; t < allCandidates.length; t++) {
    const axis = allCandidates[t]
    const target = axis.dot(worldUp) >= -1e-12 ? worldUp : worldDown
    const trialQuat = new THREE.Quaternion().setFromUnitVectors(axis, target)

    scene.quaternion.copy(trialQuat)
    scene.position.set(0, 0, 0)
    scene.updateMatrix()
    scene.updateWorldMatrix(true, true)

    const trialBox = getSceneBounds(scene)
    if (!trialBox) continue
    const h = trialBox.max.y - trialBox.min.y

    if (h < bestHeight) {
      bestHeight = h
      bestQuat.copy(trialQuat)
      bestMinY = trialBox.min.y
      bestLabel = ['shortest PCA', 'middle PCA', 'longest PCA', '+X', '-X', '+Y', '-Y', '+Z', '-Z'][t]
    }
  }

  scene.quaternion.copy(bestQuat)
  scene.position.set(0, 0, 0)
  scene.updateMatrix()
  scene.updateWorldMatrix(true, true)

  scene.position.y -= bestMinY
  scene.updateMatrix()
  scene.updateWorldMatrix(true, true)

  const verifyBox = getSceneBounds(scene)
  if (verifyBox && Math.abs(verifyBox.min.y) > 0.01) {
    scene.position.y -= verifyBox.min.y
    scene.updateMatrix()
    scene.updateWorldMatrix(true, true)
  }

  console.log(`[alignModelToGround] best="${bestLabel}" height=${bestHeight.toFixed(4)} minY=${getSceneBounds(scene)?.min.y.toFixed(4)}`)
  return true
}

// ── 从 coal-slicer/App.jsx 完整迁移：获取场景世界空间 AABB ──
function getSceneBounds(scene: THREE.Group): THREE.Box3 | null {
  const box = new THREE.Box3()
  scene.updateWorldMatrix(true, true)
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const geo = mesh.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const nodeBox = geo.boundingBox!.clone()
    nodeBox.applyMatrix4(mesh.matrixWorld)
    box.expandByPoint(nodeBox.min)
    box.expandByPoint(nodeBox.max)
  })
  return box.isEmpty() ? null : box
}

// ── 从 coal-slicer/App.jsx 完整迁移：BVH 加速等体积切割 ──
export interface BVHVolumeResult {
  cutPlanes: number[]
  axis: string
  sliceVolumes: number[]
  slicePercentages: number[]
  totalVolume: number
  voxelSize: number
  resolution: number
  boxMinAxis: number
  boxMaxAxis: number
}

function cpuExactEqualSlices(
  scene: THREE.Group,
  N: number,
  R: number
): BVHVolumeResult | null {
  const box = new THREE.Box3().setFromObject(scene)
  if (box.isEmpty()) return null

  const size = new THREE.Vector3()
  box.getSize(size)
  const voxelSize = Math.max(size.x, size.y, size.z) / R

  const resX = Math.ceil(size.x / voxelSize)
  const resY = Math.ceil(size.y / voxelSize)
  const resZ = Math.ceil(size.z / voxelSize)

  const axi = size.x >= size.z ? 0 : 2
  const axis = axi === 0 ? 'x' : 'z'
  const cutAxisRes = axi === 0 ? resX : resZ
  const perpI = axi === 0 ? 1 : 0
  const perpJ = axi === 0 ? 2 : 1
  const perpResI = axi === 0 ? resY : resX
  const perpResJ = axi === 0 ? resZ : resY

  const meshList: THREE.Mesh[] = []
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) {
      if (!mesh.geometry.boundsTree) mesh.geometry.computeBoundsTree()
      meshList.push(mesh)
    }
  })

  const columnVolumes = new Float64Array(cutAxisRes)
  const baseVol = voxelSize * voxelSize * voxelSize

  const rayOrigin = new THREE.Vector3()
  const rayDir = new THREE.Vector3().setComponent(axi, 1)
  const raycaster = new THREE.Raycaster()
  raycaster.firstHitOnly = false

  for (let ip1 = 0; ip1 < perpResI; ip1++) {
    const valI = box.min.getComponent(perpI) + (ip1 + 0.5) * voxelSize
    for (let ip2 = 0; ip2 < perpResJ; ip2++) {
      const valJ = box.min.getComponent(perpJ) + (ip2 + 0.5) * voxelSize

      rayOrigin.setComponent(axi, box.min.getComponent(axi) - voxelSize)
      rayOrigin.setComponent(perpI, valI)
      rayOrigin.setComponent(perpJ, valJ)

      raycaster.set(rayOrigin, rayDir)

      let allHits: number[] = []
      for (const mesh of meshList) {
        const hits = raycaster.intersectObject(mesh, false)
        for (let h = 0; h < hits.length; h++) allHits.push(hits[h].distance)
      }

      if (allHits.length < 2) continue
      allHits.sort((a, b) => a - b)

      for (let k = 0; k < allHits.length - 1; k += 2) {
        const enterDist = allHits[k]
        const exitDist = allHits[k + 1]

        const startCol = Math.max(0, Math.floor(enterDist / voxelSize))
        const endCol = Math.min(cutAxisRes - 1, Math.floor(exitDist / voxelSize))

        for (let c = startCol; c <= endCol; c++) {
          const colWorldStart = c * voxelSize
          const colWorldEnd = (c + 1) * voxelSize
          const segStart = Math.max(enterDist, colWorldStart)
          const segEnd = Math.min(exitDist, colWorldEnd)
          const len = Math.max(0, segEnd - segStart)
          const fraction = len / voxelSize
          columnVolumes[c] += baseVol * fraction
        }
      }
    }
  }

  const cdf = new Float64Array(cutAxisRes)
  cdf[0] = columnVolumes[0]
  for (let i = 1; i < cutAxisRes; i++) cdf[i] = cdf[i - 1] + columnVolumes[i]
  const totalVolume = cdf[cutAxisRes - 1]
  if (totalVolume <= 0) return null

  const targetPerSlice = totalVolume / (N + 1)
  const cutPlanes: number[] = []

  for (let s = 1; s <= N; s++) {
    const target = targetPerSlice * s
    let lo = 0, hi = cutAxisRes - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < target) lo = mid + 1; else hi = mid
    }
    const prevCum = lo > 0 ? cdf[lo - 1] : 0
    const colVol = columnVolumes[lo]
    const frac = colVol > 1e-12 ? (target - prevCum) / colVol : 0
    cutPlanes.push(box.min.getComponent(axi) + (lo + frac) * voxelSize)
  }

  const sliceVolumes = new Array(N + 1).fill(0)
  let sliceIdx = 0
  for (let i = 0; i < cutAxisRes; i++) {
    while (sliceIdx < N && cdf[i] >= targetPerSlice * (sliceIdx + 1)) sliceIdx++
    sliceVolumes[sliceIdx] += columnVolumes[i]
  }

  console.log(`[cpuExactEqualSlices] axis=${axis} N=${N} R=${R} totalVol=${totalVolume.toFixed(4)}`)
  console.log(`[cpuExactEqualSlices] cuts=[${cutPlanes.map(c => c.toFixed(3)).join(', ')}]`)
  console.log(`[cpuExactEqualSlices] pct=[${sliceVolumes.map(v => (v / totalVolume * 100).toFixed(1)).join('%, ')}%]`)

  return {
    cutPlanes,
    axis,
    sliceVolumes,
    slicePercentages: sliceVolumes.map(v => +(v / totalVolume * 100).toFixed(2)),
    totalVolume,
    voxelSize,
    resolution: cutAxisRes,
    boxMinAxis: box.min.getComponent(axi),
    boxMaxAxis: box.max.getComponent(axi),
  }
}

// ══════════════════════════════════════════════════════════════
//   ITL3D 渲染层（使用原始场景的 geometry + material）
// ══════════════════════════════════════════════════════════════

// ── 收集场景中所有 mesh（保留层级变换） ──
interface SceneMeshData {
  id: number
  geometry: THREE.BufferGeometry
  material: THREE.Material
  matrixWorld: THREE.Matrix4
}

function collectAllMeshes(scene: THREE.Group): SceneMeshData[] {
  const results: SceneMeshData[] = []
  let idx = 0
  scene.updateWorldMatrix(true, true)
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry && child.material) {
      results.push({
        id: idx++,
        geometry: child.geometry,
        material: child.material as THREE.Material,
        matrixWorld: child.matrixWorld.clone(),
      })
    }
  })
  return results
}

const MULTI_CUT_COLORS = [
  '#e63946',
  '#118ab2',
  '#ffd166',
  '#06d6a0',
  '#8338ec',
  '#fb8500',
  '#3a86ff',
  '#ef476f',
  '#8ac926',
  '#ff006e',
  '#ffbe0b',
  '#2ec4b6',
]

const DEFAULT_CUT_BODY_MASK_COLOR = '#ffffff'

function createForwardPlane(normal: THREE.Vector3, distance: number) {
  return new THREE.Plane(normal.clone(), -distance)
}

function createReversePlane(normal: THREE.Vector3, distance: number) {
  return new THREE.Plane(normal.clone().negate(), distance)
}

type SequentialCutLayer = {
  index: number
  startDistance: number
  endDistance: number
  color: string
  clippingPlanes: THREE.Plane[]
}

interface PreciseDualModeModelProps {
  modelUrl?: string
  cutDepth: number
  cutAngle: number
  showCutPlane?: boolean
  mode: 'cutBody' | 'cutFace'
  capColor?: string
  cutBodyMaskColor?: string
  showCutBodyWireframe?: boolean
  multiCutCount?: number
  cutR?: number
  cutFaceMultiStyle?: 'Face' | 'Body' | 'FaceAndBody' | 'faceOnly' | 'bodyOnly'
  faceOnlyBaseOpacity?: number
  cutFaceOverlayOpacity?: number
  cutBodyRemovedOpacity?: number
  cutBodyLayeredOpacity?: number
}

export function PreciseDualModeModel({
  modelUrl = '',
  cutDepth,
  cutAngle,
  showCutPlane = true,
  mode = 'cutFace',
  capColor = '#ff6b6b',
  cutBodyMaskColor = DEFAULT_CUT_BODY_MASK_COLOR,
  showCutBodyWireframe = false,
  multiCutCount = 0,
  cutR = 96,
  cutFaceMultiStyle = 'Face',
  faceOnlyBaseOpacity = 0.45,
  cutFaceOverlayOpacity = 0.82,
  cutBodyRemovedOpacity = 0.5,
  cutBodyLayeredOpacity = 0.72
}: PreciseDualModeModelProps) {
  const { scene } = useGLTF(modelUrl)

  // ═══════════════════════════════════════════════
  //  1. 原始场景的 geometry + material（用于渲染）
  // ═══════════════════════════════════════════════
  // ═══════════════════════════════════════════════
  //  1. 场景所有 mesh 的原始数据
  //     （保留 GLTF 层级结构）
  // ═══════════════════════════════════════════════
  const sceneMeshes = useMemo(() => {
    if (!scene) return []
    return collectAllMeshes(scene)
  }, [scene])

  // 将每个 mesh 的 world matrix 烘焙到 geometry（世界空间顶点）
  // 这样 group 的 PCA 变换可以正确作用于整个模型
  const bakedMeshData = useMemo(() => {
    return sceneMeshes.map((m) => {
      const geo = m.geometry.clone()
      geo.applyMatrix4(m.matrixWorld)
      return { id: m.id, geometry: geo, material: m.material }
    })
  }, [sceneMeshes])

  const mainMaterial = bakedMeshData.length > 0
    ? bakedMeshData[0].material as THREE.MeshPhysicalMaterial | undefined
    : undefined

  useEffect(() => {
    useGLTF.preload(modelUrl)
  }, [modelUrl])

  if (bakedMeshData.length === 0) return null

  const firstBakedGeom = bakedMeshData[0].geometry

  const effectiveMultiCutCount = Math.max(
    0,
    Math.floor(Number.isFinite(multiCutCount) ? multiCutCount : 0)
  )

  // ═══════════════════════════════════════════════
  //  2. 对齐数据（异步计算，不阻塞首帧渲染）
  //     克隆场景 → PCA 对齐 → BVH 切割 → 提取参数
  // ═══════════════════════════════════════════════
  const [alignedData, setAlignedData] = useState<{
    quaternion: THREE.Quaternion
    position: THREE.Vector3
    bvhResult: BVHVolumeResult | null
    bounds: THREE.Box3 | null
  } | null>(null)

  useEffect(() => {
    // 依赖变化时立即重置，模型先以原始姿态渲染
    setAlignedData(null)

    if (!scene || effectiveMultiCutCount <= 0 || cutDepth >= 100) {
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      try {
        // 克隆场景用于 PCA 对齐 + BVH 计算（不污染原始 scene）
        const cloned = scene.clone(true)
        const success = alignModelToGround(cloned)

        if (!success) {
          const box = getSceneBounds(cloned)
          if (box) {
            cloned.position.y -= box.min.y
            cloned.updateMatrix()
            cloned.updateWorldMatrix(true, true)
          }
        }

        const bvhResult = cpuExactEqualSlices(cloned, effectiveMultiCutCount, cutR)
        const bounds = getSceneBounds(cloned)

        if (!cancelled) {
          setAlignedData({
            quaternion: cloned.quaternion.clone(),
            position: cloned.position.clone(),
            bvhResult,
            bounds,
          })
        }
      } catch (err) {
        console.error('[alignedData] async computation error:', err)
      }
    }, 50) // 50ms 延迟，让首帧正常渲染后再计算

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [scene, effectiveMultiCutCount, cutR, cutDepth])

  // ═══════════════════════════════════════════════
  //  3. fitScale
  //     多刀模式用对齐后的 AABB；单刀模式用原始 geometry 的 AABB
  // ═══════════════════════════════════════════════
  const fitScale = useMemo(() => {
    let bounds: THREE.Box3 | null = null
    if (alignedData?.bounds) {
      bounds = alignedData.bounds
    } else if (firstBakedGeom) {
      firstBakedGeom.computeBoundingBox()
      bounds = firstBakedGeom.boundingBox ?? null
    }
    if (!bounds) return 1
    const size = new THREE.Vector3()
    bounds.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z)
    const targetSize = 6
    return maxDim > 0 ? targetSize / maxDim : 1
  }, [alignedData?.bounds, firstBakedGeom])

  // ═══════════════════════════════════════════════
  //  4. mesh.matrixWorld（用于裁剪平面空间变换）
  //     多刀模式：T(alignPos) * R(alignQuat) * S(fitScale)
  //     单刀模式：S(fitScale)
  // ═══════════════════════════════════════════════
  const meshMatrixWorld = useMemo(() => {
    const m = new THREE.Matrix4()
    const q = alignedData?.quaternion ?? new THREE.Quaternion()
    const p = alignedData?.position ?? new THREE.Vector3()
    const s = new THREE.Vector3(fitScale, fitScale, fitScale)
    m.compose(p, q, s)
    return m
  }, [alignedData?.quaternion, alignedData?.position, fitScale])

  // ═══════════════════════════════════════════════
  //  5. 切割方向
  //     多刀模式：BVH 轴方向（对齐空间中的 X 或 Z）
  //     单刀模式：cutAngle 对应方向
  // ═══════════════════════════════════════════════
  const sliceNormal = useMemo(() => {
    if (alignedData?.bvhResult) {
      return alignedData.bvhResult.axis === 'x'
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 0, 1)
    }
    const angleRad = (cutAngle * Math.PI) / 180
    return new THREE.Vector3(Math.cos(angleRad), 0, Math.sin(angleRad)).normalize()
  }, [alignedData?.bvhResult, cutAngle])

  // ═══════════════════════════════════════════════
  //  6. 投影范围
  //     多刀模式：来自对齐后 AABB 在切割轴上的投影
  //     单刀模式：来自原始 geometry 的 AABB 在 sliceNormal 上的投影
  // ═══════════════════════════════════════════════
  const projectionRange = useMemo(() => {
    if (alignedData?.bounds) {
      const box = alignedData.bounds
      const axis = alignedData.bvhResult!.axis
      const axi = axis === 'x' ? 0 : 2
      return {
        min: box.min.getComponent(axi),
        max: box.max.getComponent(axi),
      }
    }
    if (!firstBakedGeom) return null
    firstBakedGeom.computeBoundingBox()
    const box = firstBakedGeom.boundingBox!
    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ]
    let min = Infinity, max = -Infinity
    for (const c of corners) {
      const d = c.dot(sliceNormal)
      if (d < min) min = d
      if (d > max) max = d
    }
    return { min, max }
  }, [alignedData?.bounds, firstBakedGeom, sliceNormal])

  // 裁剪平面（单刀 cutDepth）
  const clippingPlane = useMemo(() => {
    if (cutDepth < 0 || cutDepth > 100 || !projectionRange) return null
    if (cutDepth === 0) return null
    if (cutDepth === 100) {
      return new THREE.Plane(sliceNormal.clone(), -(projectionRange.max + 0.01))
    }
    const range = projectionRange.max - projectionRange.min
    const planeDist = projectionRange.min + (range * cutDepth / 100)
    return new THREE.Plane(sliceNormal.clone(), -planeDist)
  }, [cutDepth, projectionRange, sliceNormal])

  // ═══════════════════════════════════════════════
  //  7. BVH 切面 → 本地空间裁剪平面
  //     将对齐世界空间的切面通过 matrixWorld^(-1) 映射到 mesh 本地空间
  // ═══════════════════════════════════════════════
  const localCutPlanes = useMemo((): THREE.Plane[] => {
    if (!alignedData?.bvhResult) return []
    const invMatrix = meshMatrixWorld.clone().invert()
    const axis = alignedData.bvhResult.axis
    const axisVec = axis === 'x'
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 0, 1)

    return alignedData.bvhResult.cutPlanes.map(pos => {
      const worldPlane = new THREE.Plane(axisVec.clone(), -pos)
      return worldPlane.applyMatrix4(invMatrix)
    })
  }, [alignedData?.bvhResult, meshMatrixWorld])

  // 本地空间中的 AABB 范围（用于确定切片的 start/end）
  const localAxisRange = useMemo(() => {
    if (!alignedData?.bvhResult || localCutPlanes.length === 0) return null
    // 用 mesh matrixWorld 将对齐空间的 AABB 角点映射到本地空间
    const invMatrix = meshMatrixWorld.clone().invert()
    const box = alignedData.bounds!
    const corners = [
      box.min, box.max,
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    ]
    // 将对齐空间的切割轴方向映射到本地空间
    const axis = alignedData.bvhResult.axis
    const axisVec = axis === 'x'
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 0, 1)
    const localNormal = axisVec.clone().transformDirection(invMatrix).normalize()

    let min = Infinity, max = -Infinity
    for (const c of corners) {
      const localCorner = c.clone().applyMatrix4(invMatrix)
      const d = localCorner.dot(localNormal)
      if (d < min) min = d
      if (d > max) max = d
    }
    return { min, max, normal: localNormal }
  }, [alignedData?.bvhResult, alignedData?.bounds, localCutPlanes, meshMatrixWorld])

  // ═══════════════════════════════════════════════
  //  8. Cut Body：N 刀等体积切片层
  // ═══════════════════════════════════════════════
  const sequentialCutLayers = useMemo(() => {
    if (
      mode !== 'cutBody' ||
      !localCutPlanes.length ||
      cutDepth >= 100 ||
      !localAxisRange
    ) {
      return [] as SequentialCutLayer[]
    }

    const { min: axisMin, max: axisMax, normal: localNormal } = localAxisRange
    const span = axisMax - axisMin
    if (span <= 0.0001) return [] as SequentialCutLayer[]

    const epsilon = Math.min(span * 0.001, 1e-4)
    const cuts = localCutPlanes
    const layers: SequentialCutLayer[] = []

    // 计算每层在本地空间中的距离
    const cutDistances = cuts.map(p => -p.constant / p.normal.dot(localNormal))

    for (let index = 0; index < cuts.length; index++) {
      const startDist = index === 0 ? axisMin + epsilon : cutDistances[index - 1]
      const endDist = cutDistances[index] - epsilon

      layers.push({
        index,
        startDistance: startDist,
        endDistance: endDist,
        color: MULTI_CUT_COLORS[index % MULTI_CUT_COLORS.length],
        clippingPlanes: [
          createForwardPlane(localNormal, startDist),
          createReversePlane(localNormal, endDist),
        ],
      })
    }

    console.log(`[sequentialCutLayers] ${layers.length} layers`)
    return layers
  }, [mode, localCutPlanes, localAxisRange, cutDepth])

  // ═══════════════════════════════════════════════
  //  9. Cut Face：N 刀等体积截面
  // ═══════════════════════════════════════════════
  const sequentialCutFaceLayers = useMemo(() => {
    type CutFaceLayer = { index: number; cutDistance: number; color: string; plane: THREE.Plane }
    if (
      mode !== 'cutFace' ||
      !localCutPlanes.length ||
      cutDepth >= 100 ||
      !localAxisRange
    ) {
      return [] as CutFaceLayer[]
    }

    const { normal: localNormal } = localAxisRange
    return localCutPlanes.map((plane, index) => {
      const dist = -plane.constant / plane.normal.dot(localNormal)
      return {
        index,
        cutDistance: dist,
        color: MULTI_CUT_COLORS[index % MULTI_CUT_COLORS.length],
        plane: plane.clone(),
      }
    })
  }, [mode, localCutPlanes, localAxisRange, cutDepth])

  // Cut Face stencil cap 数据
  const sequentialCapData = useMemo(() => {
    if (mode !== 'cutFace' || sequentialCutFaceLayers.length === 0 || !projectionRange) return []

    return sequentialCutFaceLayers.map((layer) => {
      const span = projectionRange.max - projectionRange.min
      const diagonal = span * 2

      const geometry = new THREE.PlaneGeometry(diagonal * 2, diagonal * 2, 1, 1)
      const quaternion = new THREE.Quaternion()
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), layer.plane.normal)
      geometry.applyQuaternion(quaternion)
      const pos = layer.plane.normal.clone().multiplyScalar(-layer.plane.constant)
      geometry.translate(pos.x, pos.y, pos.z)

      const stencilBack = new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        clippingPlanes: [layer.plane],
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        stencilZPass: THREE.IncrementWrapStencilOp,
      })

      const stencilFront = new THREE.MeshBasicMaterial({
        side: THREE.FrontSide,
        clippingPlanes: [layer.plane],
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        stencilZPass: THREE.DecrementWrapStencilOp,
      })

      const cap = new THREE.MeshBasicMaterial({
        color: layer.color,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1.0,
        depthWrite: true,
        depthTest: true,
        fog: false,
        stencilWrite: true,
        stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp,
        stencilZFail: THREE.ReplaceStencilOp,
        stencilZPass: THREE.ReplaceStencilOp,
      })

      return { geometry, stencilBack, stencilFront, cap }
    })
  }, [mode, sequentialCutFaceLayers, projectionRange])

  // Cut Face Body 样式
  const sequentialFaceBodySlabData = useMemo(() => {
    if (
      mode !== 'cutFace' ||
      sequentialCutFaceLayers.length === 0 ||
      !localAxisRange ||
      cutFaceMultiStyle === 'faceOnly'
    ) return [] as { index: number; color: string; clippingPlanes: THREE.Plane[] }[]

    const { min: axisMin, normal: localNormal } = localAxisRange
    const span = (projectionRange?.max ?? 0) - (projectionRange?.min ?? 0)
    const epsilon = Math.min(span * 0.001, 1e-4)

    return sequentialCutFaceLayers.map((layer, i) => {
      const startDist = i === 0 ? axisMin + epsilon : sequentialCutFaceLayers[i - 1].cutDistance
      const endDist = layer.cutDistance - epsilon
      return {
        index: i,
        color: layer.color,
        clippingPlanes: [
          createForwardPlane(localNormal, startDist),
          createReversePlane(localNormal, endDist),
        ],
      }
    })
  }, [mode, sequentialCutFaceLayers, localAxisRange, cutFaceMultiStyle, projectionRange])

  const sequentialFaceBodySlabMaterials = useMemo(() => {
    if (mode !== 'cutFace' || sequentialFaceBodySlabData.length === 0) return []

    const opacity = Math.min(1, Math.max(0.05, cutFaceOverlayOpacity))
    const emissiveIntensity = cutFaceMultiStyle === 'bodyOnly' ? 0.42 : 0.28

    return sequentialFaceBodySlabData.map((slab) => {
      const material = (mainMaterial?.clone() ?? new THREE.MeshStandardMaterial()) as THREE.MeshPhysicalMaterial
      const slabColor = new THREE.Color(slab.color)

      material.color = slabColor.clone()
      material.emissive = slabColor.clone()
      material.emissiveIntensity = emissiveIntensity
      material.side = THREE.DoubleSide
      material.transparent = true
      material.opacity = opacity
      material.clearcoat = 0.5
      material.clearcoatRoughness = 0.35
      material.clippingPlanes = slab.clippingPlanes
      material.clipIntersection = false
      material.clipShadows = true
      material.depthWrite = false
      material.needsUpdate = true

      return material
    })
  }, [mode, sequentialFaceBodySlabData, mainMaterial, cutFaceMultiStyle, cutFaceOverlayOpacity])

  const isMultiCutActive = mode === 'cutBody' && sequentialCutLayers.length > 0 && cutDepth < 100
  const isMultiCutFaceActive = mode === 'cutFace' && sequentialCutFaceLayers.length > 0 && cutDepth < 100
  const showMultiCutFaceCaps = isMultiCutFaceActive && cutFaceMultiStyle !== 'bodyOnly'
  const showMultiCutFaceSlabs = isMultiCutFaceActive && cutFaceMultiStyle !== 'faceOnly'
  const dimMainModelForFaceCuts = isMultiCutFaceActive && cutFaceMultiStyle !== 'bodyOnly'
  const clampedFaceOnlyBaseOpacity = Math.min(1, Math.max(0.05, faceOnlyBaseOpacity))
  const clampedCutBodyRemovedOpacity = Math.min(1, Math.max(0.05, cutBodyRemovedOpacity))
  const clampedCutBodyLayeredOpacity = Math.min(1, Math.max(0.05, cutBodyLayeredOpacity))

  // 主材质
  const cutMainMaterial = useMemo(() => {
    if (!mainMaterial) return null

    const material = mainMaterial.clone()

    const tailBoundaryDistance = isMultiCutActive
      ? (() => {
          const lastLayer = sequentialCutLayers[sequentialCutLayers.length - 1]
          const lastLayerSpan = Math.max(lastLayer.endDistance - lastLayer.startDistance, 0)
          const tailBoundaryBias = Math.max(lastLayerSpan * 0.001, 1e-7)
          return lastLayer.endDistance + tailBoundaryBias
        })()
      : null

    // 多刀模式：主材质用 localNormal（local clipping 空间）
    // 单刀模式：用 clippingPlane（已在 local space 中）
    const activePlane = isMultiCutActive
      ? createForwardPlane(localAxisRange!.normal, tailBoundaryDistance!)
      : clippingPlane

    if (activePlane) {
      material.clippingPlanes = [activePlane]
      material.clipShadows = true
      material.needsUpdate = true
    }

    if (mode === 'cutFace' && dimMainModelForFaceCuts) {
      material.transparent = true
      material.opacity = clampedFaceOnlyBaseOpacity
      material.depthWrite = false
      material.needsUpdate = true
    }

    return material
  }, [mainMaterial, clippingPlane, isMultiCutActive, localAxisRange, sequentialCutLayers, mode, dimMainModelForFaceCuts, clampedFaceOnlyBaseOpacity])

  const showCutSection = showCutPlane && cutDepth > 0 && cutDepth < 100
  const showMultiCutFaceSection = showCutPlane && cutDepth < 100

  // Cut Face 单刀截面
  const capGeometry = useMemo(() => {
    if (!clippingPlane || mode !== 'cutFace' || !projectionRange) return null

    const span = projectionRange.max - projectionRange.min
    const diagonal = span * 2

    const geometry = new THREE.PlaneGeometry(diagonal * 2, diagonal * 2, 1, 1)
    const quaternion = new THREE.Quaternion()
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), clippingPlane.normal)
    geometry.applyQuaternion(quaternion)
    const position = clippingPlane.normal.clone().multiplyScalar(-clippingPlane.constant)
    geometry.translate(position.x, position.y, position.z)

    return geometry
  }, [clippingPlane, mode, projectionRange])

  const capMaterial = useMemo(() => {
    if (!clippingPlane || mode !== 'cutFace') return null

    const material = new THREE.MeshBasicMaterial({
      color: capColor,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      depthTest: true,
      fog: false,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    })
    material.needsUpdate = true
    return material
  }, [clippingPlane, capColor, mode])

  const stencilBackMaterial = useMemo(() => {
    if (!clippingPlane || mode !== 'cutFace') return null
    const material = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      clippingPlanes: [clippingPlane],
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.IncrementWrapStencilOp,
    })
    material.needsUpdate = true
    return material
  }, [clippingPlane, mode])

  const stencilFrontMaterial = useMemo(() => {
    if (!clippingPlane || mode !== 'cutFace') return null
    const material = new THREE.MeshBasicMaterial({
      side: THREE.FrontSide,
      clippingPlanes: [clippingPlane],
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.DecrementWrapStencilOp,
    })
    material.needsUpdate = true
    return material
  }, [clippingPlane, mode])

  // Cut Body 单刀
  const cutBodyMaterial = useMemo(() => {
    if (!clippingPlane || mode !== 'cutBody') return null
    const reversePlane = new THREE.Plane(clippingPlane.normal.clone().negate(), -clippingPlane.constant)
    const material = (mainMaterial?.clone() ?? new THREE.MeshStandardMaterial()) as THREE.MeshPhysicalMaterial
    material.side = THREE.DoubleSide
    material.transparent = true
    material.opacity = clampedCutBodyRemovedOpacity
    material.clippingPlanes = [reversePlane]
    material.clipShadows = true
    material.emissive = new THREE.Color(cutBodyMaskColor)
    material.emissiveIntensity = 0.12
    material.clearcoat = 0.5
    material.clearcoatRoughness = 0.35
    material.needsUpdate = true
    return material
  }, [clippingPlane, mode, mainMaterial, clampedCutBodyRemovedOpacity, cutBodyMaskColor])

  const cutBodyCapMaterial = useMemo(() => {
    if (!clippingPlane || mode !== 'cutBody') return null
    const reversePlane = new THREE.Plane(clippingPlane.normal.clone().negate(), -clippingPlane.constant)
    const sectionColor = new THREE.Color(cutBodyMaskColor)
    const material = new THREE.MeshStandardMaterial({
      color: sectionColor,
      emissive: sectionColor.clone(),
      emissiveIntensity: 0.2,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1.0,
      roughness: 0.35,
      metalness: 0.15,
      depthWrite: true,
      depthTest: true,
      fog: false,
      clippingPlanes: [reversePlane],
      clipShadows: true,
    })
    material.needsUpdate = true
    return material
  }, [clippingPlane, mode, cutBodyMaskColor])

  const sequentialCutMaterials = useMemo(() => {
    if (mode !== 'cutBody' || sequentialCutLayers.length === 0) return [] as THREE.MeshPhysicalMaterial[]

    return sequentialCutLayers.map((layer) => {
      const material = (mainMaterial?.clone() ?? new THREE.MeshStandardMaterial()) as THREE.MeshPhysicalMaterial
      const layerColor = new THREE.Color(layer.color)
      const baseColor = (mainMaterial?.color.clone() ?? new THREE.Color())
      const tintStrength = clampedCutBodyLayeredOpacity

      material.color = baseColor.lerp(layerColor, tintStrength)
      material.emissive = layerColor.clone()
      material.emissiveIntensity = 0.08 + (0.12 * tintStrength)
      material.side = THREE.DoubleSide
      material.transparent = false
      material.opacity = 1.0
      material.roughness = 0.22
      material.metalness = 0.08
      material.clearcoat = 0.5
      material.clearcoatRoughness = 0.35
      material.clippingPlanes = layer.clippingPlanes
      material.clipIntersection = false
      material.clipShadows = true
      material.depthWrite = true
      material.polygonOffset = true
      material.polygonOffsetFactor = -1
      material.polygonOffsetUnits = -1
      material.needsUpdate = true

      return material
    })
  }, [mode, sequentialCutLayers, mainMaterial, clampedCutBodyLayeredOpacity])

  if (!cutMainMaterial) return null

  // ── 辅助：渲染所有烘焙后的 mesh（每个材质变体一份） ──
  const renderAllMeshes = (material: THREE.Material | null, extraProps?: Record<string, unknown>) => {
    if (!material || bakedMeshData.length === 0) return null
    return (
      <>
        {bakedMeshData.map((m) => (
          <mesh key={`m-${m.id}`} geometry={m.geometry} material={material} {...extraProps} />
        ))}
      </>
    )
  }

  // ═══════════════════════════════════════════════
  //  渲染：使用所有烘焙后的 mesh + mainMaterial
  //  多刀模式时在 group 上添加对齐变换
  // ═══════════════════════════════════════════════
  return (
    <group
      dispose={null}
      scale={fitScale}
      quaternion={alignedData?.quaternion}
      position={alignedData?.position}
    >
      {/* 主模型（所有 mesh） */}
      {renderAllMeshes(cutMainMaterial, { castShadow: true, receiveShadow: true })}

      {/* Cut Body 单刀 */}
      {mode === 'cutBody' && cutBodyMaterial && cutBodyCapMaterial && showCutSection && (
        <>
          {renderAllMeshes(cutBodyMaterial, { renderOrder: 1 })}

          {showCutBodyWireframe && (
            <>
              {bakedMeshData.map((m) => (
                <mesh key={`wire-${m.id}`} geometry={m.geometry} renderOrder={2}>
                  <meshBasicMaterial
                    color="#ffffff"
                    wireframe={true}
                    transparent={true}
                    opacity={0.5}
                    clippingPlanes={[new THREE.Plane(
                      clippingPlane!.normal.clone().negate(),
                      -clippingPlane!.constant
                    )]}
                  />
                </mesh>
              ))}
            </>
          )}

          {renderAllMeshes(cutBodyCapMaterial, {
            renderOrder: showCutBodyWireframe ? 3 : 2,
          })}
        </>
      )}

      {/* Cut Body N 刀等体积切片 */}
      {isMultiCutActive && (
        <>
          {sequentialCutLayers.map((layer, index) => (
            <React.Fragment key={`seq-cut-${layer.index}`}>
              {renderAllMeshes(sequentialCutMaterials[index], { renderOrder: 10 + index * 2 })}
            </React.Fragment>
          ))}

          {showCutBodyWireframe && sequentialCutLayers.map((layer) => (
            <React.Fragment key={`seq-wire-${layer.index}`}>
              {bakedMeshData.map((m) => (
                <mesh
                  key={`seq-wire-m-${m.id}-${layer.index}`}
                  geometry={m.geometry}
                  renderOrder={11 + layer.index * 2}
                >
                  <meshBasicMaterial
                    color={layer.color}
                    wireframe={true}
                    transparent={true}
                    opacity={0.32}
                    clippingPlanes={layer.clippingPlanes}
                    clipIntersection={false}
                  />
                </mesh>
              ))}
            </React.Fragment>
          ))}
        </>
      )}

      {/* Cut Face 单刀 stencil */}
      {mode === 'cutFace' && stencilBackMaterial && showCutSection && (
        renderAllMeshes(stencilBackMaterial, { renderOrder: 1 })
      )}

      {mode === 'cutFace' && stencilFrontMaterial && showCutSection && (
        renderAllMeshes(stencilFrontMaterial, { renderOrder: 2 })
      )}

      {mode === 'cutFace' && capGeometry && capMaterial && clippingPlane && showCutSection && (
        <mesh
          geometry={capGeometry}
          material={capMaterial}
          renderOrder={3}
          onAfterRender={(renderer: THREE.WebGLRenderer) => {
            renderer.clearStencil()
          }}
        />
      )}

      {/* Cut Face N 刀等体积截面（stencil） */}
      {showMultiCutFaceCaps && showMultiCutFaceSection && sequentialCapData.map((capData, index) => {
        const baseOrder = 4 + index * 3
        return (
          <React.Fragment key={`cut-face-multi-${sequentialCutFaceLayers[index].index}`}>
            {renderAllMeshes(capData.stencilBack, { renderOrder: baseOrder })}
            {renderAllMeshes(capData.stencilFront, { renderOrder: baseOrder + 1 })}
            <mesh
              geometry={capData.geometry}
              material={capData.cap}
              renderOrder={baseOrder + 2}
              onAfterRender={(renderer: THREE.WebGLRenderer) => {
                renderer.clearStencil()
              }}
            />
          </React.Fragment>
        )
      })}

      {/* Cut Face N 刀等体积实体覆盖层 */}
      {showMultiCutFaceSlabs && showMultiCutFaceSection && sequentialFaceBodySlabMaterials.map((material, index) => (
        <React.Fragment key={`slab-${index}`}>
          {renderAllMeshes(material, { renderOrder: 50 + index * 2 })}
        </React.Fragment>
      ))}
    </group>
  )
}
