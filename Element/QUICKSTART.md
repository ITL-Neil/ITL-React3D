# 🚀 ITL3D 快速开始指南

## 📋 前置要求

在开始之前，请确保你的项目满足以下要求：

1. **React 项目** - 需要 React 18+
2. **TypeScript 支持**（可选但推荐）
3. **已安装以下依赖**：
   ```bash
   npm install @react-three/fiber @react-three/drei three react react-dom
   ```

## 📦 安装步骤

### 步骤 1: 复制 Element 文件夹

将整个 `Element` 文件夹复制到你的项目根目录。

```
your-project/
├── Element/          ← 复制到这里
├── src/
├── public/
└── package.json
```

### 步骤 2: 准备 3D 模型

将你的 `.glb` 格式 3D 模型文件放到 `public` 目录下：

```
public/
└── your-model.glb    ← 放置在这里
```

### 步骤 3: 在组件中使用

在你的 React 组件中导入并使用：

```tsx
import { ITL3D } from './Element'

function App() {
  return (
    <div style={{ width: '800px', height: '600px' }}>
      <ITL3D
        modelUrl="/your-model.glb"
        mode="cutFace"
        cutDepth={50}
      />
    </div>
  )
}

export default App
```

## 💡 基础示例

### 示例 1: 简单的切割面模式

```tsx
<ITL3D
  modelUrl="/model.glb"
  mode="cutFace"
  cutDepth={50}
/>
```

### 示例 2: 切割体模式（可旋转）

```tsx
<ITL3D
  modelUrl="/model.glb"
  mode="cutBody"
  cutDepth={35}
  canRotate={true}
/>
```

### 示例 3: 多刀切割

```tsx
<ITL3D
  modelUrl="/model.glb"
  mode="cutFace"
  cutDepth={30}
  cutN={3}              // 切 3 刀
  faceNCutsView="FaceAndBody"
/>
```

## 🔧 常用配置

### 调整切割深度和角度

```tsx
<ITL3D
  cutDepth={50}    // 0-100, 切割深度百分比
  cutAngle={45}    // 0-360, 切割角度（度）
/>
```

### 自定义颜色

```tsx
<ITL3D
  cutFaceMaskColor="#ff4d4f"     // 切割面颜色
  cutBodyMaskColor="#ffffff"     // 切割体颜色
/>
```

### 启用交互

```tsx
<ITL3D
  canRotate={true}      // 允许旋转
  canDrag={true}        // 允许拖拽
  autoRotate={false}    // 自动旋转
/>
```

### 调整相机视角

```tsx
<ITL3D
  orientation={4}  // 1-12, 时钟位置（4点方向）
/>
```

## 🎨 两种切割模式

### cutFace - 切割面模式
- 显示切割截面的颜色
- 适合展示内部结构
- 支持多刀彩色截面

### cutBody - 切割体模式
- 显示被切割部分的透明效果
- 保留原模型颜色和纹理
- 适合展示切除效果

## 📝 完整参数参考

查看所有可用参数，请参考 [README.md](./README.md) 中的 Props 参数说明部分。

## ❓ 遇到问题？

### 组件不显示
1. 检查是否安装了所有依赖
2. 确认模型文件路径正确
3. 查看浏览器控制台是否有错误

### TypeScript 报错
确保你的项目支持 TypeScript，或参考 README 中的解决方案。

### 更多帮助
查看 [example.tsx](./example.tsx) 文件获取更多使用示例。

## 🎉 开始使用

现在你已经准备好了！尝试不同的参数组合，创造出你想要的 3D 切割效果吧！
