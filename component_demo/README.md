# Component Demo — 集成演示目录

本目录提供 `component/` 前后端组件的完整集成演示。

---

## 目录结构

```
component_demo/
├── frontend/               # 前端演示（React + Vite + TypeScript）
│   ├── src/
│   │   ├── DragUpload.tsx  # 从 component/frontend/ 复制的拖拽组件
│   │   ├── DragUpload.css  # 组件样式
│   │   ├── App.tsx         # 演示页面（调用组件 + 上传至后端）
│   │   ├── App.css         # 演示页面样式
│   │   └── main.tsx        # 应用入口
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── .env                # 配置后端 API 地址
│
├── backend/                # 后端演示（ASP.NET Core 最小 API）
│   ├── Program.cs          # API 入口：POST /api/compress
│   ├── GlbCompressor.cs    # 从 component/backend/ 复制的压缩核心类
│   ├── appsettings.json    # 配置（端口 5100）
│   └── component-demo-backend.csproj
│
└── README.md               # 本文件
```

---

## 演示功能说明

```
用户拖拽 / 选择 .glb 文件
          │
          ▼
[前端] DragUpload 组件
  - 仅接受 .glb 格式（不符合格式立即提示并拒绝）
  - 校验通过 → 构造 FormData，POST 至 http://localhost:5100/api/compress
          │
          ▼
[后端] POST /api/compress（Program.cs）
  - 接收上传文件，保存到系统临时目录
  - 调用 GlbCompressor.CompressGlbAsync(inputPath, tempDir)
          │
          ▼
[后端] GlbCompressor（GlbCompressor.cs）
  - 调用 gltf-transform CLI 执行 Draco + WebP 压缩
  - 输出文件名：{原始文件名}_{UUID}.glb
          │
          ▼
[后端] 将压缩后的 GLB 文件以二进制流返回
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
| .NET SDK | ≥ 8.0 | 后端运行 |
| gltf-transform CLI | ≥ 4.0 | 实际执行 GLB 压缩 |

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

可通过浏览器访问 `http://localhost:5100/` 验证后端状态：

```json
{
  "status": "GLB Compressor Demo Backend is running",
  "endpoints": ["POST /api/compress"]
}
```

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
2. 将一个 `.glb` 文件拖拽到页面中的上传区域，或点击选择文件
3. 组件自动校验文件格式，不是 `.glb` 格式的文件会被拒绝并给出提示
4. 校验通过后，文件自动上传至后端，后端调用 `GlbCompressor` 进行压缩
5. 压缩完成后，浏览器自动下载压缩后的 GLB 文件（文件名含 UUID）

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

- 演示后端的 `GlbCompressor.cs` 直接从 `component/backend/GlbCompressor.cs` 复制而来。  
  在实际项目中，建议将其作为独立类库（`.csproj`）引用，而非手动复制。
- 当前演示仅支持 GLB 文件，其他格式转换功能将在后续版本中按需添加。
- 前端演示中 `DragUpload` 组件的 `allowedExtensions` 已设置为仅 `['glb']`，实际集成时可按需扩展为完整格式列表（参考 `component/frontend/README.md`）。
