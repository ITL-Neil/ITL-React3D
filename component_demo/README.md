# Component Demo — 集成演示目录

本目录演示如何将 `component/` 可复用组件库集成到完整的前后端项目中，实现 **文件上传 → 格式转换 → GLB 压缩** 全流程。

---

## 目录结构

```
component_demo/
├── frontend/                    # 前端演示（React + Vite + TypeScript）
│   ├── src/
│   │   ├── App.tsx              # 演示页面（import @component/DragUpload + useCompressApi）
│   │   ├── App.css              # 演示页面样式
│   │   └── main.tsx             # 应用入口
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts           # 配置 @component alias → ../../component/frontend/
│   ├── tsconfig.json            # 配置 paths: {"@component/*": ["../../component/frontend/*"]}
│   └── .env                     # VITE_API_URL = http://localhost:5100/api/compress
│
├── backend/                     # 后端演示（ASP.NET Core 最小 API）
│   ├── Program.cs               # 仅 6 行核心代码：AddGlbCompressApi + MapGlbCompressApi
│   ├── appsettings.json         # 配置（端口 5100）
│   ├── component-demo-backend.csproj  # ProjectReference → GlbCompressLib.csproj
│   ├── global.json              # 固定 SDK 版本
│   └── libs/                    # AssimpNet 手动引用（NuGet restore 兼容性）
│
└── README.md                    # 本文件
```

> **注意**：`DragUpload.tsx`、`DragUpload.css`、`GlbCompressor.cs`、`GlbConverter.cs` 均不再直接存放在 demo 目录中。
> 它们由 `component/` 库提供，demo 通过项目引用（后端）和路径别名（前端）引入。

---

## 演示功能说明

```
用户拖拽/选择 3D 文件（支持 84 种格式）
          │
          ▼
[前端] DragUpload 组件（from @component/）
  - 校验扩展名（84 种格式白名单）
  - 校验通过 → 调用 useCompressApi Hook
          │
          ▼
[前端] useCompressApi Hook（from @component/）
  - 构造 FormData，POST 至 /api/compress
  - 管理状态（idle → uploading → processing → success/error）
  - 接收压缩文件并触发下载
          │
          ▼
[后端] CompressApi（from GlbCompressLib）
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
          │
          ▼
[前端] 接收响应，自动触发浏览器下载压缩后的 GLB 文件
```

---

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18 | 前端构建 + gltf-transform 运行时 |
| npm / pnpm | 任意 | 前端包管理 |
| .NET SDK | ≥ 8.0 | 后端运行（通过 global.json 固定版本） |
| gltf-transform CLI | ≥ 4.0 | GLB 压缩引擎 |

---

## 快速启动

### 第一步：安装 gltf-transform（全局，仅需一次）

```bash
npm install -g @gltf-transform/cli

# 验证安装
gltf-transform --version
```

---

### 第二步：启动后端

```bash
# 进入后端演示目录
cd component_demo/backend

# 启动（监听 http://localhost:5100）
dotnet run
```

成功启动后，终端应显示：

```
Now listening on: http://localhost:5100
```

可通过浏览器访问 `http://localhost:5100/api/health` 验证后端状态，返回 Assimp 版本信息和运行时状态。

---

### 第三步：启动前端

新开一个终端窗口：

```bash
# 进入前端演示目录
cd component_demo/frontend

# 安装依赖（首次运行）
npm install

# 启动开发服务器（监听 http://localhost:5173）
npm run dev
```

成功启动后，终端应显示：

```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

---

### 第四步：使用演示

1. 打开浏览器访问 `http://localhost:5173`
2. 将任意支持的 3D 文件（GLB / FBX / OBJ / STL / PLY / DAE / 3DS 等 84 种格式）拖拽到上传区域，或点击选择文件
3. 组件自动校验文件格式，不支持的格式会被拒绝并给出提示
4. 校验通过后，文件自动上传至后端：
   - 已是 GLB 格式 → 直接压缩（Draco 网格 + WebP 纹理）
   - 非 GLB 格式 → 先转换为 GLB，再压缩
5. 处理完成后，浏览器自动下载压缩后的 GLB 文件

---

## 组件库集成方式

本 demo 演示了 `component/` 库的推荐集成方式：

| 层 | 集成方式 | 关键配置 |
|----|----------|----------|
| **后端** | ProjectReference | `component-demo-backend.csproj` → `<ProjectReference Include="..\..\component\backend\GlbCompressLib.csproj" />` |
| **后端 API** | 两行注册 | `builder.Services.AddGlbCompressApi()` + `app.MapGlbCompressApi()` |
| **前端组件** | Vite alias + tsconfig paths | `@component` → `../../component/frontend/` |
| **前端 Hook** | import | `useCompressApi` from `@component/useCompressApi` |

---

## 端口配置

| 服务 | 默认端口 | 配置文件 |
|------|----------|----------|
| 前端开发服务器 | 5173 | `frontend/vite.config.ts` |
| 后端 API | 5100 | `backend/appsettings.json` |
| 前端指向后端的 URL | — | `frontend/.env` → `VITE_API_URL` |

若需更改端口，请同步修改以上三处配置。

---

## 注意事项

- **文件实时同步**：修改 `component/` 库的源码后，demo 会自动反映变化（Vite HMR + dotnet watch），无需手动复制文件。
- **NuGet restore 兼容性**：当前环境使用 `global.json` 固定 SDK 版本 + 手动 `project.assets.json` 绕过 NuGet restore 的已知 Bug。在其他环境下通常不需要这些 workaround。
- **Assimp 依赖**：`libs/AssimpNet.dll` 和 `libs/assimp.dll` 为手动引用，切换到其他环境时可通过 NuGet 包管理器恢复。
- **gltf-transform 必须全局安装**：压缩和格式转换回退路径依赖此 CLI，请确保 `npm install -g @gltf-transform/cli` 已执行。
