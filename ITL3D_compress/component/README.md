# Component 可复用组件库

本目录提供三个可独立集成的可复用组件，覆盖 3D 模型上传、格式转换与压缩的完整流程：

| 组件 | 位置 | 技术栈 | 功能 |
|------|------|--------|------|
| **DragUpload** | `frontend/` | React 18 + TypeScript | 拖拽上传 + 格式白名单校验（84 种格式） |
| **useCompressApi** | `frontend/` | React 18 Hooks | 上传 → 压缩 完整流程封装 |
| **GlbCompressor** | `backend/` | C# .NET 8+ | GLB 文件 Draco 网格 + WebP 纹理压缩 |
| **GlbConverter** | `backend/` | C# + AssimpNet | 84 种 3D 格式 → GLB（glTF 2.0）转换 |
| **CompressApi** | `backend/` | ASP.NET Core Minimal API | 开箱即用的 REST API 端点 |

---

## 目录结构

```
component/
├── frontend/
│   ├── DragUpload.tsx        # 拖拽上传 React 组件
│   ├── DragUpload.css        # 组件样式
│   ├── useCompressApi.ts     # 上传+压缩 React Hook
│   ├── index.ts              # 统一导出入口
│   ├── package.json          # npm 包定义（@itl/glb-compress-frontend）
│   └── README.md             # 前端组件使用说明
├── backend/
│   ├── GlbCompressLib.csproj # .NET 8 类库项目文件
│   ├── GlbCompressor.cs      # GLB 压缩核心类
│   ├── GlbConverter.cs       # 多格式→GLB 转换
│   ├── CompressApi.cs        # REST API 端点模板
│   ├── global.json           # SDK 版本锁定
│   └── README.md             # 后端集成使用说明
└── README.md                 # 本文件
```

---

## 前后端配合使用流程

```
用户拖拽/选择 3D 文件
       │
       ▼
[前端] DragUpload 组件
  - 校验扩展名（84 种格式白名单）
  - 校验通过 → 调用 onFilesSelected 回调
       │
       ▼
[前端] useCompressApi Hook
  - 构造 FormData
  - POST 至 /api/compress
  - 管理状态（idle → uploading → processing → success/error）
  - 接收压缩文件并触发下载
       │
       ▼
[后端] CompressApi（ASP.NET Core Minimal API）
  - 接收 multipart/form-data
  - 校验扩展名（二次安全校验）
       │
       ├─ 已是 GLB ──→ [GlbCompressor] 直接压缩
       │                    │
       └─ 非 GLB ────→ [GlbConverter] 转换为 GLB
                            │
                            └→ [GlbCompressor] 压缩
                                 │
       ◄──────────────────────────┘
  - 返回压缩后的 GLB + 统计响应头
```

---

## 快速集成步骤

### 前端

1. 将 `frontend/` 下所有文件复制到你的 React 项目中。
2. 安装依赖：无额外 npm 包，仅需项目已有 React 18+ 与 TypeScript。
3. 在页面中使用：

```tsx
import { DragUpload, useCompressApi } from './components/GlbCompress';

function App() {
  const { status, isBusy, stats, compress, download } = useCompressApi();

  return (
    <DragUpload
      onFilesSelected={async (files) => {
        await compress(files[0]);
        download();
      }}
      disabled={isBusy}
      multiple={false}
    />
  );
}
```

详细说明见 `frontend/README.md`。

### 后端

**方式一：项目引用（推荐）**

在 `.csproj` 中直接引用类库项目：

```xml
<ItemGroup>
  <ProjectReference Include="path/to/component/backend/GlbCompressLib.csproj" />
</ItemGroup>
```

然后只需在 `Program.cs` 中注册即可，无需复制任何源码文件。

**方式二：复制源码文件**

1. 将 `backend/` 下所有 `.cs` 文件（`GlbCompressor.cs`、`GlbConverter.cs`、`CompressApi.cs`）复制到你的 .NET 项目中。
2. 添加 NuGet 依赖：`dotnet add package AssimpNet --version 4.1.0`

**共同步骤：**

3. 确保目标机器已安装 `gltf-transform`：`npm install -g @gltf-transform/cli`
4. 在 `Program.cs` 中注册（两种方式通用）：

```csharp
var builder = WebApplication.CreateBuilder(args);

// 配置 Kestrel 最大请求体大小（2GB）
builder.WebHost.ConfigureKestrel(o =>
    o.Limits.MaxRequestBodySize = 2L * 1024 * 1024 * 1024);

builder.Services.AddGlbCompressApi();

var app = builder.Build();
app.MapGlbCompressApi();
app.Run();
```

详细说明见 `backend/README.md`。

---

## 参考

- 完整演示项目：`../component_demo/` — 包含前后端联调示例
- AssimpNet 文档：https://github.com/assimp/assimp-net
- gltf-transform 文档：https://gltf-transform.dev/
