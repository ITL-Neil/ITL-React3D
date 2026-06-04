# 后端演示 — component_demo/backend

> ASP.NET Core 8 最小 API 演示后端，通过 ProjectReference 引用 `GlbCompressLib` 类库，
> 提供 `POST /api/compress` 端点（整合上传、格式转换与压缩）。

## 环境要求

- .NET 8 SDK（通过 `global.json` 固定版本）
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
| GET | `/api/health` | 健康检查（含 Assimp 版本信息） |
| POST | `/api/compress` | 接收 `multipart/form-data`（字段 `file`），自动转换 + 压缩后返回 GLB |

## 响应头（压缩统计）

| 响应头 | 说明 |
|--------|------|
| `X-Original-Size` | 原始文件大小（字节） |
| `X-Compressed-Size` | 压缩后大小（字节） |
| `X-Compression-Ratio` | 压缩后占原大小百分比（如 `35.2`） |

## 文件说明

| 文件 | 说明 |
|------|------|
| `Program.cs` | API 入口，仅 6 行核心代码（`AddGlbCompressApi` + `MapGlbCompressApi`） |
| `component-demo-backend.csproj` | 项目文件，通过 `<ProjectReference>` 引用 `../../component/backend/GlbCompressLib.csproj` |
| `appsettings.json` | 端口配置（5100） |
| `libs/` | AssimpNet 手动引用（`AssimpNet.dll` + `assimp.dll`） |

## 集成方式

本 demo 后端不包含 `GlbCompressor.cs`、`GlbConverter.cs`、`CompressApi.cs` 等文件副本。
所有功能由引用的 `GlbCompressLib` 类库提供：

```xml
<!-- component-demo-backend.csproj -->
<ItemGroup>
  <ProjectReference Include="..\..\component\backend\GlbCompressLib.csproj" />
</ItemGroup>
```

```csharp
// Program.cs
using GlbCompressorComponent;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddGlbCompressApi();
var app = builder.Build();
app.MapGlbCompressApi();
app.Run();
```

详细启动说明请参考 `../../component_demo/README.md`。
