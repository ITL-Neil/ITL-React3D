# DragUpload — 前端拖拽上传组件

> React 18 + TypeScript 实现的通用文件拖拽上传组件，内置文件扩展名白名单校验，与业务完全解耦。

---

## 目录

- [功能特性](#功能特性)
- [文件清单](#文件清单)
- [安装与引入](#安装与引入)
- [Props 说明](#props-说明)
- [使用示例](#使用示例)
- [支持的文件格式](#支持的文件格式)

---

## 功能特性

- ✅ 拖拽文件到区域自动校验并触发回调
- ✅ 点击区域打开系统文件选择对话框
- ✅ 键盘可访问性（`Enter` / `Space` 触发）
- ✅ 文件扩展名白名单校验，不符合格式给出内联错误提示
- ✅ 支持多选 / 单选切换
- ✅ 禁用状态
- ✅ 零额外 npm 依赖（仅依赖 React 18+）

---

## 文件清单

```
component/frontend/
├── DragUpload.tsx    # 组件主体
└── DragUpload.css    # 组件样式（可选替换为 Tailwind / CSS Module）
```

---

## 安装与引入

### 1. 复制文件

将 `DragUpload.tsx` 和 `DragUpload.css` 复制到你的项目源码目录，例如：

```
src/components/DragUpload/
├── DragUpload.tsx
└── DragUpload.css
```

### 2. 环境要求

| 依赖 | 版本要求 |
|------|----------|
| React | ≥ 18 |
| TypeScript | ≥ 5 |
| Vite / CRA / Next.js | 任意，无特殊要求 |

无需安装任何额外 npm 包。

### 3. 在代码中引入

```tsx
import DragUpload from './components/DragUpload/DragUpload';
```

---

## Props 说明

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `onFilesSelected` | `(files: File[]) => void` | **必填** | 文件通过校验后的回调，参数为 `File[]` |
| `allowedExtensions` | `readonly string[]` | `DEFAULT_ALLOWED_EXTENSIONS`（见下方完整列表） | 允许的文件扩展名数组，小写，不含点号 |
| `multiple` | `boolean` | `true` | 是否允许多选 |
| `hint` | `string` | `'选择或拖拽文件上传'` | 拖拽区域主提示文字 |
| `subHint` | `string` | `undefined` | 拖拽区域副提示文字 |
| `disabled` | `boolean` | `false` | 禁用状态，禁用后不可交互 |

---

## 使用示例

### 基础用法（使用默认允许格式）

```tsx
import DragUpload from './components/DragUpload/DragUpload';

function MyPage() {
  function handleFilesSelected(files: File[]) {
    console.log('已选择文件：', files);
    // 在此处上传或处理文件
  }

  return (
    <DragUpload onFilesSelected={handleFilesSelected} />
  );
}
```

### 仅允许 GLB 文件（单选）

```tsx
<DragUpload
  allowedExtensions={['glb']}
  multiple={false}
  hint="拖拽 GLB 文件到此处"
  subHint="仅支持 .glb 格式"
  onFilesSelected={(files) => {
    const glbFile = files[0];
    uploadToServer(glbFile);
  }}
/>
```

### 自定义多种格式

```tsx
<DragUpload
  allowedExtensions={['glb', 'gltf', 'fbx', 'obj']}
  multiple={true}
  onFilesSelected={(files) => {
    for (const file of files) {
      console.log(file.name, file.size);
    }
  }}
/>
```

### 配合上传逻辑（发送到后端）

```tsx
import { useState } from 'react';
import DragUpload from './components/DragUpload/DragUpload';

function UploadPage() {
  const [status, setStatus] = useState('');

  async function handleFilesSelected(files: File[]) {
    setStatus('上传中...');
    const formData = new FormData();
    formData.append('file', files[0]);

    const res = await fetch('/api/compress', { method: 'POST', body: formData });
    if (res.ok) {
      setStatus('压缩成功！');
      const blob = await res.blob();
      // 触发下载...
    } else {
      setStatus('上传失败');
    }
  }

  return (
    <div>
      <DragUpload
        allowedExtensions={['glb']}
        multiple={false}
        onFilesSelected={handleFilesSelected}
      />
      <p>{status}</p>
    </div>
  );
}
```

---

## 支持的文件格式

> 以下为 `DEFAULT_ALLOWED_EXTENSIONS` 默认白名单，共 **84 种**扩展名，以列表中的扩展名为准。

| 扩展名 | 扩展名 | 扩展名 | 扩展名 |
|--------|--------|--------|--------|
| glb | gltf | ply | stl |
| obj | off | dae | fbx |
| dxf | ifc | xyz | pcd |
| las | laz | stp | step |
| 3dxml | iges | igs | shp |
| geojson | xaml | pts | asc |
| brep | fcstd | bim | usdz |
| pdb | vtk | svg | wrl |
| 3dm | 3ds | amf | 3mf |
| dwg | json | rfa | rvt |
| cvs | gpkg | ac | zgl |
| x | ter | smd | sib |
| q3o | q3s | ogex | nff |
| ms3d | mdl | md5mesh | md2 |
| lws | hmp | irrmesh | x3d |
| vrml | b3dm | xyzrgb | x3dv |
| vtu | urdf | ugrid | su2 |
| babylon | ac3d | bvh | ase |
| wkt | facet | | |

若某格式存在多个常见扩展名（例如 STEP 对应 `.step` 和 `.stp`），两者均已收录于上述列表中，以列表中存在的扩展名为准。
