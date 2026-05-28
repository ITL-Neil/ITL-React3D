/**
 * ITL3D 使用示例
 * 
 * 这是一个简单的示例，展示如何在项目中使用 ITL3D 组件
 */

import React from 'react'
import { ITL3D } from './Element'

// 示例 1: 基础用法 - 切割面模式
export function Example1_BasicCutFace() {
  return (
    <div style={{ width: '800px', height: '600px' }}>
      <ITL3D
        modelUrl="/Hohenzollern_Castle_optimized.glb"
        mode="cutFace"
        cutDepth={50}
        cutAngle={0}
      />
    </div>
  )
}

// 示例 2: 切割体模式
export function Example2_CutBody() {
  return (
    <div style={{ width: '800px', height: '600px' }}>
      <ITL3D
        modelUrl="/Hohenzollern_Castle_optimized.glb"
        mode="cutBody"
        cutDepth={35}
        cutAngle={45}
        canRotate={true}
      />
    </div>
  )
}

// 示例 3: 高级配置 - 多刀切割
export function Example3_AdvancedMultiCut() {
  return (
    <div style={{ width: '800px', height: '600px' }}>
      <ITL3D
        modelUrl="/Hohenzollern_Castle_optimized.glb"
        mode="cutFace"
        cutDepth={30}
        cutAngle={0}
        cutN={3}
        showCuttingSurface={true}
        cutFaceMaskColor="#ff4d4f"
        faceNCutsView="FaceAndBody"
        orientation={4}
        canRotate={true}
        canDrag={true}
        autoRotate={false}
      />
    </div>
  )
}

// 示例 4: 自定义样式和交互
export function Example4_CustomStyle() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ITL3D
        modelUrl="/your-model.glb"
        mode="cutBody"
        cutDepth={40}
        cutAngle={90}
        cutBodyMaskColor="#ffffff"
        showCutBodyWireframe={true}
        orientation={6}
        canRotate={true}
        canDrag={true}
        autoRotate={true}
        style={{ backgroundColor: '#1a1a1a' }}
      />
    </div>
  )
}

// 完整示例：包含所有参数
export function Example5_FullProps() {
  return (
    <div style={{ width: '800px', height: '600px' }}>
      <ITL3D
        // 模型配置
        modelUrl="/Hohenzollern_Castle_optimized.glb"
        
        // 切割模式
        mode="cutFace"  // 'cutFace' | 'cutBody'
        
        // 切割参数
        cutDepth={50}   // 0-100
        cutAngle={0}    // 0-360
        cutN={2}        // 多刀切割数量
        
        // 显示选项
        showCuttingSurface={true}
        cutFaceMaskColor="#ff6b6b"
        cutBodyMaskColor="#ffffff"
        showCutBodyWireframe={false}
        
        // 多刀切割视图
        faceNCutsView="FaceAndBody"  // 'Face' | 'Body' | 'FaceAndBody'
        
        // 透明度控制
        modelOpacityForFaceOrBoth={0.45}
        overlayOpacityForBodyOrBoth={0.82}
        cutBodyDepthOpacity={0.5}
        cutBodyNCutsOpacity={0.72}
        
        // 相机配置
        orientation={4}  // 1-12 (时钟位置)
        canRotate={true}
        canDrag={true}
        autoRotate={false}
        
        // 样式
        className="my-custom-class"
        style={{ borderRadius: '8px' }}
      />
    </div>
  )
}
