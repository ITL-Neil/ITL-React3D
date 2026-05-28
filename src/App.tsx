import { ITL3D } from '../component/ITL3D'
import './App.css'

function App() {
  return (
    <main className="page">
      <h1 className="title">ITL3D Element Demo</h1>
      <div className="frame">
        <ITL3D
          modelUrl="/Hohenzollern_output.glb"
          mode="cutBody"
          cutDepth={35}
          cutAngle={0}
          cutN={3}
          showCuttingSurface={true}
          cutFaceMaskColor="#ff4d4f"
          cutBodyMaskColor="#ffffff"
          showCutBodyWireframe={false}
          faceNCutsView="FaceAndBody"
          modelOpacityForFaceOrBoth={0.65}
          overlayOpacityForBodyOrBoth={0.65}
          cutBodyDepthOpacity={0.7}
          cutBodyNCutsOpacity={0.65}
          orientation={10}
          canRotate={true}
          canDrag={true}
          autoRotate={false}
        />
      </div>
    </main>
  )
}

export default App
