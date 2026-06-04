# 后端演示 — component_demo/backend

> ASP.NET Core 8 最小 API 演示后端，集成 `GlbCompressor` 组件，提供 `POST /api/compress` 端点。

## 环境要求

- .NET 8 SDK
- Node.js ≥ 18（gltf-transform 运行时）
- gltf-transform CLI：`npm install -g @gltf-transform/cli`

## 启动方式

```bash
dotnet run
# 监听 http://localhost:5100
```

## 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 健康检查 |
| POST | `/api/compress` | 接收 `multipart/form-data`（字段 `file`），返回压缩后的 GLB |

## 响应头（压缩统计）

| 响应头 | 说明 |
|--------|------|
| `X-Original-Size` | 原始文件大小（字节） |
| `X-Compressed-Size` | 压缩后大小（字节） |
| `X-Compression-Ratio` | 压缩后占原大小百分比（如 `35.2`） |

## 文件说明

| 文件 | 说明 |
|------|------|
| `Program.cs` | API 入口，处理上传与返回文件流 |
| `GlbCompressor.cs` | 复制自 `component/backend/GlbCompressor.cs` |
| `appsettings.json` | 端口配置（5100） |

详细启动说明请参考 `../../component_demo/README.md`。
