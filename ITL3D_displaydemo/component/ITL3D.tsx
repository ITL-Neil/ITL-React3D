import React, { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { PreciseDualModeModel } from './PreciseDualModeModel'
import type { ITL3DProps } from './types'

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

export function ITL3D({
  modelUrl = DEFAULT_MODEL_URL,
  mode = 'cutFace',
  cutDepth = 0,
  cutAngle = 0,
  cutN,
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
  className,
  style,
}: ITL3DProps) {
  const cameraPosition = useMemo(() => toClockCameraPosition(orientation, 10, 5), [orientation])
  const multiCutCount = Math.max(0, Math.floor(Number.isFinite(cutN as number) ? (cutN as number) : 0))
  const resolvedShowCuttingSurface =
    typeof showCuttingSurface === 'boolean' ? showCuttingSurface : mode === 'cutBody'

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 50, position: cameraPosition }}
        gl={{ antialias: true, localClippingEnabled: true, stencil: true }}
      >
        <color attach="background" args={['#101010']} />
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} castShadow />

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




