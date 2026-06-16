import { useRef, useCallback, useEffect, Suspense, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// ── Draco decoder setup (bundled path for mobile/Capacitor) ──
const dracoLoader = new DRACOLoader();
// In Vite, files in /public are served at root. After Ionic build,
// these must be copied into the app bundle (e.g. via `assets` in capacitor.config.ts).
dracoLoader.setDecoderPath('/draco/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

// ── R3F sub-component: displays a pre-loaded THREE.Group ──
//    This is lightweight — no GLTF parsing, just adding to the scene graph.
function SceneModel({ group, onReady }: { group: THREE.Group; onReady?: () => void }) {
  const { camera, controls } = useThree() as {
    camera: THREE.PerspectiveCamera;
    controls: any;
  };
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fittedRef.current) return;
    fittedRef.current = true;

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const fov = camera.fov * (Math.PI / 180);
    const dist = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 2.4;

    if (controls) {
      controls.target.copy(center);
      controls.minDistance = dist * 0.1;
      controls.maxDistance = dist * 5;
      controls.update();
    }
    camera.position.set(center.x, center.y + size.y * 0.1, center.z + dist);
    onReady?.();
  }, [group, camera, controls, onReady]);

  return <primitive object={group} />;
}

// ── Main ModelViewer component ──
export interface ModelViewerProps {
  modelUrl: string | null;
  autoRotate?: boolean;
  showShadows?: boolean;
  ambientIntensity?: number;
  directionalIntensity?: number;
  background?: string;
  onLoaded?: () => void;
  onCaptureRef?: (fn: () => void) => void;
}

export default function ModelViewer({
  modelUrl,
  autoRotate = false,
  showShadows = true,
  ambientIntensity = 0.5,
  directionalIntensity = 1.0,
  background = '#f0f0f0',
  onLoaded,
  onCaptureRef,
}: ModelViewerProps) {
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── Load model OUTSIDE React's render cycle ──
  const [loadedGroup, setLoadedGroup] = useState<THREE.Group | null>(null);
  const [loading, setLoading] = useState(false);
  const loadTokenRef = useRef(0);
  // Track previous group for disposal (prevents memory leaks on mobile)
  const prevGroupRef = useRef<THREE.Group | null>(null);

  // Dispose old model on unmount / URL change
  const disposeGroup = useCallback((g: THREE.Group | null) => {
    if (!g) return;
    g.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!modelUrl) {
      disposeGroup(prevGroupRef.current);
      prevGroupRef.current = null;
      setLoadedGroup(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    // Dispose previous model lazily — don't block the new load
    const oldGroup = prevGroupRef.current;
    if (oldGroup) {
      // Small delay so disposal doesn't compete with new load
      setTimeout(() => disposeGroup(oldGroup), 100);
    }
    setLoadedGroup(null);

    // Cancel stale loads
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;

    loader.load(
      modelUrl,
      (gltf) => {
        if (token !== loadTokenRef.current) return; // stale
        prevGroupRef.current = gltf.scene;
        setLoadedGroup(gltf.scene);
        setLoading(false);
      },
      undefined, // onProgress — optional
      (err) => {
        if (token !== loadTokenRef.current) return;
        console.error('GLTF load error:', err);
        setLoading(false);
      },
    );
  }, [modelUrl, disposeGroup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disposeGroup(prevGroupRef.current);
    };
  }, [disposeGroup]);

  const doCapture = useCallback(() => {
    const canvas = captureCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `model-${Date.now()}.png`;
    a.click();
  }, []);

  useEffect(() => {
    if (onCaptureRef) onCaptureRef(doCapture);
  }, [doCapture, onCaptureRef]);

  // Canvas always renders; show skeleton when loading
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        key={modelUrl ?? 'empty'}   // clean re-creation on model change
        shadows={showShadows}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          preserveDrawingBuffer: true,
        }}
        style={{ position: 'absolute', inset: 0 }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color(background));
          captureCanvasRef.current = gl.domElement;
        }}
      >
        {/* Lighting */}
        <ambientLight intensity={ambientIntensity} />
        <directionalLight
          position={[10, 10, 5]}
          intensity={directionalIntensity}
          castShadow={showShadows}
        />

        <Suspense fallback={null}>
          {loadedGroup && (
            <SceneModel group={loadedGroup} onReady={onLoaded} />
          )}

          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            autoRotate={autoRotate}
            autoRotateSpeed={1.5}
          />
        </Suspense>
      </Canvas>

      {/* Skeleton overlay while loading */}
      {loading && (
        <div
          className="skeleton-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            background: '#f5f5f5',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 12,
              background:
                'linear-gradient(90deg, #e8e8e8 25%, #f5f5f5 50%, #e8e8e8 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeletonShimmer 1.5s infinite',
            }}
          />
          <div
            style={{
              width: 200,
              height: 12,
              borderRadius: 6,
              background:
                'linear-gradient(90deg, #e8e8e8 25%, #f5f5f5 50%, #e8e8e8 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeletonShimmer 1.5s infinite',
            }}
          />
        </div>
      )}
    </div>
  );
}
