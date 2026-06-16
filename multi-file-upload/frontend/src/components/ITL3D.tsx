import React, { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, ContactShadows } from '@react-three/drei'
import { PreciseDualModeModel } from './PreciseDualModeModel'
import type { ITL3DProps } from './ITL3D_types'

const DEFAULT_MODEL_URL = '/Hohenzollern_Castle_opeimized_compress.glb'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function toClockCameraPosition(orientation: number, radius: number, z: number): [number, number, number] {
  const safe = Number.isFinite(orientation) ? orientation : 4
  const n = ((Math.round(safe) - 1 + 12) % 12) + 1
  const theta = ((n - 3) * Math.PI) / 6
  return [Math.cos(theta) * radius, Math.sin(theta) * radius, z]
}

// ── 灯光预设：不同光照风格 ──
interface LightDef {
  position: [number, number, number]
  intensity: number
  color: string
}

interface PresetDef {
  ambient: number
  lights: LightDef[]
}

const LIGHTING_PRESETS: Record<string, PresetDef> = {
  rembrandt: {
    ambient: 0.25,
    lights: [
      { position: [8, 6, 4],  intensity: 1.5, color: '#ffeedd' },
      { position: [-4, 2, -4], intensity: 0.4, color: '#ddeeff' },
    ],
  },
  portrait: {
    ambient: 0.4,
    lights: [
      { position: [0, 3, 10], intensity: 1.8, color: '#ffffff' },
    ],
  },
  upfront: {
    ambient: 0.55,
    lights: [
      { position: [0, 2, 8], intensity: 2.0, color: '#ffffff' },
      { position: [0, -1, 6], intensity: 0.5, color: '#ffffff' },
    ],
  },
  soft: {
    ambient: 0.75,
    lights: [
      { position: [3, 8, 5],  intensity: 0.8, color: '#ffffff' },
      { position: [-4, 2, -3], intensity: 0.5, color: '#eef0ff' },
    ],
  },
}

const DEFAULT_PRESET = 'rembrandt'

export function ITL3D({
  modelUrl = DEFAULT_MODEL_URL,
  mode = 'cutFace',
  cutDepth = 0,
  cutAngle = 0,
  cutN,
  cutR,
  showCuttingSurface = true,
  cutFaceMaskColor = '#ff6b6b',
  cutBodyMaskColor,
  showCutBodyWireframe = false,
  faceNCutsView = 'FaceAndBody',
  modelOpacityForFaceOrBoth = 0.45,
  overlayOpacityForBodyOrBoth = 0.82,
  cutBodyDepthOpacity = 0.5,
  cutBodyNCutsOpacity = 0.72,
  orientation = 4,
  canRotate = false,
  canDrag = false,
  autoRotate = false,
  // ── 场景参数 ──
  background = '#101010',
  shadows = true,
  preset = DEFAULT_PRESET,
  lightIntensity = 1.0,
  contactShadow = true,
  className,
  style,
}: ITL3DProps) {
  const cameraPosition = useMemo(() => toClockCameraPosition(orientation, 10, 5), [orientation])
  const multiCutCount = Math.max(0, Math.floor(Number.isFinite(cutN as number) ? (cutN as number) : 0))
  const resolvedShowCuttingSurface =
    typeof showCuttingSurface === 'boolean' ? showCuttingSurface : mode === 'cutBody'

  // 灯光预设
  const presetDef = LIGHTING_PRESETS[preset] ?? LIGHTING_PRESETS[DEFAULT_PRESET]

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <Canvas
        shadows={shadows}
        dpr={[1, 2]}
        camera={{ fov: 50, position: cameraPosition }}
        gl={{ antialias: true, localClippingEnabled: true, stencil: true }}
      >
        {/* 动态背景色 */}
        <color attach="background" args={[background]} />

        <Suspense fallback={null}>
          {/* 环境光 */}
          <ambientLight intensity={presetDef.ambient * lightIntensity} />

          {/* 预设方向光 + Contact Shadows 仅由第一盏灯投射 */}
          {presetDef.lights.map((light, i) => (
            <React.Fragment key={`light-${i}`}>
              <directionalLight
                position={light.position}
                intensity={light.intensity * lightIntensity}
                color={light.color}
                castShadow={shadows && i === 0}
              />
              {shadows && contactShadow && i === 0 && (
                <ContactShadows
                  position={[0, -0.01, 0]}
                  opacity={0.45}
                  scale={10}
                  blur={2.5}
                  far={4}
                />
              )}
            </React.Fragment>
          ))}

          <PreciseDualModeModel
            modelUrl={modelUrl}
            cutDepth={clamp(cutDepth, 0, 100)}
            cutAngle={clamp(cutAngle, 0, 360)}
            showCutPlane={resolvedShowCuttingSurface}
            mode={mode}
            capColor={cutFaceMaskColor}
            cutBodyMaskColor={cutBodyMaskColor}
            showCutBodyWireframe={showCutBodyWireframe}
            multiCutCount={multiCutCount}
            cutR={Number.isFinite(cutR as number) ? (cutR as number) : 96}
            cutFaceMultiStyle={faceNCutsView}
            faceOnlyBaseOpacity={clamp(modelOpacityForFaceOrBoth, 0.05, 1)}
            cutFaceOverlayOpacity={clamp(overlayOpacityForBodyOrBoth, 0.05, 1)}
            cutBodyRemovedOpacity={clamp(cutBodyDepthOpacity, 0.05, 1)}
            cutBodyLayeredOpacity={clamp(cutBodyNCutsOpacity, 0.05, 1)}
          />
        </Suspense>

        <OrbitControls
          enabled={canRotate || canDrag}
          enableRotate={canRotate}
          enablePan={canDrag}
          autoRotate={autoRotate}
        />
      </Canvas>
    </div>
  )
}
