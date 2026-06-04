# Backend — GLB 压缩、格式转换与 API 组件

> C# / .NET 8+ 组件库，提供三大核心能力：
>
> 1. **GLB 压缩**（`GlbCompressor`）：调用 `gltf-transform` CLI 执行 Draco 网格压缩与 WebP 纹理压缩
> 2. **多格式转 GLB**（`GlbConverter`）：基于 AssimpNet 将 84 种 3D 文件格式转换为标准 GLB（glTF 2.0）
> 3. **一键集成 API**（`CompressApi`）：基于 ASP.NET Core Minimal API 的开箱即用端点，整合上传、转换、压缩全流程
>
> 三个模块可按需独立使用，也可一键集成。

---

## 目录

- [文件清单](#文件清单)
- [依赖环境](#依赖环境)
- [快速集成（一键 API）](#快速集成一键-api)
- [API 说明 — 压缩（GlbCompressor）](#api-说明--压缩glbcompressor)
- [API 说明 — 格式转换（GlbConverter）](#api-说明--格式转换glbconverter)
- [API 说明 — 端点（CompressApi）](#api-说明--端点compressapi)
- [调用示例](#调用示例)
- [注意事项](#注意事项)

---

## 文件清单

```
component/backend/
├── GlbCompressor.cs    # GLB 压缩核心类（Draco + WebP，支持异步、超时、诊断日志）
├── GlbConverter.cs     # 多格式→GLB 转换（AssimpNet + glTF 1.0 自动回退）
├── CompressApi.cs      # 开箱即用的 API 端点（上传 + 转换 + 压缩一体化）
└── README.md           # 本文件
```

---

## 依赖环境

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| .NET | ≥ 8.0 | 推荐 .NET 8 LTS |
| Node.js | ≥ 18 | gltf-transform 的运行时（压缩和回退转换需要） |
| gltf-transform CLI | ≥ 4.0 | 执行压缩和 glTF→GLB 打包 |
| AssimpNet | ≥ 4.1.0 | 3D 模型格式转换引擎 |

### 安装依赖

```bash
# gltf-transform CLI（压缩 + 回退转换）
npm install -g @gltf-transform/cli

# AssimpNet（NuGet，在项目中添加）
dotnet add package AssimpNet --version 4.1.0
```

> ⚠️ AssimpNet 依赖本机 Assimp 库（`assimp.dll` / `libassimp.so` / `libassimp.dylib`）。
> NuGet 包会自动下载对应平台的本机库，无需手动安装。

---

## 快速集成（一键 API）

### 1. 复制文件

将 `GlbCompressor.cs`、`GlbConverter.cs`、`CompressApi.cs` 复制到 .NET 项目中。

### 2. 配置 Program.cs

```csharp
using GlbCompressorComponent;

var builder = WebApplication.CreateBuilder(args);

// 配置 Kestrel 最大请求体（默认 2GB，可调整）
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 2L * 1024 * 1024 * 1024;
});

// 注册 CompressApi 服务（CORS、FormOptions 等）
builder.Services.AddGlbCompressApi();

var app = builder.Build();

// 映射 API 端点
app.MapGlbCompressApi();

app.Run();
```

### 3. API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查，返回 Assimp 状态 |
| `POST` | `/api/compress` | 上传 3D 文件，自动转换 + 压缩 |

**POST /api/compress** 请求：

```
Content-Type: multipart/form-data
字段名: file
```

**POST /api/compress** 响应：

- 成功 (200)：返回压缩后的 GLB 文件流
- 响应头：
  - `Content-Disposition`: 下载文件名
  - `X-Original-Size`: 原始文件大小（字节）
  - `X-Compressed-Size`: 压缩后文件大小（字节）
  - `X-Compression-Ratio`: 压缩率（百分比，如 `35.2`）

---

## API 说明 — 压缩（GlbCompressor）

### `GlbCompressor.CompressGlbAsync`（推荐）

```csharp
public static async Task<GlbCompressionResult> CompressGlbAsync(
    string inputPath,
    string? outputDirectory = null,
    string? outputBaseName = null,
    GlbCompressionOptions? options = null,
    CancellationToken cancellationToken = default
)
```

**参数**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `inputPath` | `string` | **必填** | 输入 GLB 文件的绝对路径 |
| `outputDirectory` | `string?` | `null` | 输出目录，null 则与输入文件同目录 |
| `outputBaseName` | `string?` | `null` | 输出文件基础名称（最终格式：`{baseName}_{UUID}.glb`） |
| `options` | `GlbCompressionOptions?` | `null` | 压缩选项 |
| `cancellationToken` | `CancellationToken` | `default` | 取消令牌 |

**返回值**：`Task<GlbCompressionResult>` — 包含输出路径、文件名与压缩统计。

**`GlbCompressionResult` 属性**

| 属性 | 类型 | 说明 |
|------|------|------|
| `OutputPath` | `string` | 压缩后文件的完整绝对路径 |
| `OutputFileName` | `string` | 文件名（`{baseName}_{UUID}.glb`） |
| `OriginalSizeBytes` | `long` | 原始文件大小（字节） |
| `CompressedSizeBytes` | `long` | 压缩后文件大小（字节） |
| `CompressionRatio` | `double` | 压缩率（例如 `35.2` 表示压缩至原来的 35.2%） |

**`GlbCompressionOptions` 配置项**

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `EnableDraco` | `bool` | `true` | 是否启用 Draco 网格压缩 |
| `CompressTextureToWebP` | `bool` | `true` | 是否将纹理压缩为 WebP |
| `GltfTransformCommand` | `string?` | `null` | 自定义 gltf-transform 路径（null 则自动查找） |
| `Timeout` | `TimeSpan` | `10 分钟` | 超时时间 |

---

## API 说明 — 格式转换（GlbConverter）

### `GlbConverter.ConvertToGlb`（文件路径版，推荐）

```csharp
public static void ConvertToGlb(
    string inputFilePath,
    string outputFilePath
)
```

将任意支持的 3D 文件转换为 GLB（glTF 2.0 Binary）。

**转换策略**：
1. 优先尝试 Assimp 直接导出 GLB
2. 导出后检测 GLB 版本号 — 若为 glTF 1.0 则自动回退
3. 回退方案：导出 glTF 2.0 分离格式 → 使用 `gltf-transform copy` 打包为 GLB

### 工具方法

| 方法 | 说明 |
|------|------|
| `IsFormatSupported(ext)` | 判断扩展名是否在支持列表中 |
| `IsGlbFile(path)` | 判断文件是否已是 GLB 格式 |
| `GetAssimpVersion()` | 获取 Assimp 版本信息 |
| `GetSupportedExportFormats()` | 获取 Assimp 支持的导出格式列表 |

### 支持格式（84 种）

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

---

## API 说明 — 端点（CompressApi）

### 服务注册

```csharp
// 注册服务（可选参数）
builder.Services.AddGlbCompressApi(
    maxUploadBytes: 2L * 1024 * 1024 * 1024,  // 最大上传大小
    frontendOrigins: new[] { "http://localhost:5173" }  // CORS 来源
);
```

### 端点映射

```csharp
// 映射端点
app.MapGlbCompressApi(routePrefix: "/api");  // 默认 "/api"
```

### 进阶：Kestrel 配置

```csharp
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 2L * 1024 * 1024 * 1024;
    options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(10);
    options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(2);
});
```

---

## 调用示例

### 示例 1：完整集成 — Program.cs

```csharp
using GlbCompressorComponent;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(o =>
    o.Limits.MaxRequestBodySize = 2L * 1024 * 1024 * 1024);

builder.Services.AddGlbCompressApi();

var app = builder.Build();
app.MapGlbCompressApi();
app.Run();
```

### 示例 2：仅压缩（已知 GLB 文件）

```csharp
var result = await GlbCompressor.CompressGlbAsync(
    inputPath: @"C:\models\scene.glb",
    outputBaseName: "my-scene"
);

Console.WriteLine($"原始：{result.OriginalSizeBytes / 1024.0 / 1024:F1} MB");
Console.WriteLine($"压缩后：{result.CompressedSizeBytes / 1024.0 / 1024:F1} MB");
Console.WriteLine($"压缩率：{result.CompressionRatio}%");
```

### 示例 3：转换 + 压缩组合

```csharp
var tempDir = Path.Combine(Path.GetTempPath(), "glb-process");
Directory.CreateDirectory(tempDir);

// 1. 转换：OBJ → GLB
var glbPath = Path.Combine(tempDir, $"{Guid.NewGuid():N}.glb");
GlbConverter.ConvertToGlb(@"C:\uploads\model.obj", glbPath);

// 2. 压缩
var result = await GlbCompressor.CompressGlbAsync(
    glbPath,
    outputDirectory: tempDir,
    outputBaseName: "model"
);

// 3. 清理
File.Delete(glbPath);
```

### 示例 4：查看 Assimp 导出能力

```csharp
Console.WriteLine(GlbConverter.GetAssimpVersion());

foreach (var fmt in GlbConverter.GetSupportedExportFormats())
    Console.WriteLine($"  - {fmt}");
```

---

## 注意事项

1. **GLB 格式校验**：`GlbCompressor` 会校验输入文件的 GLB 魔数（`glTF`），非 GLB 文件将抛出 `InvalidDataException`。
2. **glTF 1.0 回退**：当 Assimp 导出的 GLB 为 glTF 1.0 时，`GlbConverter` 自动回退到 glTF 2.0 → gltf-transform 打包方案。
3. **gltf-transform 必须已安装**：压缩和回退转换依赖此 CLI，请确保 `npm install -g @gltf-transform/cli`。
4. **Node.js 自动发现**：组件优先使用 WorkBuddy 托管的 Node.js，回退到系统 PATH。
5. **临时文件清理**：`CompressApi` 自动管理临时文件（finally 块清理）。直接调用 `GlbCompressor` / `GlbConverter` 时需自行管理。
6. **大文件处理**：默认超时 10 分钟，处理大型文件（>500MB）时可适当增大 `Timeout` 值。
7. **已知局限**：Assimp 对 BIM/GIS 专业格式（`rvt`、`rfa`、`dwg`、`ifc`）的支持程度取决于本机 Assimp 版本。
