/**
 * Itlmodelviewer — Adapted from coal-slicer's ModelViewer.
 *
 * Loads a GLB/GLTF model from a URL and renders it with coal-slicer's visual
 * style (dark canvas, directional lights, grid, OrbitControls, auto-fit camera).
 *
 * When cutN > 0: runs BVH-accelerated equal-volume slicing and renders
 * color-coded slices with clipping planes.
 *
 * Accepts LevaPanel-compatible config props so the settings panel is live.
 *
 * v2: added cutFace / cutBody mode logic migrated from itl3D/PreciseDualModeModel.tsx
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { cpuExactEqualSlices } from './cpuSlicer';
import type { CutResult } from './cpuSlicer';
import { autoAlignTopFace, addBottomCap } from './manualAlign';

/* ── BVH monkey-patch (idempotent) ── */
(THREE.BufferGeometry.prototype as any).computeBoundsTree ??= computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree ??= disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/* ── Loader singleton ── */
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

/* ═════════════════════════════════════════
   Helpers
═════════════════════════════════════════ */

const MULTI_CUT_COLORS = [
  '#e63946', '#118ab2', '#ffd166', '#06d6a0', '#8338ec',
  '#fb8500', '#3a86ff', '#ef476f', '#8ac926', '#ff006e',
  '#ffbe0b', '#2ec4b6',
];

function formatVolume(v: number): string {
  if (v < 1e-6) return `${(v * 1e9).toFixed(2)} mm³`;
  if (v < 1e-3) return `${(v * 1e6).toFixed(2)} cm³`;
  if (v < 1) return `${(v * 1e3).toFixed(2)} L`;
  return `${v.toFixed(4)} m³`;
}

/* ── Slice HSL color ── */
function sliceColor(index: number, total: number): THREE.Color {
  const c = new THREE.Color();
  c.setHSL(index / total, 0.75, 0.52);
  return c;
}

/* ── Accurate bounding box from actual world-space vertices ── */
function computeSceneBox(scene: THREE.Group) {
  scene.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const vec = new THREE.Vector3();
  let hasVerts = false;
  scene.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh || !(node as THREE.Mesh).geometry) return;
    const mesh = node as THREE.Mesh;
    if (mesh.name === 'bottom-cap' || mesh.name.startsWith('bottom-cap')) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos || pos.count === 0) return;
    const step = Math.max(1, Math.floor(pos.count / 2000));
    for (let i = 0; i < pos.count; i += step) {
      vec.fromBufferAttribute(pos, i);
      vec.applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(vec);
      hasVerts = true;
    }
  });
  if (!hasVerts) return null;
  console.log('[computeSceneBox] box:', box.min.toArray().map(v => v.toFixed(2)), '→',
    box.max.toArray().map(v => v.toFixed(2)),
    '| size:', (box.max.x - box.min.x).toFixed(2), (box.max.y - box.min.y).toFixed(2), (box.max.z - box.min.z).toFixed(2));
  return box;
}

/* ── Collect mesh data for sliced rendering ── */
function collectMeshes(gltfScene: THREE.Group) {
  const meshes: { geometry: THREE.BufferGeometry; matrixWorld: THREE.Matrix4; name: string }[] = [];
  gltfScene.updateWorldMatrix(true, true);
  gltfScene.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh || !(node as THREE.Mesh).geometry) return;
    const mesh = node as THREE.Mesh;
    if (mesh.name === 'bottom-cap' || mesh.name.startsWith('bottom-cap')) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos || pos.count === 0) return;
    meshes.push({
      geometry: geo.clone(),
      matrixWorld: mesh.matrixWorld.clone(),
      name: mesh.name || 'mesh',
    });
  });
  return meshes;
}

/* ═════════════════════════════════════════
   Stencil Cap Helpers — migrated from PreciseDualModeModel.tsx
   ══════════════════════════════════════════ */

/** Build single-cut stencil cap data for cutFace mode */
function buildStencilCapData(
  clippingPlane: THREE.Plane,
  capColor: string,
  projectionRange: { min: number; max: number } | null,
): { geometry: THREE.PlaneGeometry; stencilBack: THREE.MeshBasicMaterial; stencilFront: THREE.MeshBasicMaterial; cap: THREE.MeshBasicMaterial } | null {
  if (!projectionRange) return null;
  const span = projectionRange.max - projectionRange.min;
  const diagonal = span * 2;
  const geometry = new THREE.PlaneGeometry(diagonal * 2, diagonal * 2, 1, 1);
  const quaternion = new THREE.Quaternion();
  quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), clippingPlane.normal);
  geometry.applyQuaternion(quaternion);
  const pos = clippingPlane.normal.clone().multiplyScalar(-clippingPlane.constant);
  geometry.translate(pos.x, pos.y, pos.z);

  const stencilBack = new THREE.MeshBasicMaterial({
    side: THREE.BackSide,
    clippingPlanes: [clippingPlane],
    colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.IncrementWrapStencilOp,
  });

  const stencilFront = new THREE.MeshBasicMaterial({
    side: THREE.FrontSide,
    clippingPlanes: [clippingPlane],
    colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.DecrementWrapStencilOp,
  });

  const cap = new THREE.MeshBasicMaterial({
    color: new THREE.Color(capColor),
    side: THREE.DoubleSide,
    transparent: false, opacity: 1.0,
    depthWrite: true, depthTest: false, fog: false,
    stencilWrite: true, stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });

  return { geometry, stencilBack, stencilFront, cap };
}

/** Build multi-cut stencil cap data for cutFace + cutN > 0 */
function buildMultiStencilCapData(
  cutPlanes: number[],
  sliceNormal: [number, number, number] | null,
  capColor: string,
  projectionRange: { min: number; max: number } | null,
): { geometry: THREE.PlaneGeometry; stencilBack: THREE.MeshBasicMaterial; stencilFront: THREE.MeshBasicMaterial; cap: THREE.MeshBasicMaterial; color: string }[] {
  if (!projectionRange || cutPlanes.length === 0) return [];

  const normalVec = sliceNormal
    ? new THREE.Vector3(sliceNormal[0], sliceNormal[1], sliceNormal[2])
    : new THREE.Vector3(0, 0, 1);

  return cutPlanes.map((pos, i) => {
    const plane = new THREE.Plane(normalVec.clone(), -pos);
    const span = projectionRange.max - projectionRange.min;
    const diagonal = span * 2;
    const geometry = new THREE.PlaneGeometry(diagonal * 2, diagonal * 2, 1, 1);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
    geometry.applyQuaternion(quaternion);
    const pp = plane.normal.clone().multiplyScalar(-plane.constant);
    geometry.translate(pp.x, pp.y, pp.z);

    const color = capColor;

    const stencilBack = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      clippingPlanes: [plane],
      colorWrite: false, depthWrite: false, depthTest: false,
      stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.IncrementWrapStencilOp,
    });
    const stencilFront = new THREE.MeshBasicMaterial({
      side: THREE.FrontSide,
      clippingPlanes: [plane],
      colorWrite: false, depthWrite: false, depthTest: false,
      stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.DecrementWrapStencilOp,
    });
    const capMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      side: THREE.DoubleSide,
      transparent: false, opacity: 1.0,
      depthWrite: true, depthTest: false, fog: false,
      stencilWrite: true, stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    });

    return { geometry, stencilBack, stencilFront, cap: capMat, color };
  });
}

/* ═════════════════════════════════════════
   cutBody Helpers — migrated from PreciseDualModeModel.tsx
   ══════════════════════════════════════════ */

function createForwardPlane(normal: THREE.Vector3, distance: number) {
  return new THREE.Plane(normal.clone(), -distance);
}
function createReversePlane(normal: THREE.Vector3, distance: number) {
  return new THREE.Plane(normal.clone().negate(), distance);
}

/** Build cutBody single-cut removed-portion material */
function buildCutBodyMaterial(
  mainMaterial: THREE.Material | null,
  cutBodyMaskColor: string,
  removedOpacity: number,
  clippingPlane: THREE.Plane,
): THREE.MeshStandardMaterial {
  const base = (mainMaterial as THREE.MeshStandardMaterial)?.clone()
    ?? new THREE.MeshStandardMaterial();
  const c = new THREE.Color(cutBodyMaskColor);
  base.color = c;
  base.emissive = c;
  base.emissiveIntensity = 0.12;
  base.side = THREE.DoubleSide;
  base.transparent = true;
  base.opacity = Math.min(1, Math.max(0.05, removedOpacity));
  // Use clippingPlane directly — it already represents the used portion
  base.clippingPlanes = [clippingPlane.clone()];
  base.clipShadows = true;
  base.needsUpdate = true;
  return base;
}

/** Build sequential cut layers for cutBody multi-cut */
function buildSequentialCutLayers(
  cutPlanes: number[],
  sliceNormal: [number, number, number] | null,
  cutBodyLayeredOpacity: number,
  cutPlanesDistances: number[],
  localAxisMin: number,
): { index: number; startDistance: number; endDistance: number; color: string; clippingPlanes: THREE.Plane[] }[] {
  if (cutPlanes.length === 0) return [];

  const normalVec = sliceNormal
    ? new THREE.Vector3(sliceNormal[0], sliceNormal[1], sliceNormal[2])
    : new THREE.Vector3(1, 0, 0);

  const epsilon = 0.001;
  const layers: { index: number; startDistance: number; endDistance: number; color: string; clippingPlanes: THREE.Plane[] }[] = [];

  for (let index = 0; index < cutPlanes.length; index++) {
    const startDist = index === 0 ? localAxisMin + epsilon : cutPlanesDistances[index - 1];
    const endDist = cutPlanesDistances[index] - epsilon;
    layers.push({
      index,
      startDistance: startDist,
      endDistance: endDist,
      color: MULTI_CUT_COLORS[index % MULTI_CUT_COLORS.length],
      clippingPlanes: [
        createForwardPlane(normalVec, startDist),
        createReversePlane(normalVec, endDist),
      ],
    });
  }

  return layers;
}


/* ═════════════════════════════════════════
   Lighting presets
═════════════════════════════════════════ */
interface LightDef {
  type: 'ambient' | 'directional';
  color?: string;
  intensity: number;
  position?: [number, number, number];
  castShadow?: boolean;
}

type PresetName = 'rembrandt' | 'portrait' | 'upfront' | 'soft';

const LIGHTING_PRESETS: Record<PresetName, LightDef[]> = {
  rembrandt: [
    { type: 'ambient', intensity: 0.35 },
    { type: 'directional', position: [8, 12, 4], intensity: 1.6, castShadow: true, color: '#fff3e0' },
    { type: 'directional', position: [-4, 6, -6], intensity: 0.4, color: '#8899cc' },
    { type: 'directional', position: [0, -4, 0], intensity: 0.2, color: '#6080ff' },
  ],
  portrait: [
    { type: 'ambient', intensity: 0.5 },
    { type: 'directional', position: [2, 10, 4], intensity: 1.2, castShadow: true, color: '#ffe8d6' },
    { type: 'directional', position: [-2, 8, -2], intensity: 0.6, color: '#d6e0ff' },
    { type: 'directional', position: [0, -3, 0], intensity: 0.15, color: '#6080ff' },
  ],
  upfront: [
    { type: 'ambient', intensity: 0.55 },
    { type: 'directional', position: [0, 8, 10], intensity: 1.3, castShadow: true, color: '#ffffff' },
    { type: 'directional', position: [-6, 4, -4], intensity: 0.35, color: '#8899cc' },
    { type: 'directional', position: [6, 4, -4], intensity: 0.35, color: '#8899cc' },
  ],
  soft: [
    { type: 'ambient', intensity: 0.6 },
    { type: 'directional', position: [4, 6, 6], intensity: 0.8, castShadow: true, color: '#ffe8d6' },
    { type: 'directional', position: [-4, 6, -4], intensity: 0.7, color: '#d6e0ff' },
    { type: 'directional', position: [0, -4, 0], intensity: 0.25, color: '#80a0ff' },
  ],
};

/* ═════════════════════════════════════════
   Orientation presets
═════════════════════════════════════════ */
function getOrientationAngles(orientation: number): { azimuth: number; elevation: number } {
  const idx = Math.max(1, Math.min(12, Math.round(orientation))) - 1;
  const azimuth = (idx / 12) * Math.PI * 2;
  const elevation = idx % 2 === 0 ? Math.PI / 7 : Math.PI / 4;
  return { azimuth, elevation };
}

/* ═════════════════════════════════════════
   R3F sub-components
═════════════════════════════════════════ */

function SceneBackground({ color }: { color: string }) {
  useThree(({ scene }) => {
    scene.background = new THREE.Color(color);
  });
  return null;
}

function SceneSetup() {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
    // stencil is enabled via <Canvas gl={{ stencil: true }}>
  }, [gl]);
  return null;
}

function AutoFitCamera({ center, maxDim, orientation }: {
  center: [number, number, number];
  maxDim: number;
  orientation: number;
}) {
  const { camera } = useThree();
  const persp = camera as THREE.PerspectiveCamera;
  useEffect(() => {
    if (!center || !maxDim) return;
    const { azimuth, elevation } = getOrientationAngles(orientation);
    const dist = (maxDim / 2) / Math.tan(persp.fov * (Math.PI / 180) / 2) * 1.8;
    const x = center[0] + dist * Math.cos(elevation) * Math.sin(azimuth);
    const y = center[1] + dist * Math.sin(elevation);
    const z = center[2] + dist * Math.cos(elevation) * Math.cos(azimuth);
    persp.position.set(x, y, z);
    persp.lookAt(center[0], center[1], center[2]);
    persp.near = Math.max(0.001, dist / 200);
    persp.far = dist * 20;
    persp.updateProjectionMatrix();
  }, [center, maxDim, orientation, persp]);
  return null;
}

function LightingRig({ preset, lightIntensity }: { preset: PresetName; lightIntensity: number }) {
  const lights = LIGHTING_PRESETS[preset] ?? LIGHTING_PRESETS.rembrandt;
  return (
    <>
      {lights.map((l, i) => {
        const intensity = l.intensity * lightIntensity;
        if (l.type === 'ambient') {
          return <ambientLight key={i} intensity={intensity} color={l.color} />;
        }
        return (
          <directionalLight
            key={i}
            position={l.position}
            intensity={intensity}
            color={l.color}
            castShadow={l.castShadow}
            shadow-mapSize={l.castShadow ? [2048, 2048] : undefined}
          />
        );
      })}
    </>
  );
}

/* ── ClippedMesh (per-slice, per-mesh rendering) ── */
function ClippedMesh({ geometry, worldMatrix, color, clippingPlanes }: {
  geometry: THREE.BufferGeometry;
  worldMatrix: THREE.Matrix4;
  color: THREE.Color;
  clippingPlanes: THREE.Plane[];
}) {
  const decomp = useMemo(() => {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    worldMatrix.decompose(p, q, s);
    return {
      position: [p.x, p.y, p.z] as [number, number, number],
      quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number],
      scale: [s.x, s.y, s.z] as [number, number, number],
    };
  }, [worldMatrix]);

  return (
    <mesh geometry={geometry} position={decomp.position} quaternion={decomp.quaternion} scale={decomp.scale}>
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
}

/* ── UsedOverlay — semi-transparent overlay for the cut-away (used) portion ── */
function UsedOverlay({ scene, preClipPlane, forceUpdate, maskColor, opacity }: {
  scene: THREE.Group;
  preClipPlane: THREE.Plane;
  forceUpdate: number;
  maskColor?: string;
  opacity?: number;
}) {
  const meshData = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    return collectMeshes(scene);
  }, [scene, forceUpdate]);

  const usedPlane = preClipPlane.clone(); // preClipPlane keeps used (inner) side, use directly
  const usedOpacity = opacity ?? 0.35;
  const usedColor = maskColor ?? '#ffffff';

  if (meshData.length === 0) return null;

  return (
    <group>
      {meshData.map((md, mi) => {
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        md.matrixWorld.decompose(p, q, s);
        return (
          <mesh
            key={`used-${mi}`}
            geometry={md.geometry}
            position={[p.x, p.y, p.z]}
            quaternion={[q.x, q.y, q.z, q.w]}
            scale={[s.x, s.y, s.z]}
          >
            <meshStandardMaterial
              color={usedColor}
              transparent
              opacity={usedOpacity}
              roughness={0.5}
              metalness={0.05}
              side={THREE.DoubleSide}
              clippingPlanes={[usedPlane]}
              clipShadows
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* ── SlicedModel (original scene rendered with clipping planes) ── */
function SlicedModel({ scene, cutResult, forceUpdate, preClipPlane }: {
  scene: THREE.Group;
  cutResult: CutResult;
  forceUpdate: number;
  preClipPlane?: THREE.Plane | null;
}) {
  const meshData = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const md = collectMeshes(scene);
    return md;
  }, [scene, forceUpdate]);
  const box = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    return computeSceneBox(scene);
  }, [scene, forceUpdate]);

  const { axis, cutPlanes, sliceNormal } = cutResult;
  const totalSlices = cutPlanes.length + 1;

  const sliceNormalVec = useMemo(() => {
    if (!sliceNormal) return null;
    return new THREE.Vector3(sliceNormal[0], sliceNormal[1], sliceNormal[2]);
  }, [sliceNormal]);

  const camParams = useMemo(() => {
    if (!box) return null;
    const c = new THREE.Vector3();
    box.getCenter(c);
    const s = new THREE.Vector3();
    box.getSize(s);
    return { center: [c.x, c.y, c.z] as [number, number, number], maxDim: Math.max(s.x, s.y, s.z) };
  }, [box]);

  const sliceClipPlanes = useMemo(() => {
    const result: THREE.Plane[][] = [];
    for (let si = 0; si < totalSlices; si++) {
      const planes: THREE.Plane[] = [];
      const minB = si === 0 ? -Infinity : cutPlanes[si - 1];
      const maxB = si === totalSlices - 1 ? Infinity : cutPlanes[si];

      if (sliceNormalVec) {
        if (isFinite(minB)) planes.push(new THREE.Plane(sliceNormalVec.clone(), -minB));
        if (isFinite(maxB)) planes.push(new THREE.Plane(sliceNormalVec.clone().negate(), maxB));
      } else {
        if (isFinite(minB)) {
          if (axis === 'x') planes.push(new THREE.Plane(new THREE.Vector3(1, 0, 0), -minB));
          else if (axis === 'z') planes.push(new THREE.Plane(new THREE.Vector3(0, 0, 1), -minB));
          else planes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -minB));
        }
        if (isFinite(maxB)) {
          if (axis === 'x') planes.push(new THREE.Plane(new THREE.Vector3(-1, 0, 0), maxB));
          else if (axis === 'z') planes.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), maxB));
          else planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), maxB));
        }
      }
      if (preClipPlane) {
        planes.push(preClipPlane.clone().negate());
      }
      result.push(planes);
    }
    return result;
  }, [totalSlices, cutPlanes, axis, sliceNormalVec, preClipPlane]);

  if (sliceClipPlanes.length === 0 || meshData.length === 0) return null;

  return (
    <group>
      {sliceClipPlanes.map((planes, sliceIndex) => {
        const color = sliceColor(sliceIndex, totalSlices);
        return (
          <group key={sliceIndex}>
            {meshData.map((md, mi) => (
              <ClippedMesh
                key={`${sliceIndex}-${mi}`}
                geometry={md.geometry}
                worldMatrix={md.matrixWorld}
                color={color}
                clippingPlanes={planes}
              />
            ))}
          </group>
        );
      })}
      {camParams && <AutoFitCamera center={camParams.center} maxDim={camParams.maxDim} orientation={4} />}
    </group>
  );
}

/* ── OriginalModel (un-cut preview) ── */
function OriginalModel({ scene, orientation, forceUpdate, preClipPlane }: {
  scene: THREE.Group;
  orientation: number;
  forceUpdate: number;
  preClipPlane?: THREE.Plane | null;
}) {
  const cloned = useMemo(() => scene.clone(), [scene, forceUpdate]);

  useEffect(() => {
    cloned.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh || !(node as THREE.Mesh).material) return;
      const mat = (node as THREE.Mesh).material;
      const setProps = (m: THREE.Material) => {
        if ('color' in m && m.color instanceof THREE.Color) m.color.set('#7090c0');
        if ('roughness' in m) (m as THREE.MeshStandardMaterial).roughness = 0.5;
        if (preClipPlane) {
          if ('clippingPlanes' in m) {
            (m as THREE.MeshStandardMaterial).clippingPlanes = [preClipPlane.clone().negate()];
            (m as THREE.MeshStandardMaterial).clipShadows = true;
          }
        } else {
          if ('clippingPlanes' in m) {
            (m as THREE.MeshStandardMaterial).clippingPlanes = null;
          }
        }
      };
      if (Array.isArray(mat)) mat.forEach(setProps);
      else setProps(mat);
    });
  }, [cloned, preClipPlane]);

  const camParams = useMemo(() => {
    const b = computeSceneBox(cloned);
    if (!b) return null;
    const c = new THREE.Vector3();
    b.getCenter(c);
    const s = new THREE.Vector3();
    b.getSize(s);
    return { center: [c.x, c.y, c.z] as [number, number, number], maxDim: Math.max(s.x, s.y, s.z) };
  }, [cloned]);

  return (
    <>
      <primitive object={cloned} />
      {camParams && <AutoFitCamera center={camParams.center} maxDim={camParams.maxDim} orientation={orientation} />}
    </>
  );
}


/* ── RenderMeshesWithMaterial: render collected meshes with a single material ── */
function RenderMeshesWithMaterial({ meshData, material, renderOrder, onAfterRender }: {
  meshData: { geometry: THREE.BufferGeometry; matrixWorld: THREE.Matrix4; name: string }[];
  material: THREE.Material;
  renderOrder?: number;
  onAfterRender?: (renderer: THREE.WebGLRenderer) => void;
}) {
  return (
    <>
      {meshData.map((md, mi) => {
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        md.matrixWorld.decompose(p, q, s);
        return (
          <mesh
            key={`rwm-${mi}`}
            geometry={md.geometry}
            position={[p.x, p.y, p.z]}
            quaternion={[q.x, q.y, q.z, q.w]}
            scale={[s.x, s.y, s.z]}
            material={material}
            renderOrder={renderOrder}
            onAfterRender={onAfterRender}
          />
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════
   Props
═══════════════════════════════════════ */
export interface ModelViewerConfig {
  shadows: boolean;
  contactShadow: boolean;
  lightIntensity: number;
  preset: string;
  background: string;
  orientation: number;
  autoRotate: boolean;
  canRotate: boolean;
  canDrag: boolean;
  cutN: number;
  cutR: number;
  cutDepth: number;
  cutAngle: number;
  /** 切割模式：'cutFace' = 切割面（截面可视化），'cutBody' = 切割体（已用部分半透明覆盖） */
  mode: 'cutFace' | 'cutBody';
  /** cutFace 模式：截面填充颜色 */
  cutFaceMaskColor: string;
  /** cutBody 模式：已切割部分的覆盖颜色 */
  cutBodyMaskColor: string;
  /** cutFace 多刀视图模式 */
  cutFaceMultiStyle: 'Face' | 'Body' | 'FaceAndBody' | 'faceOnly' | 'bodyOnly';
  /** cutFace 模式：仅显示截面时主体透明度 */
  faceOnlyBaseOpacity: number;
  /** cutFace 模式：截面覆盖层透明度 */
  cutFaceOverlayOpacity: number;
  /** cutBody 模式：已用部分透明度 */
  cutBodyRemovedOpacity: number;
  /** cutBody 模式：分层切片透明度 */
  cutBodyLayeredOpacity: number;
}

interface ModelViewerProps {
  modelUrl: string;
  config: ModelViewerConfig;
  style?: React.CSSProperties;
}

/* ═════════════════════════════════════════
   Data panel dimensions
═════════════════════════════════════════ */

function useSceneDimensions(
  scene: THREE.Group | null,
  forceUpdate: number,
  alignTick: number,
) {
  const [dims, setDims] = useState<{ length: string; width: string; height: string } | null>(null);

  useEffect(() => {
    if (!scene) { setDims(null); return; }
    scene.updateWorldMatrix(true, true);
    const box = computeSceneBox(scene);
    if (!box) { setDims(null); return; }
    const sx = box.max.x - box.min.x;
    const sy = box.max.y - box.min.y;
    const sz = box.max.z - box.min.z;
    const length = sx >= sz ? sx : sz;
    const width = sx >= sz ? sz : sx;
    setDims({
      length: length.toFixed(2),
      width: width.toFixed(2),
      height: sy.toFixed(2),
    });
  }, [scene, forceUpdate, alignTick]);

  return dims;
}

/* ═════════════════════════════════════════
   Exported component
═════════════════════════════════════════ */
export default function Itlmodelviewer({ modelUrl, config, style }: ModelViewerProps) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [cutResult, setCutResult] = useState<CutResult | null>(null);
  const [alignTick, setAlignTick] = useState(0);
  const [forceUpdate, setForceUpdate] = useState(0);
  const prevUrlRef = useRef<string | null>(null);
  const computingRef = useRef(false);
  const sceneRef = useRef<THREE.Group | null>(null);

  // Keep sceneRef in sync
  useEffect(() => { sceneRef.current = scene; }, [scene]);

  const dimensions = useSceneDimensions(scene, forceUpdate, alignTick);

  /* ── Pre-cut plane from cutAngle + cutDepth ── */
  const preClipPlane = useMemo(() => {
    if (!scene || config.cutDepth <= 0 || config.cutDepth > 100) return null;
    scene.updateWorldMatrix(true, true);
    const box = computeSceneBox(scene);
    if (!box) return null;

    const angleRad = (config.cutAngle * Math.PI) / 180;
    const cutNormal = new THREE.Vector3(Math.cos(angleRad), 0, Math.sin(angleRad)).normalize();

    let minProj = Infinity, maxProj = -Infinity;
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
    for (const c of corners) {
      const proj = cutNormal.dot(c);
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }
    const range = maxProj - minProj;
    if (range <= 0) return null;

    const planeDist = minProj + range * (config.cutDepth / 100);
    // preClipPlane keeps used (inner) side: cutNormal·p <= planeDist
    // OriginalModel negates it to show remaining; UsedOverlay uses it directly to show used
    const plane = new THREE.Plane(cutNormal.clone().negate(), planeDist);

    return plane;
  }, [scene, config.cutAngle, config.cutDepth, forceUpdate]);

  /* ── Full model volume ── */
  const [fullVolume, setFullVolume] = useState<number | null>(null);

  useEffect(() => {
    if (!scene || config.cutDepth <= 0) { setFullVolume(null); return; }
    scene.updateWorldMatrix(true, true);
    const result = cpuExactEqualSlices(scene, 1, config.cutR);
    if (result) {
      setFullVolume(result.totalVolume);
    }
  }, [scene, config.cutR, config.cutDepth, forceUpdate]);

  /* ── cutNormal (points from used side toward remaining side, for parallel slicing) ── */
  const cutNormal = useMemo(() => {
    if (!preClipPlane) return null;
    return preClipPlane.normal.clone().negate(); // cutNormal = direction from minProj to maxProj
  }, [preClipPlane]);

  /* ── Remaining volume (after pre-cut) ── */
  const remainingVolume = useMemo(() => {
    if (config.cutDepth <= 0) return null;
    if (config.cutN > 0 && cutResult) return cutResult.totalVolume;
    if (!scene || !preClipPlane) return null;
    scene.updateWorldMatrix(true, true);
    const result = cpuExactEqualSlices(scene, 1, config.cutR, preClipPlane, cutNormal);
    if (!result) return null;
    return result.totalVolume;
  }, [config.cutN, config.cutDepth, cutResult, scene, preClipPlane, cutNormal, config.cutR, forceUpdate]);

  /* ── Init MeshoptDecoder ── */
  useEffect(() => {
    loader.setMeshoptDecoder(MeshoptDecoder);
    MeshoptDecoder.ready
      .then(() => console.log('[Itlmodelviewer] MeshoptDecoder WASM ready'))
      .catch((err: Error) => console.warn('[Itlmodelviewer] MeshoptDecoder WASM failed:', err.message));
  }, []);

  /* ── Load model from URL ── */
  useEffect(() => {
    if (!modelUrl || modelUrl === prevUrlRef.current) return;
    prevUrlRef.current = modelUrl;
    setLoading(true);
    setError(null);
    setScene(null);
    setCutResult(null);

    loader.load(
      modelUrl,
      (gltf) => {
        const wrapper = new THREE.Group();
        wrapper.add(gltf.scene);
        autoAlignTopFace(wrapper, true);
        setScene(wrapper);
        setForceUpdate(t => t + 1);
        setAlignTick(t => t + 1);
        setLoading(false);
      },
      undefined,
      (err: unknown) => {
        console.error('[Itlmodelviewer] load error:', err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    );
  }, [modelUrl]);

  /* ── Slice computation ── */
  useEffect(() => {
    const N = config.cutN;
    const R = config.cutR;

    if (!scene || N <= 0) {
      setCutResult(null);
      setComputing(false);
      return;
    }

    let cancelled = false;
    computingRef.current = true;
    setComputing(true);

    const safetyTimer = setTimeout(() => {
      if (!cancelled) {
        setComputing(false);
        computingRef.current = false;
      }
    }, 15000);

    const mainTimer = setTimeout(() => {
      if (cancelled) return;
      try {
        const s = sceneRef.current;
        if (!s) { setComputing(false); return; }
        s.updateWorldMatrix(true, true);

        const result = cpuExactEqualSlices(s, N, R, preClipPlane, cutNormal);
        if (!cancelled) {
          if (result) {
            setCutResult(result);
          } else {
            setCutResult(null);
          }
        }
      } catch (err) {
        console.error('[Itlmodelviewer] slice error:', err);
        if (!cancelled) setCutResult(null);
      } finally {
        if (!cancelled) {
          setComputing(false);
          computingRef.current = false;
        }
        clearTimeout(safetyTimer);
      }
    }, 30);

    return () => {
      cancelled = true;
      computingRef.current = false;
      setComputing(false);
      clearTimeout(mainTimer);
      clearTimeout(safetyTimer);
    };
  }, [scene, config.cutN, config.cutR, alignTick, preClipPlane, cutNormal]);

  /* ═════════════════════════════════════════
     cutFace / cutBody mode rendering
     ══════════════════════════════════════════ */

  // Mesh data for stencil rendering
  const meshData = useMemo(() => {
    if (!scene) return [];
    return collectMeshes(scene);
  }, [scene, forceUpdate]);

  // cutFace single-cut stencil cap
  const cutFaceCapData = useMemo(() => {
    if (config.mode !== 'cutFace' || !preClipPlane) return null;
    const box = scene ? computeSceneBox(scene) : null;
    if (!box) return null;
    const range = { min: box.min.dot(preClipPlane.normal), max: box.max.dot(preClipPlane.normal) };
    // Negate preClipPlane to get remaining-side plane for stencil cap rendering
    const capPlane = preClipPlane.clone().negate();
    return buildStencilCapData(capPlane, config.cutFaceMaskColor, range);
  }, [config.mode, config.cutFaceMaskColor, preClipPlane, scene, forceUpdate]);

  // cutFace multi-cut stencil caps
  const cutFaceMultiCapData = useMemo(() => {
    if (config.mode !== 'cutFace' || !preClipPlane || !cutResult || cutResult.cutPlanes.length === 0) return [];
    const box = scene ? computeSceneBox(scene) : null;
    if (!box) return [];
    const range = { min: box.min.dot(preClipPlane.normal), max: box.max.dot(preClipPlane.normal) };
    // Use preClipPlane boundary (planeDist) — cap at the actual cut surface, not at internal slice planes
    const capPlane = preClipPlane.clone().negate();
    const singleCap = buildStencilCapData(capPlane, config.cutFaceMaskColor, range);
    return singleCap ? [singleCap] : [];
  }, [config.mode, config.cutFaceMaskColor, cutResult, preClipPlane, scene, forceUpdate]);

  // cutBody single-cut removed-portion material
  const cutBodyMaterial = useMemo(() => {
    if (config.mode !== 'cutBody' || !preClipPlane || !scene) return null;
    if (meshData.length === 0) return null;
    return buildCutBodyMaterial(
      null, // material template
      config.cutBodyMaskColor,
      config.cutBodyRemovedOpacity,
      preClipPlane,
    );
  }, [config.mode, config.cutBodyMaskColor, config.cutBodyRemovedOpacity, preClipPlane, scene, meshData]);

  const preset = (config.preset in LIGHTING_PRESETS ? config.preset : 'rembrandt') as PresetName;
  const showSlice = config.cutN > 0 && cutResult && !computing && !loading;

  /* ═════════════════════════════════════════
     Main render
     ══════════════════════════════════════════ */
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', ...style }}>
      <Canvas
        shadows={config.shadows}
        camera={{ fov: 45, near: 0.01, far: 10000, position: [5, 5, 5] }}
        gl={{ antialias: true, stencil: true }}
      >
        <SceneSetup />
        <SceneBackground color={config.background} />
        <LightingRig preset={preset} lightIntensity={config.lightIntensity} />

                {/* ── Single-cut cutFace (no slices) ── */}
        {config.mode === 'cutFace' && preClipPlane && !showSlice && scene && (
          <>
            {/* Single-cut stencil cap */}
            {cutFaceCapData && meshData.length > 0 && (
              <>
                <RenderMeshesWithMaterial
                  meshData={meshData}
                  material={cutFaceCapData.stencilBack}
                  renderOrder={1}
                />
                <RenderMeshesWithMaterial
                  meshData={meshData}
                  material={cutFaceCapData.stencilFront}
                  renderOrder={2}
                />
                <mesh
                  geometry={cutFaceCapData.geometry}
                  material={cutFaceCapData.cap}
                  renderOrder={3}
                  onAfterRender={(renderer: THREE.WebGLRenderer) => { renderer.clearStencil(); }}
                />
              </>
            )}
            {/* Show original model dimmed (remaining side) */}
            {config.cutFaceMultiStyle !== 'faceOnly' && (
              <OriginalModel
                key={`origcf-${forceUpdate}`}
                scene={scene}
                orientation={config.orientation}
                forceUpdate={forceUpdate}
                preClipPlane={preClipPlane}
              />
            )}
          </>
        )}

        {/* ── Single-cut cutBody (no slices) ── */}
        {config.mode === 'cutBody' && preClipPlane && !showSlice && scene && (
          <>
            {/* Full model unclipped — cutBody overlay renders used portion on top */}
            <OriginalModel
              key={`origcb-${forceUpdate}`}
              scene={scene}
              orientation={config.orientation}
              forceUpdate={forceUpdate}
            />
            {/* Removed (used) portion overlay — matches PreciseDualModeModel convention */}
            {cutBodyMaterial && meshData.length > 0 && (
              <RenderMeshesWithMaterial
                meshData={meshData}
                material={cutBodyMaterial}
                renderOrder={10}
              />
            )}
          </>
        )}

        {/* ── Sliced model + mode-specific overlays (cutN > 0) ── */}
        {showSlice && scene && (
          <>
            {/* cutFace multi-cut stencil caps */}
            {config.mode === 'cutFace' && meshData.length > 0 && cutFaceMultiCapData.map((capData, i) => (
              <React.Fragment key={`cutface-multi-${i}`}>
                <RenderMeshesWithMaterial
                  meshData={meshData}
                  material={capData.stencilBack}
                  renderOrder={10 + i * 3}
                />
                <RenderMeshesWithMaterial
                  meshData={meshData}
                  material={capData.stencilFront}
                  renderOrder={11 + i * 3}
                />
                <mesh
                  geometry={capData.geometry}
                  material={capData.cap}
                  renderOrder={12 + i * 3}
                  onAfterRender={(renderer: THREE.WebGLRenderer) => { renderer.clearStencil(); }}
                />
              </React.Fragment>
            ))}
            {/* cutBody used-portion overlay on top of sliced model */}
            {config.mode === 'cutBody' && preClipPlane && cutBodyMaterial && meshData.length > 0 && (
              <RenderMeshesWithMaterial
                meshData={meshData}
                material={cutBodyMaterial}
                renderOrder={100}
              />
            )}
            {/* Used-portion overlay for non-cutBody modes (white transparent) */}
            {config.mode !== 'cutBody' && preClipPlane && (
              <UsedOverlay scene={scene} preClipPlane={preClipPlane} forceUpdate={forceUpdate} />
            )}
            <SlicedModel key={`slice-${forceUpdate}`} scene={scene} cutResult={cutResult!} forceUpdate={forceUpdate} preClipPlane={preClipPlane} />
          </>
        )}

{/* ── Original model when no cut ── */}
        {!showSlice && !preClipPlane && scene && !computing && (
          <OriginalModel
            key={`orig-${forceUpdate}`}
            scene={scene}
            orientation={config.orientation}
            forceUpdate={forceUpdate}
          />
        )}

        {config.contactShadow && (
          <ContactShadows position={[0, -0.01, 0]} opacity={0.5} scale={10} blur={2.5} far={10} />
        )}

        <gridHelper args={[200, 80, '#1e2540', '#1a2035']} position={[0, 0, 0]} />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.06}
          autoRotate={config.autoRotate}
          enableRotate={config.canRotate}
          enablePan={config.canDrag}
        />
      </Canvas>

      {/* ═══ Overlays ═══ */}

      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, #1a1f35 0%, #0d1020 100%)',
          zIndex: 10,
        }}>
          <div style={{
            width: 44, height: 44,
            border: '3px solid rgba(100,140,255,0.2)',
            borderTopColor: '#4f7fff',
            borderRadius: '50%',
            animation: 'spin 800ms linear infinite',
          }} />
        </div>
      )}

      {/* Computing overlay */}
      {computing && !loading && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(12, 14, 28, 0.9)', color: '#c8d6f8',
          padding: '10px 24px', borderRadius: 12, fontSize: 13,
          border: '1px solid rgba(127, 156, 255, 0.25)',
          backdropFilter: 'blur(10px)', zIndex: 20,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 16, height: 16,
            border: '2px solid rgba(100,140,255,0.3)',
            borderTopColor: '#4f7fff',
            borderRadius: '50%',
            animation: 'spin 800ms linear infinite',
          }} />
          等体积切割计算中…
        </div>
      )}

      {/* Manual align button */}
      {scene && !loading && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 15, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}>
          <button
            onClick={() => {
              const s = sceneRef.current;
              if (!s) return;
              addBottomCap(s);
              autoAlignTopFace(s, true);
              setScene(s);
              setForceUpdate(t => t + 1);
              setAlignTick(t => t + 1);
            }}
            style={{
              background: 'rgba(12, 14, 28, 0.9)',
              border: '1px solid rgba(127, 156, 255, 0.35)',
              borderRadius: 10,
              color: '#a0c0ff',
              fontSize: 12,
              padding: '8px 20px',
              cursor: 'pointer',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              transition: 'all 0.2s',
            }}
          >
            📐 自动找顶面
          </button>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, #1a1f35 0%, #0d1020 100%)',
          zIndex: 10,
        }}>
          <div style={{ color: '#fc8181', textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Model Load Error</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{error}</div>
          </div>
        </div>
      )}

      {/* ═══ Data panel — left side ═══ */}
      {(scene && !loading) && (
        <div style={{
          position: 'absolute', top: 16, left: 16,
          background: 'rgba(12, 14, 28, 0.9)',
          border: '1px solid rgba(127, 156, 255, 0.2)',
          borderRadius: 12, padding: '14px 18px',
          color: '#a0b0d0', fontSize: 12,
          backdropFilter: 'blur(10px)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
          zIndex: 5,
          minWidth: 210,
          maxWidth: 280,
          lineHeight: 1.8,
          pointerEvents: 'auto',
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#c8d6f8', marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 6 }}>
            ⛏️ 模型数据
          </div>

          {dimensions && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: '#556080', fontSize: 10, marginBottom: 2 }}>📐 尺寸</div>
              <div style={{ color: '#e8eaf0', fontWeight: 600, fontSize: 13 }}>
                长 {dimensions.length} × 宽 {dimensions.width} × 高 {dimensions.height}
              </div>
            </div>
          )}

          {/* Pre-cut info */}
          {preClipPlane && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#c8d6f8', marginTop: 8, marginBottom: 6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 }}>
                🔪 预切割参数
              </div>
              <div style={{ color: '#8090b0' }}>
                角度：<span style={{ color: '#7ec8e3', fontWeight: 600 }}>{config.cutAngle}°</span>
              </div>
              <div style={{ color: '#8090b0' }}>
                深度：<span style={{ color: '#7ec8e3', fontWeight: 600 }}>{config.cutDepth}%</span>
              </div>
            </div>
          )}

          {/* Volume info */}
          {preClipPlane && fullVolume !== null && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#c8d6f8', marginTop: 8, marginBottom: 6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 }}>
                📊 体积信息
              </div>
              <div style={{ color: '#8090b0', marginBottom: 2 }}>
                总体积：<span style={{ color: '#a0c0ff', fontWeight: 600 }}>{formatVolume(fullVolume)}</span>
              </div>
              {remainingVolume !== null && (
                <>
                  <div style={{ color: '#8090b0', marginBottom: 2 }}>
                    剩余体积：<span style={{ color: '#4ade80', fontWeight: 600 }}>{formatVolume(remainingVolume)}</span>
                  </div>
                  <div style={{ color: '#8090b0', marginBottom: 2 }}>
                    已用体积：<span style={{ color: '#fb923c', fontWeight: 600 }}>{formatVolume(fullVolume - remainingVolume)}</span>
                    <span style={{ color: '#6070a0', fontSize: 10 }}>
                      {' '}({fullVolume > 0 ? ((fullVolume - remainingVolume) / fullVolume * 100).toFixed(1) : 0}%)
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Slice params */}
          {config.cutN > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: '#556080', fontSize: 10, marginBottom: 2 }}>⚙️ 切割参数</div>
              <div style={{ color: '#8090b0' }}>
                N = <span style={{ color: '#7ec8e3', fontWeight: 600 }}>{config.cutN}</span>
                {' | '}
                R = <span style={{ color: '#7ec8e3', fontWeight: 600 }}>{config.cutR}</span>
              </div>
            </div>
          )}

          {/* Slice results */}
          {cutResult && showSlice && (
            <>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#c8d6f8', marginTop: 10, marginBottom: 6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 }}>
                📊 切割结果
              </div>
              <div style={{ color: '#8090b0', marginBottom: 4 }}>
                总体积：<span style={{ color: '#ffd700', fontWeight: 600 }}>{formatVolume(cutResult.totalVolume)}</span>
              </div>
              <div style={{ color: '#8090b0', marginBottom: 6 }}>
                切割轴：<span style={{ color: '#a0c0ff', fontWeight: 600 }}>{cutResult.axis.toUpperCase()} 轴</span>
                {' · '}{cutResult.cutPlanes.length} 刀 → {cutResult.sliceVolumes.length} 块
              </div>
              <div style={{
                maxHeight: 200, overflowY: 'auto',
                scrollbarWidth: 'thin', scrollbarColor: '#2e3254 transparent',
                display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                {cutResult.sliceVolumes.map((vol, i) => {
                  const total = cutResult.sliceVolumes.length;
                  const dotColor = `hsl(${(i / total) * 360}, 75%, 52%)`;
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '3px 6px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.03)',
                      fontSize: 11,
                    }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: dotColor, flexShrink: 0,
                      }} />
                      <span style={{ flex: 1, color: '#a0b0d0' }}>第 {i + 1} 块</span>
                      <span style={{ color: '#ffd700', fontWeight: 600, fontSize: 11 }}>
                        {formatVolume(vol)}
                      </span>
                      <span style={{ color: '#6070a0', fontSize: 10, minWidth: 36, textAlign: 'right' }}>
                        {cutResult.slicePercentages[i]}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Mode info */}
          <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6, color: '#556080', fontSize: 10 }}>
            模式：{config.mode === 'cutFace' ? '🔪 切割面' : '🧊 切割体'}
            {' | '}多刀：{config.cutN > 0 ? `N=${config.cutN}` : '关'}
          </div>

        </div>
      )}
    </div>
  );
}
