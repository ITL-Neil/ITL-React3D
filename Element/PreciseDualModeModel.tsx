import React, { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { GLTF } from 'three-stdlib'

// ⚠️ 关键：计算几何体体积的函数
function computeGeometryVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.attributes.position
  if (!position) return 0

  let volume = 0
  const p1 = new THREE.Vector3()
  const p2 = new THREE.Vector3()
  const p3 = new THREE.Vector3()

  // 遍历所有三角形面片
  for (let i = 0; i < position.count; i += 3) {
    p1.fromBufferAttribute(position, i)
    p2.fromBufferAttribute(position, i + 1)
    p3.fromBufferAttribute(position, i + 2)

    // 使用叉乘计算四面体体积（相对于原点）
    volume += p1.dot(p2.cross(p3)) / 6.0
  }

  return Math.abs(volume)
}

// ⚠️ 关键：预计算沿法线方向的体积分布（高性能 + 准确）
// 原理：将模型沿法线方向分成 N 层，预计算每层的体积，构建累积分布表
function buildVolumeDistribution(
  geometry: THREE.BufferGeometry,
  normal: THREE.Vector3,
  layers: number = 1000  // 分层数量，越多越精确
): { positions: number[]; cumulativeVolumes: number[]; totalVolume: number } {
  const position = geometry.attributes.position
  if (!position) return { positions: [], cumulativeVolumes: [], totalVolume: 0 }

  // 计算包围盒
  geometry.computeBoundingBox()
  if (!geometry.boundingBox) return { positions: [], cumulativeVolumes: [], totalVolume: 0 }
  
  const box = geometry.boundingBox
  
  // 计算模型在法线方向的投影范围
  let minDist = Infinity
  let maxDist = -Infinity
  
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
  
  corners.forEach(corner => {
    const dist = corner.dot(normal)
    minDist = Math.min(minDist, dist)
    maxDist = Math.max(maxDist, dist)
  })
  
  const span = maxDist - minDist
  if (span <= 0.0001) return { positions: [], cumulativeVolumes: [], totalVolume: 0 }
  
  // 为每个三角形预计算其在法线方向的投影范围
  const triangles: { dist: number[]; volume: number }[] = []
  
  for (let i = 0; i < position.count; i += 3) {
    const p1 = new THREE.Vector3().fromBufferAttribute(position, i)
    const p2 = new THREE.Vector3().fromBufferAttribute(position, i + 1)
    const p3 = new THREE.Vector3().fromBufferAttribute(position, i + 2)
    
    // 计算三角形在法线方向的投影距离
    const d1 = p1.dot(normal)
    const d2 = p2.dot(normal)
    const d3 = p3.dot(normal)
    
    // 计算三角形的有向体积（相对于原点）
    const vol = Math.abs(p1.dot(p2.cross(p3)) / 6.0)
    
    triangles.push({
      dist: [d1, d2, d3],
      volume: vol
    })
  }
  
  // 构建累积体积分布
  const positions: number[] = []
  const cumulativeVolumes: number[] = []
  
  // ⚠️ 关键修复：先计算总体积（一次性）
  let totalVolume = 0
  for (const tri of triangles) {
    totalVolume += tri.volume
  }
  
  // 对于每一层，计算从 minDist 到 currentDist 的累积体积
  for (let i = 0; i <= layers; i++) {
    const t = i / layers
    const currentDist = minDist + t * span
    
    // 计算从 minDist 到 currentDist 之间的累积体积
    let cumVolume = 0
    
    for (const tri of triangles) {
      const [d1, d2, d3] = tri.dist
      const triMinDist = Math.min(d1, d2, d3)
      const triMaxDist = Math.max(d1, d2, d3)
      
      // 如果三角形完全在 currentDist 之前，全部计入
      if (triMaxDist <= currentDist) {
        cumVolume += tri.volume
      } 
      // 如果三角形与 currentDist 相交，按比例计入
      else if (triMinDist < currentDist && triMaxDist > currentDist) {
        const overlapRatio = (currentDist - triMinDist) / (triMaxDist - triMinDist)
        cumVolume += tri.volume * overlapRatio
      }
      // 否则三角形在 currentDist 之后，不计入
    }
    
    positions.push(currentDist)
    cumulativeVolumes.push(cumVolume)
  }
  
  return {
    positions,
    cumulativeVolumes,
    totalVolume
  }
}

// ⚠️ 关键：使用预计算的体积分布快速查找切割位置
function findCutPositionByVolume(
  distribution: { positions: number[]; cumulativeVolumes: number[]; totalVolume: number },
  targetVolume: number,
  startDist: number,
  startVolume: number
): number {
  const { positions, cumulativeVolumes } = distribution
  
  // 二分查找找到目标体积对应的位置
  let low = 0
  let high = positions.length - 1
  
  // 找到 startDist 对应的索引
  let startIndex = 0
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] >= startDist) {
      startIndex = i
      break
    }
  }
  
  const targetCumVolume = startVolume + targetVolume
  
  // 在 startIndex 之后二分查找
  low = startIndex
  high = positions.length - 1
  
  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2)
    if (cumulativeVolumes[mid] < targetCumVolume) {
      low = mid
    } else {
      high = mid
    }
  }
  
  // 线性插值得到精确位置
  const v1 = cumulativeVolumes[low]
  const v2 = cumulativeVolumes[high]
  const p1 = positions[low]
  const p2 = positions[high]
  
  if (v2 === v1) return p1
  
  const t = (targetCumVolume - v1) / (v2 - v1)
  return p1 + t * (p2 - p1)
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

const DEFAULT_MODEL_URL = '/Hohenzollern_Castle_optimized.glb'
const DEFAULT_CUT_BODY_MASK_COLOR = '#ffffff'

function getProjectionRange(box: THREE.Box3, normal: THREE.Vector3) {
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

  let min = Infinity
  let max = -Infinity

  corners.forEach((corner) => {
    const dist = corner.dot(normal)
    min = Math.min(min, dist)
    max = Math.max(max, dist)
  })

  return { min, max }
}

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

type GLTFResult = GLTF & {
  nodes: {
    HZ3: THREE.Mesh
  }
  materials: {
    HZ3_Material_u1_v1: THREE.MeshPhysicalMaterial
  }
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
  /** Cut Face 多刀模式的显示样式：
   *  'faceOnly'  - 只显示彩色截面，并降低主模型不透明度
   *  'bodyOnly'  - 只显示彩色实体覆盖层（增强可见性）
   *  'both'      - 同时显示截面和实体覆盖层
   */
  cutFaceMultiStyle?: 'faceOnly' | 'bodyOnly' | 'both'
  // Cut Face 多刀模式下主模型不透明度（faceOnly / both，0~1）
  faceOnlyBaseOpacity?: number
  // Cut Face 多刀覆盖层透明度（bodyOnly / both，0~1）
  cutFaceOverlayOpacity?: number
  // Cut Body：cut depth 被切除体覆盖层透明度（0~1）
  cutBodyRemovedOpacity?: number
  // Cut Body：N 刀分层覆盖透明度（0~1）
  cutBodyLayeredOpacity?: number
}

export function PreciseDualModeModel({ 
  modelUrl = DEFAULT_MODEL_URL,
  cutDepth,
  cutAngle, 
  showCutPlane = true,
  mode = 'cutFace',
  capColor = '#ff6b6b',
  cutBodyMaskColor = DEFAULT_CUT_BODY_MASK_COLOR,
  showCutBodyWireframe = false,
  multiCutCount = 0,
  cutFaceMultiStyle = 'faceOnly',
  faceOnlyBaseOpacity = 0.45,
  cutFaceOverlayOpacity = 0.82,
  cutBodyRemovedOpacity = 0.5,
  cutBodyLayeredOpacity = 0.72
}: PreciseDualModeModelProps) {
  const { nodes, materials } = useGLTF(modelUrl) as GLTFResult

  useEffect(() => {
    useGLTF.preload(modelUrl)
  }, [modelUrl])

  // 计算模型的包围盒
  const modelBounds = useMemo(() => {
    if (!nodes.HZ3.geometry) return null
    
    const geometry = nodes.HZ3.geometry
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    
    if (!box) return null
    
    return { box }
  }, [nodes.HZ3.geometry])

  const cutNormal = useMemo(() => {
    const angleRad = (cutAngle * Math.PI) / 180
    return new THREE.Vector3(
      Math.cos(angleRad),
      0,
      Math.sin(angleRad)
    ).normalize()
  }, [cutAngle])

  const projectionRange = useMemo(() => {
    if (!modelBounds) return null
    return getProjectionRange(modelBounds.box, cutNormal)
  }, [modelBounds, cutNormal])

  const effectiveMultiCutCount = Math.max(
    0,
    Math.floor(Number.isFinite(multiCutCount) ? multiCutCount : 0)
  )

  // 裁剪平面计算
  const clippingPlane = useMemo(() => {
    if (cutDepth < 0 || cutDepth > 100 || !projectionRange) return null
    
    // 深度为 0 时不切割，返回 null
    if (cutDepth === 0) return null
    
    // ⚠️ 关键：深度为 100 时，将平面移到模型之外，确保完全不显示
    if (cutDepth === 100) {
      const planeDist = projectionRange.max + 0.01
      const constant = -planeDist
      
      console.log('✂️ 裁剪平面 (100%):', { 
        mode,
        cutDepth,
        normal: cutNormal.toArray(), 
        constant,
        description: '完全切掉'
      })
      
      return new THREE.Plane(cutNormal.clone(), constant)
    }

    const range = projectionRange.max - projectionRange.min
    const planeDist = projectionRange.min + (range * cutDepth / 100)
    const constant = -planeDist
    
    console.log('✂️ 裁剪平面:', { 
      mode,
      cutDepth, 
      cutAngle,
      normal: cutNormal.toArray(), 
      constant,
      planeDist,
      minDist: projectionRange.min,
      maxDist: projectionRange.max,
      description: cutDepth === 0 ? '不切割' : cutDepth === 100 ? '全切' : `切掉${cutDepth}%`
    })
    
    return new THREE.Plane(cutNormal.clone(), constant)
  }, [cutDepth, cutAngle, projectionRange, cutNormal, mode])

  // ⚠️ 关键：预计算体积分布（只计算一次）
  const volumeDistribution = useMemo(() => {
    if (!nodes.HZ3.geometry) return null
    return buildVolumeDistribution(nodes.HZ3.geometry, cutNormal, 100)
  }, [nodes.HZ3.geometry, cutNormal])

  const sequentialCutLayers = useMemo(() => {
    if (
      mode !== 'cutBody' ||
      !projectionRange ||
      cutDepth >= 100 ||
      effectiveMultiCutCount <= 0 ||
      !volumeDistribution
    ) {
      return [] as SequentialCutLayer[]
    }

    const { positions, cumulativeVolumes, totalVolume } = volumeDistribution

    // clippingPlane 保留 dot(normal,p) >= planeDist（高值侧 = 剩余体）
    const remainingMin = cutDepth === 0
      ? projectionRange.min
      : (clippingPlane ? -clippingPlane.constant : projectionRange.min)
    const remainingMax = projectionRange.max
    const remainingSpan = remainingMax - remainingMin

    if (remainingSpan <= 0.0001) return [] as SequentialCutLayer[]

    // 找到 remainingMin 对应的累积体积
    let startVolume = 0
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= remainingMin) {
        startVolume = i > 0 ? cumulativeVolumes[i - 1] : 0
        break
      }
    }

    // 计算剩余部分的总体积
    let endVolume = totalVolume
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= remainingMax) {
        endVolume = cumulativeVolumes[i]
        break
      }
    }

    const actualTotalVolume = endVolume - startVolume
    
    if (actualTotalVolume <= 0.0001) {
      console.warn('⚠️ 剩余体积太小，无法分割')
      return [] as SequentialCutLayer[]
    }

    // 目标：每份切片的体积相等
    const targetVolumePerSlice = actualTotalVolume / (effectiveMultiCutCount + 1)
    
    console.log('📊 体积分割信息:', {
      totalVolume: actualTotalVolume.toFixed(2),
      targetVolumePerSlice: targetVolumePerSlice.toFixed(2),
      numSlices: effectiveMultiCutCount + 1,
      remainingMin,
      remainingMax
    })

    const layers: SequentialCutLayer[] = []
    let currentStartDistance = remainingMin
    let currentVolume = startVolume

    // 对于每个切片，使用预计算的体积分布快速查找位置
    for (let index = 0; index < effectiveMultiCutCount; index += 1) {
      // 使用预计算的分布表快速找到目标位置
      const targetCumVolume = currentVolume + targetVolumePerSlice
      const bestEndDistance = findCutPositionByVolume(
        volumeDistribution,
        targetVolumePerSlice,
        currentStartDistance,
        currentVolume
      )
      
      // 添加微小间隙避免闪烁
      const epsilon = Math.min(remainingSpan * 0.001, 1e-4)
      const adjustedStart = index === 0 ? currentStartDistance + epsilon : currentStartDistance
      const adjustedEnd = bestEndDistance - epsilon

      // 估算实际体积（从分布表中查找）
      let endVol = 0
      for (let i = 0; i < positions.length; i++) {
        if (positions[i] >= bestEndDistance) {
          endVol = cumulativeVolumes[i]
          break
        }
      }
      const actualVolume = endVol - currentVolume

      console.log(`  📐 切片 ${index}:`, {
        start: currentStartDistance.toFixed(3),
        end: bestEndDistance.toFixed(3),
        width: (bestEndDistance - currentStartDistance).toFixed(3),
        volume: actualVolume.toFixed(2),
        targetVolume: targetVolumePerSlice.toFixed(2),
        error: ((actualVolume - targetVolumePerSlice) / targetVolumePerSlice * 100).toFixed(1) + '%'
      })

      layers.push({
        index,
        startDistance: adjustedStart,
        endDistance: adjustedEnd,
        color: MULTI_CUT_COLORS[index % MULTI_CUT_COLORS.length],
        clippingPlanes: [
          createForwardPlane(cutNormal, adjustedStart),
          createReversePlane(cutNormal, adjustedEnd),
        ],
      })

      // 更新下一个切片的起始位置和体积
      currentStartDistance = bestEndDistance
      currentVolume = endVol
    }

    console.log('✅ 体积分割完成，共', layers.length, '个切片')

    return layers
  }, [mode, projectionRange, clippingPlane, cutDepth, effectiveMultiCutCount, cutNormal, volumeDistribution])

  // ⚠️ Cut Face 模式：等体积 N 刀，每刀生成一个切割平面位置
  const sequentialCutFaceLayers = useMemo(() => {
    type CutFaceLayer = { index: number; cutDistance: number; color: string; plane: THREE.Plane }
    if (
      mode !== 'cutFace' ||
      !projectionRange ||
      cutDepth >= 100 ||
      effectiveMultiCutCount <= 0 ||
      !volumeDistribution
    ) {
      return [] as CutFaceLayer[]
    }

    const { positions, cumulativeVolumes, totalVolume } = volumeDistribution

    const remainingMin = cutDepth === 0
      ? projectionRange.min
      : (clippingPlane ? -clippingPlane.constant : projectionRange.min)
    const remainingMax = projectionRange.max
    const remainingSpan = remainingMax - remainingMin

    if (remainingSpan <= 0.0001) return [] as CutFaceLayer[]

    let startVolume = 0
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= remainingMin) {
        startVolume = i > 0 ? cumulativeVolumes[i - 1] : 0
        break
      }
    }

    let endVolume = totalVolume
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= remainingMax) {
        endVolume = cumulativeVolumes[i]
        break
      }
    }

    const actualTotalVolume = endVolume - startVolume
    if (actualTotalVolume <= 0.0001) return [] as CutFaceLayer[]

    const targetVolumePerSlice = actualTotalVolume / (effectiveMultiCutCount + 1)

    const layers: CutFaceLayer[] = []
    let currentStartDistance = remainingMin
    let currentVolume = startVolume

    for (let index = 0; index < effectiveMultiCutCount; index++) {
      const cutDistance = findCutPositionByVolume(
        volumeDistribution,
        targetVolumePerSlice,
        currentStartDistance,
        currentVolume
      )

      layers.push({
        index,
        cutDistance,
        color: MULTI_CUT_COLORS[index % MULTI_CUT_COLORS.length],
        plane: new THREE.Plane(cutNormal.clone(), -cutDistance),
      })

      let endVol = totalVolume
      for (let i = 0; i < positions.length; i++) {
        if (positions[i] >= cutDistance) {
          endVol = cumulativeVolumes[i]
          break
        }
      }

      currentStartDistance = cutDistance
      currentVolume = endVol
    }

    console.log('✅ Cut Face 体积分割完成，共', layers.length, '个截面')
    return layers
  }, [mode, projectionRange, clippingPlane, cutDepth, effectiveMultiCutCount, cutNormal, volumeDistribution])

  // ⚠️ Cut Face 模式：为每个内切面生成 stencil 材质和 cap 几何体
  const sequentialCapData = useMemo(() => {
    if (mode !== 'cutFace' || sequentialCutFaceLayers.length === 0 || !modelBounds) return []

    return sequentialCutFaceLayers.map((layer) => {
      const box = modelBounds.box
      const diagonal = Math.sqrt(
        Math.pow(box.max.x - box.min.x, 2) +
        Math.pow(box.max.y - box.min.y, 2) +
        Math.pow(box.max.z - box.min.z, 2)
      )

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
  }, [mode, sequentialCutFaceLayers, modelBounds])

  // ⚠️ Cut Face Body 样式：将 N 个截面位置转换为 N 个实体叠加色块（同 Cut Body 的 sequentialCutLayers）
  // faceOnly 模式下也会生成，但透明度更低，仅用于压暗切割区域使截面更清晰可见
  const sequentialFaceBodySlabData = useMemo(() => {
    if (
      mode !== 'cutFace' ||
      sequentialCutFaceLayers.length === 0 ||
      !projectionRange ||
      cutFaceMultiStyle === 'faceOnly'
    ) return [] as { index: number; color: string; clippingPlanes: THREE.Plane[] }[]

    const remainingMin = cutDepth === 0
      ? projectionRange.min
      : (clippingPlane ? -clippingPlane.constant : projectionRange.min)
    const remainingSpan = projectionRange.max - remainingMin
    const epsilon = Math.min(remainingSpan * 0.001, 1e-4)

    return sequentialCutFaceLayers.map((layer, i) => {
      const startDist = i === 0
        ? remainingMin + epsilon
        : sequentialCutFaceLayers[i - 1].cutDistance
      const endDist = layer.cutDistance - epsilon
      return {
        index: i,
        color: layer.color,
        clippingPlanes: [
          createForwardPlane(cutNormal, startDist),
          createReversePlane(cutNormal, endDist),
        ],
      }
    })
  }, [mode, sequentialCutFaceLayers, projectionRange, clippingPlane, cutDepth, cutNormal, cutFaceMultiStyle])

  const sequentialFaceBodySlabMaterials = useMemo(() => {
    if (mode !== 'cutFace' || sequentialFaceBodySlabData.length === 0) return []

    // bodyOnly / both 均支持用户调节覆盖层透明度
    const opacity = Math.min(1, Math.max(0.05, cutFaceOverlayOpacity))
    const emissiveIntensity = cutFaceMultiStyle === 'bodyOnly' ? 0.42 : 0.28

    return sequentialFaceBodySlabData.map((slab) => {
      const material = materials.HZ3_Material_u1_v1.clone()
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
  }, [mode, sequentialFaceBodySlabData, materials.HZ3_Material_u1_v1, cutFaceMultiStyle, cutFaceOverlayOpacity])

  const isMultiCutActive = mode === 'cutBody' && sequentialCutLayers.length > 0 && cutDepth < 100
  const isMultiCutFaceActive = mode === 'cutFace' && sequentialCutFaceLayers.length > 0 && cutDepth < 100
  const showMultiCutFaceCaps = isMultiCutFaceActive && cutFaceMultiStyle !== 'bodyOnly'
  const showMultiCutFaceSlabs = isMultiCutFaceActive && cutFaceMultiStyle !== 'faceOnly'
  const dimMainModelForFaceCuts = isMultiCutFaceActive && cutFaceMultiStyle !== 'bodyOnly'
  const clampedFaceOnlyBaseOpacity = Math.min(1, Math.max(0.05, faceOnlyBaseOpacity))
  const clampedCutBodyRemovedOpacity = Math.min(1, Math.max(0.05, cutBodyRemovedOpacity))
  const clampedCutBodyLayeredOpacity = Math.min(1, Math.max(0.05, cutBodyLayeredOpacity))

  // 主材质 - 始终应用裁剪
  const mainMaterial = useMemo(() => {
    if (!materials.HZ3_Material_u1_v1) return null

    const material = materials.HZ3_Material_u1_v1.clone()

    // Slightly push the tail start inward to avoid coplanar overlap with the last colored slice.
    const tailBoundaryDistance = isMultiCutActive
      ? (() => {
          const lastLayer = sequentialCutLayers[sequentialCutLayers.length - 1]
          const lastLayerSpan = Math.max(lastLayer.endDistance - lastLayer.startDistance, 0)
          const tailBoundaryBias = Math.max(lastLayerSpan * 0.001, 1e-7)
          return lastLayer.endDistance + tailBoundaryBias
        })()
      : null

    const activePlane = isMultiCutActive
      ? createForwardPlane(cutNormal, tailBoundaryDistance!)
      : clippingPlane

    if (activePlane) {
      material.clippingPlanes = [activePlane]
      material.clipShadows = true
      material.needsUpdate = true
    }

    // FaceOnly / Both: 降低主模型不透明度，让彩色截面更容易被看见
    if (mode === 'cutFace' && dimMainModelForFaceCuts) {
      material.transparent = true
      material.opacity = clampedFaceOnlyBaseOpacity
      material.depthWrite = false
      material.needsUpdate = true
    }

    return material
  }, [materials.HZ3_Material_u1_v1, clippingPlane, isMultiCutActive, cutNormal, sequentialCutLayers, mode, dimMainModelForFaceCuts, clampedFaceOnlyBaseOpacity])

  const showCutSection = showCutPlane && cutDepth > 0 && cutDepth < 100
  // Multi-cut face caps/slabs should also work at depth 0 (full-body range split).
  const showMultiCutFaceSection = showCutPlane && cutDepth < 100

  // Cut Face 模式：创建与裁剪面重合的大平面，最终由 stencil 裁成精确轮廓
  const capGeometry = useMemo(() => {
    if (!clippingPlane || mode !== 'cutFace' || !modelBounds) return null

    const box = modelBounds.box
    const diagonal = Math.sqrt(
      Math.pow(box.max.x - box.min.x, 2) +
      Math.pow(box.max.y - box.min.y, 2) +
      Math.pow(box.max.z - box.min.z, 2)
    )

    const geometry = new THREE.PlaneGeometry(diagonal * 2, diagonal * 2, 1, 1)

    const quaternion = new THREE.Quaternion()
    quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      clippingPlane.normal
    )
    geometry.applyQuaternion(quaternion)

    const position = clippingPlane.normal.clone().multiplyScalar(-clippingPlane.constant)
    geometry.translate(position.x, position.y, position.z)

    return geometry
  }, [clippingPlane, mode, modelBounds])

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

  // 用前/后面双通道写 stencil，得到切割截面的精确掩码
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



  // Cut Body 模式：保留原材质颜色，仅叠加轻微高亮特效
  const cutBodyMaterial = useMemo(() => {
    if (!clippingPlane || mode !== 'cutBody') return null

    const reversePlane = new THREE.Plane(
      clippingPlane.normal.clone().negate(),
      -clippingPlane.constant
    )

    const material = materials.HZ3_Material_u1_v1.clone()
    material.side = THREE.DoubleSide
    material.transparent = true
    material.opacity = clampedCutBodyRemovedOpacity
    material.clippingPlanes = [reversePlane]
    material.clipShadows = true

    // 轻微冷色发光，保留原本纹理与颜色层次
    material.emissive = new THREE.Color(cutBodyMaskColor)
    material.emissiveIntensity = 0.12
    material.clearcoat = 0.5
    material.clearcoatRoughness = 0.35

    material.needsUpdate = true

    console.log('🔵 切割体材质:', {
      type: material.type,
      color: '#' + material.color.getHexString(),
      opacity: material.opacity,
      transparent: material.transparent,
      clippingPlanes: 'reverse',
      note: '保留原材质并叠加轻微高亮'
    })

    return material
  }, [clippingPlane, mode, materials.HZ3_Material_u1_v1, clampedCutBodyRemovedOpacity, cutBodyMaskColor])

  // Cut Body 截面填充：使用原材质颜色的提亮版，避免纯红色块
  const cutBodyCapMaterial = useMemo(() => {
    if (!clippingPlane || mode !== 'cutBody') return null

    // 创建反向裁剪平面（只保留截面部分）
    const reversePlane = new THREE.Plane(
      clippingPlane.normal.clone().negate(),
      -clippingPlane.constant
    )

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

    console.log('🟡 切割体截面材质:', {
      type: material.type,
      color: '#' + material.color.getHexString(),
      clippingPlanes: 'reverse (single plane)',
      side: 'DoubleSide',
      note: '原色提亮的截面填充'
    })

    return material
  }, [clippingPlane, mode, cutBodyMaskColor])

  const sequentialCutMaterials = useMemo(() => {
    if (mode !== 'cutBody' || sequentialCutLayers.length === 0) return [] as THREE.MeshPhysicalMaterial[]

    return sequentialCutLayers.map((layer) => {
      const material = materials.HZ3_Material_u1_v1.clone()
      const layerColor = new THREE.Color(layer.color)
      const baseColor = materials.HZ3_Material_u1_v1.color.clone()
      const tintStrength = clampedCutBodyLayeredOpacity

      // Keep the original surface visible, and use the slider as tint strength for the new pure color.
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
      // Three.js clipping with this plane pair uses clipIntersection=false to keep slab interval.
      material.clipIntersection = false
      material.clipShadows = true
      // Write depth for clearer slab separation; polygon offset avoids coplanar flicker.
      material.depthWrite = true
      material.polygonOffset = true
      material.polygonOffsetFactor = -1
      material.polygonOffsetUnits = -1
      material.needsUpdate = true

      return material
    })
  }, [mode, sequentialCutLayers, materials.HZ3_Material_u1_v1, clampedCutBodyLayeredOpacity])

  if (!mainMaterial) return null

  return (
    <group dispose={null}>
      {/* 主模型 */}
      <mesh
        geometry={nodes.HZ3.geometry}
        material={mainMaterial}
        castShadow
        receiveShadow
      />

      {/* 原始 Cut Body：蓝色透明层 + 白色截面填充，统一受 showCutSection 控制 */}
      {mode === 'cutBody' && cutBodyMaterial && cutBodyCapMaterial && showCutSection && (
        <>
          <mesh
            geometry={nodes.HZ3.geometry}
            material={cutBodyMaterial}
            renderOrder={1}
          />

          {showCutBodyWireframe && (
            <mesh
              geometry={nodes.HZ3.geometry}
              renderOrder={2}
            >
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
          )}

          <mesh
            geometry={nodes.HZ3.geometry}
            material={cutBodyCapMaterial}
            renderOrder={showCutBodyWireframe ? 3 : 2}
          />
        </>
      )}

      {/* 在 Cut Body 剩余部分（或完整模型）上继续切 N 刀 */}
      {isMultiCutActive && (
        <>
          {sequentialCutLayers.map((layer, index) => (
            <mesh
              key={`sequential-cut-${layer.index}`}
              geometry={nodes.HZ3.geometry}
              material={sequentialCutMaterials[index]}
              renderOrder={10 + index * 2}
            />
          ))}

          {showCutBodyWireframe && sequentialCutLayers.map((layer) => (
            <mesh
              key={`sequential-cut-wireframe-${layer.index}`}
              geometry={nodes.HZ3.geometry}
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

        </>
      )}

      {/* 模式2: Cut Face - stencil 精确匹配截面边界 */}
      {mode === 'cutFace' && stencilBackMaterial && showCutSection && (
        <mesh
          geometry={nodes.HZ3.geometry}
          material={stencilBackMaterial}
          renderOrder={1}
        />
      )}

      {mode === 'cutFace' && stencilFrontMaterial && showCutSection && (
        <mesh
          geometry={nodes.HZ3.geometry}
          material={stencilFrontMaterial}
          renderOrder={2}
        />
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

      {/* Cut Face 模式：Apply N Cuts - 按等体积生成 N 个彩色截面（faceOnly / both） */}
      {showMultiCutFaceCaps && showMultiCutFaceSection && sequentialCapData.map((capData, index) => {
        const baseOrder = 4 + index * 3
        return (
          <React.Fragment key={`cut-face-multi-${sequentialCutFaceLayers[index].index}`}>
            {/* Stencil back pass：背面写 stencil，标记实体内部 */}
            <mesh
              geometry={nodes.HZ3.geometry}
              material={capData.stencilBack}
              renderOrder={baseOrder}
            />
            {/* Stencil front pass：正面反写 stencil，精确边界 */}
            <mesh
              geometry={nodes.HZ3.geometry}
              material={capData.stencilFront}
              renderOrder={baseOrder + 1}
            />
            {/* 彩色截面 cap：仅在 stencil != 0 的区域绘制 */}
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

      {/* Cut Face 模式：Apply N Cuts - 彩色实体覆盖层（bodyOnly / both） */}
      {showMultiCutFaceSlabs && showMultiCutFaceSection && sequentialFaceBodySlabMaterials.map((material, index) => (
        <mesh
          key={`cut-face-body-slab-${index}`}
          geometry={nodes.HZ3.geometry}
          material={material}
          renderOrder={50 + index * 2}
        />
      ))}
    </group>
  )
}

useGLTF.preload(DEFAULT_MODEL_URL)
