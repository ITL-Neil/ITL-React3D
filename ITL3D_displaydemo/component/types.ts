import type { CSSProperties } from 'react'

export type ITL3DMode = 'cutFace' | 'cutBody'
export type FaceNCutsView = 'Face' | 'Body' | 'FaceAndBody'

export interface ITL3DProps {
  modelUrl?: string

  mode?: ITL3DMode
  cutDepth?: number
  cutAngle?: number
  cutN?: number

  showCuttingSurface?: boolean
  cutFaceMaskColor?: string
  cutBodyMaskColor?: string
  showCutBodyWireframe?: boolean

  faceNCutsView?: FaceNCutsView
  modelOpacityForFaceOrBoth?: number
  overlayOpacityForBodyOrBoth?: number

  cutBodyDepthOpacity?: number
  cutBodyNCutsOpacity?: number

  orientation?: number
  canRotate?: boolean
  canDrag?: boolean
  autoRotate?: boolean

  className?: string
  style?: CSSProperties
}

