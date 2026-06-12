/**
 * ModelViewer - Three.js 渲染组件
 *
 * 功能：
 * - OriginalModel：未切割时直接渲染原始 GLTF scene
 * - SlicedModel：遍历场景中每个 mesh，逐 slice 用 clippingPlanes 渲染
 * - 切割截面通过颜色区分，不渲染遮罩
 * - 鼠标悬停气泡提示体积
 */
import { useEffect, useMemo, useCallback, memo } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

/* ── 切片颜色方案 ── */
function sliceColor(index, total) {
  const c = new THREE.Color();
  c.setHSL(index / total, 0.75, 0.52);
  return c;
}

/* ── 开启局部裁剪 ── */
function SceneSetup() {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  return null;
}

/* ── 自动适配摄像机 ── */
function AutoFitCamera({ center, maxDim }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!center || !maxDim) return;
    const fov = camera.fov * (Math.PI / 180);
    const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.8;
    camera.position.set(center[0] + dist * 0.6, center[1] + dist * 0.5, center[2] + dist * 0.8);
    camera.lookAt(center[0], center[1], center[2]);
    camera.near = Math.max(0.001, dist / 200);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
  }, [center, maxDim, camera]);
  return null;
}

/* ── 单个 mesh 带 clipping planes（共享 geometry，不克隆）── */
const ClippedMesh = memo(function ClippedMesh({ geometry, worldMatrix, color, clippingPlanes }) {
  // 只做一次 decomposition
  const { position, quaternion, scale } = useMemo(() => {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    worldMatrix.decompose(p, q, s);
    return {
      position: [p.x, p.y, p.z],
      quaternion: [q.x, q.y, q.z, q.w],
      scale: [s.x, s.y, s.z],
    };
  }, [worldMatrix]);

  return (
    <mesh
      geometry={geometry}
      position={position}
      quaternion={quaternion}
      scale={scale}
    >
      <meshStandardMaterial
        color={color}
        roughness={0.45}
        metalness={0.1}
        side={THREE.DoubleSide}
        clippingPlanes={clippingPlanes}
        clipShadows
      />
    </mesh>
  );
});

/* ── 从场景收集网格信息 ── */
function collectMeshes(gltfScene) {
  const meshes = [];
  gltfScene.updateWorldMatrix(true, true);
  gltfScene.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const pos = node.geometry.attributes.position;
    if (!pos || pos.count === 0) return;
    meshes.push({
      geometry: node.geometry.clone(),
      matrixWorld: node.matrixWorld.clone(),
      name: node.name || 'mesh',
    });
  });
  return meshes;
}

/* ── 计算场景包围盒 ── */
function computeSceneBox(gltfScene) {
  const box = new THREE.Box3();
  gltfScene.updateWorldMatrix(true, true);
  gltfScene.traverse((node) => {
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

/* ── 分割模型（遍历原始网格，逐 slice 渲染）── */
function SlicedModel({ gltfScene, cutResult, onHover, onUnhover }) {
  // 收集网格信息（只在 gltfScene 变化时重新计算）
  const meshData = useMemo(() => collectMeshes(gltfScene), [gltfScene]);

  // 包围盒
  const box = useMemo(() => computeSceneBox(gltfScene), [gltfScene]);

  const { axis, cutPlanes, sliceVolumes } = cutResult || {};

  // 摄像机参数
  const cameraParams = useMemo(() => {
    if (!box) return null;
    const c = new THREE.Vector3();
    box.getCenter(c);
    const s = new THREE.Vector3();
    box.getSize(s);
    return { center: [c.x, c.y, c.z], maxDim: Math.max(s.x, s.y, s.z), size: [s.x, s.y, s.z] };
  }, [box]);

  if (!cutPlanes || !sliceVolumes || meshData.length === 0) return null;

  const totalSlices = cutPlanes.length + 1;

  // ────── hover sensor：一个覆盖整个模型的透明盒子，替代各 slice mesh 的 onPointerOver ──────
  const sensorGeom = useMemo(() => {
    if (!box) return null;
    const s = new THREE.Vector3();
    box.getSize(s);
    return new THREE.BoxGeometry(s.x, s.y, s.z);
  }, [box]);

  const sensorPos = useMemo(() => {
    if (!box) return null;
    const c = new THREE.Vector3();
    box.getCenter(c);
    return [c.x, c.y, c.z];
  }, [box]);

  const handlePointerMove = useCallback((e) => {
    e.stopPropagation();
    if (!e.point || !cutPlanes || !sliceVolumes) return;
    // 根据鼠标命中点在该切割轴上的坐标，判断属于第几块
    const coord = axis === 'x' ? e.point.x : e.point.z;
    let idx = 0;
    for (let i = 0; i < cutPlanes.length; i++) {
      if (coord >= cutPlanes[i]) idx = i + 1;
    }
    if (idx >= totalSlices) idx = totalSlices - 1;
    const rawEvt = e.nativeEvent || e;
    onHover?.({ sliceIndex: idx, volume: sliceVolumes[idx] || 0, event: rawEvt });
  }, [axis, cutPlanes, sliceVolumes, totalSlices, onHover]);

  const handlePointerOut = useCallback((e) => {
    e?.stopPropagation?.();
    onUnhover?.();
  }, [onUnhover]);

  // ────── 预计算每个 slice 的 clipping planes（只算一次）──────
  const slicePlanes = useMemo(() => {
    const result = [];
    for (let si = 0; si < totalSlices; si++) {
      const planes = [];
      const minB = si === 0 ? -Infinity : cutPlanes[si - 1];
      const maxB = si === totalSlices - 1 ? Infinity : cutPlanes[si];

      if (isFinite(minB)) {
        let n, c;
        if (axis === 'x')      { n = new THREE.Vector3( 1, 0, 0); c = -minB; }
        else if (axis === 'z') { n = new THREE.Vector3( 0, 0, 1); c = -minB; }
        else                   { n = new THREE.Vector3( 0, 1, 0); c = -minB; }
        planes.push(new THREE.Plane(n, c));
      }
      if (isFinite(maxB)) {
        let n, c;
        if (axis === 'x')      { n = new THREE.Vector3(-1, 0, 0); c = maxB; }
        else if (axis === 'z') { n = new THREE.Vector3( 0, 0,-1); c = maxB; }
        else                   { n = new THREE.Vector3( 0,-1, 0); c = maxB; }
        planes.push(new THREE.Plane(n, c));
      }
      result.push({ planes, minB, maxB });
    }
    return result;
  }, [totalSlices, cutPlanes, axis]);

  return (
    <group>
      {/* 各 slice 渲染 */}
      {slicePlanes.map((sp, sliceIndex) => {
        const color = sliceColor(sliceIndex, totalSlices);
        return (
          <group key={sliceIndex}>
            {meshData.map((md, mi) => (
              <ClippedMesh
                key={`${sliceIndex}-${mi}`}
                geometry={md.geometry}
                worldMatrix={md.matrixWorld}
                color={color}
                clippingPlanes={sp.planes}
              />
            ))}
          </group>
        );
      })}

      {/* 透明 sensor 盒子：覆盖整个模型，捕获 hover 事件 */}
      {sensorGeom && sensorPos && (
        <mesh
          geometry={sensorGeom}
          position={sensorPos}
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
        >
          <meshBasicMaterial
            transparent
            opacity={0}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      )}

      {cameraParams && <AutoFitCamera center={cameraParams.center} maxDim={cameraParams.maxDim} />}
    </group>
  );
}

/* ── 原始模型预览 ── */
function OriginalModel({ gltfScene }) {
  const scene = useMemo(() => gltfScene.clone(), [gltfScene]);

  useEffect(() => {
    scene.traverse((node) => {
      if (node.isMesh && node.material) {
        if (Array.isArray(node.material)) {
          node.material.forEach((m) => { m.color?.set('#7090c0'); m.roughness = 0.5; });
        } else {
          node.material.color?.set('#7090c0');
          node.material.roughness = 0.5;
        }
      }
    });
  }, [scene]);

  const cameraParams = useMemo(() => {
    const box = computeSceneBox(scene);
    if (!box) return null;
    const c = new THREE.Vector3();
    box.getCenter(c);
    const s = new THREE.Vector3();
    box.getSize(s);
    return { center: [c.x, c.y, c.z], maxDim: Math.max(s.x, s.y, s.z) };
  }, [scene]);

  return (
    <>
      <primitive object={scene} />
      {cameraParams && <AutoFitCamera center={cameraParams.center} maxDim={cameraParams.maxDim} />}
    </>
  );
}

/* ═══════════════════════════════════════════
   导出
═══════════════════════════════════════════ */
export default function ModelViewer({ gltfScene, cutResult, tooltip, onTooltip, onNoTooltip }) {
  const tooltipWithPercent = useMemo(() => {
    if (!tooltip || !cutResult?.slicePercentages) return tooltip;
    return {
      ...tooltip,
      percent: cutResult.slicePercentages[tooltip.sliceIndex] ?? tooltip.percent,
    };
  }, [tooltip, cutResult]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        shadows
        camera={{ fov: 45, near: 0.01, far: 10000, position: [5, 5, 5] }}
        gl={{ antialias: true }}
      >
        <SceneSetup />

        <ambientLight intensity={0.65} />
        <directionalLight position={[10, 20, 10]} intensity={1.3} castShadow shadow-mapSize={[2048, 2048]} />
        <directionalLight position={[-8, 10, -8]} intensity={0.5} />
        <directionalLight position={[0, -5, 0]} intensity={0.2} color="#6080ff" />

        {gltfScene && cutResult && (
          <SlicedModel gltfScene={gltfScene} cutResult={cutResult} onHover={onTooltip} onUnhover={onNoTooltip} />
        )}

        {gltfScene && !cutResult && (
          <OriginalModel gltfScene={gltfScene} />
        )}

        <gridHelper args={[200, 80, '#1e2540', '#1a2035']} position={[0, 0, 0]} />

        <OrbitControls makeDefault enableDamping dampingFactor={0.06} />
      </Canvas>

      {tooltipWithPercent && (
        <div
          style={{
            position: 'absolute',
            left: tooltipWithPercent.x + 18,
            top: tooltipWithPercent.y - 12,
            background: 'rgba(12, 14, 28, 0.92)',
            color: '#e8eaf0',
            padding: '10px 16px',
            borderRadius: 10,
            fontSize: 13,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
            border: '1px solid rgba(127, 156, 255, 0.25)',
            backdropFilter: 'blur(10px)',
            zIndex: 1000,
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, color: '#7ec8e3', marginBottom: 2 }}>
            第 {tooltipWithPercent.sliceIndex + 1} 块
          </div>
          <div>
            体积：<span style={{ color: '#ffd700', fontWeight: 600 }}>{tooltipWithPercent.volumeStr}</span>
          </div>
          <div style={{ fontSize: 11, color: '#6070a0' }}>
            占总体积 <span style={{ color: '#a0c0ff' }}>{tooltipWithPercent.percent}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
