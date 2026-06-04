# Frontend — 拖拽上传组件 & 压缩 API Hook

> React 18 + TypeScript 前端组件库，提供两大核心能力：
>
> 1. **DragUpload**：通用文件拖拽上传组件，内置 84 种 3D 格式白名单校验
> 2. **useCompressApi**：封装上传 → 压缩完整流程的 React Hook，零外部依赖

---

## 目录

- [文件清单](#文件清单)
- [环境要求](#环境要求)
- [DragUpload 组件](#dragupload-组件)
  - [Props 说明](#props-说明)
  - [使用示例](#使用示例)
- [useCompressApi Hook](#usecompressapi-hook)
  - [返回值说明](#返回值说明)
  - [使用示例](#使用示例-1)
- [支持的文件格式](#支持的文件格式)

---

## 文件清单

```
component/frontend/
├── DragUpload.tsx        # 拖拽上传 React 组件
├── DragUpload.css        # 组件样式
├── useCompressApi.ts     # 上传+压缩 React Hook
├── index.ts              # 统一导出入口
└── README.md             # 本文件
```

---

## 环境要求

| 依赖 | 版本要求 |
|------|----------|
| React | ≥ 18 |
| TypeScript | ≥ 5 |
| Vite / CRA / Next.js | 任意，无特殊要求 |

无需安装任何额外 npm 包。

---

## DragUpload 组件

拖拽或点击上传文件，自动校验扩展名白名单。

### Props 说明

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `onFilesSelected` | `(files: File[]) => void` | **必填** | 文件通过校验后的回调 |
| `allowedExtensions` | `readonly string[]` | `DEFAULT_ALLOWED_EXTENSIONS`（84 种） | 允许的文件扩展名（小写，不含点） |
| `multiple` | `boolean` | `true` | 是否允许多选 |
| `hint` | `string` | `'选择或拖拽文件上传'` | 主提示文字 |
| `subHint` | `string` | `undefined` | 副提示文字 |
| `disabled` | `boolean` | `false` | 禁用状态 |

### 使用示例

#### 基础用法

```tsx
import { DragUpload } from './components/GlbCompress';

function Page() {
  return (
    <DragUpload
      onFilesSelected={(files) => {
        console.log('已选择:', files);
      }}
    />
  );
}
```

#### 单选 + 限定格式

```tsx
<DragUpload
  allowedExtensions={['glb', 'fbx', 'obj']}
  multiple={false}
  hint="拖拽 3D 文件到此处"
  subHint="支持 GLB、FBX、OBJ 格式"
  onFilesSelected={(files) => doUpload(files[0])}
/>
```

---

## useCompressApi Hook

封装完整的「上传 → 格式转换 → 压缩 → 下载」流程。零外部依赖，自动管理异步状态。

### 返回值说明

```tsx
const {
  status,       // 'idle' | 'uploading' | 'processing' | 'success' | 'error'
  isBusy,       // status === 'uploading' || status === 'processing' 的快捷值
  error,        // 错误信息字符串
  stats,        // CompressStats | null — 压缩统计
  downloadUrl,  // Blob URL 字符串 — 可直接用于 <a href>
  compress,     // (file: File) => Promise<void> — 执行上传压缩
  reset,        // () => void — 重置到 idle 并释放 Blob URL
  download,     // () => void — 触发浏览器下载
} = useCompressApi(options?);
```

**CompressStats**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `originalSize` | `number` | 原始文件大小（字节） |
| `compressedSize` | `number` | 压缩后文件大小（字节） |
| `ratio` | `string` | 压缩率（如 `"35.2"`） |
| `fileName` | `string` | 下载文件名 |

**CompressApiOptions**:

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiUrl` | `string` | `VITE_API_URL` 或 `http://localhost:5100/api/compress` | 后端地址 |
| `fieldName` | `string` | `"file"` | 表单字段名 |

### 使用示例

#### 完整集成（DragUpload + useCompressApi）

```tsx
import { DragUpload, useCompressApi, formatBytes } from './components/GlbCompress';

function CompressPage() {
  const {
    status, isBusy, error, stats,
    compress, download
  } = useCompressApi({
    apiUrl: 'http://localhost:5100/api/compress'
  });

  async function handleFiles(files: File[]) {
    await compress(files[0]);
    download(); // 自动触发下载
  }

  return (
    <div>
      <DragUpload
        onFilesSelected={handleFiles}
        disabled={isBusy}
        multiple={false}
        hint="拖拽 3D 文件到此处"
      />

      {isBusy && <div className="progress">
        {status === 'uploading' ? '上传中...' : '压缩处理中...'}
      </div>}

      {status === 'success' && stats && (
        <div className="result">
          <p>压缩完成！</p>
          <p>原始：{formatBytes(stats.originalSize)}</p>
          <p>压缩后：{formatBytes(stats.compressedSize)}</p>
          <p>压缩率：{stats.ratio}%</p>
          <a href={downloadUrl} download={stats.fileName}>重新下载</a>
        </div>
      )}

      {status === 'error' && (
        <p className="error">{error}</p>
      )}
    </div>
  );
}
```

#### 手动下载

```tsx
const { compress, downloadUrl, stats } = useCompressApi();

// 不自动触发下载，让用户自己点击
async function handleFiles(files: File[]) {
  await compress(files[0]);
}

// JSX:
<a href={downloadUrl} download={stats?.fileName}>下载压缩文件</a>
```

#### 使用 formatBytes 工具函数

```tsx
import { formatBytes } from './components/GlbCompress';

console.log(formatBytes(1024));       // "1 KB"
console.log(formatBytes(1536000));    // "1.5 MB"
console.log(formatBytes(0));          // "0 B"
```

---

## 支持的文件格式

共 **84 种** 扩展名，与后端 `GlbConverter` 完全对齐。

<details>
<summary>点击展开完整列表</summary>

| | | | |
|---|---|---|---|
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

</details>

若某格式存在多个常见扩展名（如 STEP 对应 `.step` 和 `.stp`），两者均已收录。
