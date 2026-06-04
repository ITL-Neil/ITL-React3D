# Component 可复用组件库

本目录提供两个可独立集成的可复用组件：

1. **前端拖拽上传组件**（`frontend/`）：基于 React + TypeScript，支持拖拽与点击选择文件，内置文件扩展名白名单校验。
2. **后端 GLB 压缩方法**（`backend/`）：基于 C# + .NET，封装调用 `gltf-transform` CLI 对 GLB 文件进行 Draco 网格压缩与 WebP 纹理压缩，输出文件名携带随机 UUID。

---

## 目录结构

```
component/
├── frontend/
│   ├── DragUpload.tsx      # 拖拽上传 React 组件
│   ├── DragUpload.css      # 组件样式（可选引入）
│   └── README.md           # 前端组件使用说明
├── backend/
│   ├── GlbCompressor.cs    # GLB 压缩核心类
│   └── README.md           # 后端集成使用说明
└── README.md               # 本文件
```

---

## 前后端配合使用流程

```
用户拖拽/选择文件
       │
       ▼
[前端] DragUpload 组件
  - 校验扩展名（allowedExtensions 白名单）
  - 校验通过 → 调用 onFilesSelected 回调
       │
       ▼
[前端] 业务层
  - 构造 FormData，将文件 POST 至后端 /api/compress
       │
       ▼
[后端] ASP.NET Core 控制器 / 最小 API
  - 接收上传文件
  - 调用 GlbCompressor.CompressGlb(inputPath, outputPath)
       │
       ▼
[后端] GlbCompressor
  - 调用 gltf-transform CLI 执行 Draco + WebP 压缩
  - 输出文件名：{原始文件名}_{UUID}.glb
       │
       ▼
[前端] 接收压缩后的 GLB 文件流，触发下载
```

---

## 快速集成步骤

### 前端

1. 将 `frontend/DragUpload.tsx`（及可选的 `DragUpload.css`）复制到你的项目中。
2. 安装依赖：无额外 npm 包，仅需项目已有 React 18+ 与 TypeScript。
3. 在页面中引入组件并传入 `onFilesSelected` 回调，详见 `frontend/README.md`。

### 后端

1. 将 `backend/GlbCompressor.cs` 复制到你的 .NET 项目中。
2. 确保目标机器已安装 `gltf-transform`（`npm install -g @gltf-transform/cli`）。
3. 在 API 端点中调用 `GlbCompressor.CompressGlbAsync(...)` 即可，详见 `backend/README.md`。

---

## 注意事项

- 当前后端**仅支持 GLB 文件压缩**，不含模型格式转换功能。
- 前端组件默认允许的扩展名列表覆盖主流 3D 文件格式（共 80+ 种），详见 `frontend/README.md`。
- 如需在演示环境中完整运行，请参考 `../component_demo/README.md`。
