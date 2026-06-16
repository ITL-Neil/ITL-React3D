# ITL3D 组件使用指南
![alt text](image.png)
---

# 使用

1. Place component in the React project
2. npm install
3. Use the component
4. npm run dev
---

## 📦 组件简介

ITL3D 是一个基于 React Three Fiber 的 3D 模型展示和切割组件，支持两种切割模式：
- **cutFace**: 切割面模式，显示切割截面的颜色
- **cutBody**: 切割体模式，显示被切割部分的透明效果

## 📁 文件结构

```
Element/
├── ITL3D.tsx           # 主组件入口
├── PreciseDualModeModel.tsx   # 核心 3D 模型处理组件
├── types.ts                   # TypeScript 类型定义
├── index.ts                   # 导出接口
└── README.md                  # 本文档
```


### 必需的 npm 依赖包
确保目标项目中已安装以下依赖：

```json
{
  "dependencies": {
    "@react-three/drei": "^9.x.x",
    "@react-three/fiber": "^8.x.x",
    "react": "^18.x.x",
    "react-dom": "^18.x.x",
    "three": "^0.143.x"
  }
}
```

安装命令：
```bash
npm install @react-three/fiber @react-three/drei three react react-dom
```

### 必需的 3D 模型文件
- 需要一个 `.glb` 格式的 3D 模型文件
- 默认路径: `/Hohenzollern_Castle_optimized.glb`
- 可通过 `modelUrl` 属性自定义路径
- **请将你的 .glb 文件放到目标项目的 public 目录下**

## 🚀 使用方法

### 快速开始（推荐）

1. **复制整个 Element 文件夹**到目标项目根目录
2. **确保依赖已安装**（见上方依赖说明）
3. **放置 3D 模型文件**到目标项目的 public 目录

在目标项目中使用：
```tsx
import { ITL3D } from './Element'

function App() {
  return (
    <div style={{ width: '800px', height: '600px' }}>
      <ITL3D
        modelUrl="/your-model.glb"
        mode="cutBody"
        cutDepth={35}
        cutAngle={0}
        canRotate={true}
      />
    </div>
  )
}
```

## 📝 Props 参数说明

| 参数 | 类型 | 默认值                                 | 说明                | 备注                             |
|------|------|-------------------------------------|-------------------|--------------------------------|
| `modelUrl` | string | - | 3D 模型文件路径         |- |
| `mode` | `'cutFace' \| 'cutBody'` | `'cutFace'`                         | 切割模式              |- |
| `cutDepth` | number | `0`                                 | 切割深度 (0-100)      |- |
| `cutAngle` | number | `0`                                 | 切割角度 (0-360)      |- |
| `cutN` | number | -                                   | 剩余部分打算使用的次数-1     |- |
| `showCuttingSurface` | boolean | true                                | 是否显示切割面           | Face模式下建议打开，否则显示的3D模型内部是透明状态   |
| `cutFaceMaskColor` | string | `'#ff6b6b'`                         | 切割面颜色             |- |
| `cutBodyMaskColor` | string | -                                   | 切割体颜色             |- |
| `showCutBodyWireframe` | boolean | `false`                             | 是否显示线框            | 打开会加载模型细节线条并描绘，建议关闭提高性能。       |
| `faceNCutsView` | `'Face' \| 'Body' \| 'FaceAndBody'` | - |剩余部分切割视图模式                          |- |
| `modelOpacityForFaceOrBoth` | number | `0.45`                              | 模型透明度             |- |
| `overlayOpacityForBodyOrBoth` | number | `0.82`                              | 覆盖层透明度            |- |
| `cutBodyDepthOpacity` | number | `0.5`                               | 切割体深度透明度          |- |
| `cutBodyNCutsOpacity` | number | `0.72`                              | 剩余部分切割透明度           |- |
| `orientation` | number | `4`                                 | 相机方向 (1-12, 时钟位置) | 针对于模型创建时候xyz轴进行设置，y轴负半轴为12点钟方向 |
| `canRotate` | boolean | `false`                             | 是否允许旋转            | 打开后允许用户旋转模型角度观察不同角度            |
| `canDrag` | boolean | `false`                             | 是否允许拖拽            | 打开后允许用户拖拽模型在画布中的位置观察不同角度       |
| `autoRotate` | boolean | `false`                             | 是否自动旋转            |打开后模型会自动旋转。            |
| `className` | string | -                                   | CSS 类名            |目前暂无使用|
| `style` | CSSProperties | -                                   | 内联样式              |目前暂无使用|

## 💡 使用示例

### 基础用法
```tsx
<ITL3D
  modelUrl="/model.glb"
  mode="cutFace"
  cutDepth={50}
/>
```

### 高级用法
```tsx
<ITL3D
  modelUrl="/castle.glb"
  mode="cutBody"
  cutDepth={0}
  cutAngle={0}
  cutN={3}
  showCuttingSurface={true}
  cutFaceMaskColor="#ff4d4f"
  cutBodyMaskColor="#ffffff"
  faceNCutsView="FaceAndBody"
  orientation={4}
  canRotate={true}
  canDrag={true}
  autoRotate={false}
/>
```

