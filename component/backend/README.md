# GlbCompressor — 后端 GLB 压缩组件

> C# / .NET 8+ 封装，调用 `gltf-transform` CLI 对 GLB 文件执行 **Draco 网格压缩** 与 **WebP 纹理压缩**，输出文件名自动追加随机 UUID。

> ⚠️ 当前版本**仅支持 GLB 文件压缩**，不含任何模型格式转换功能，后续版本将按需添加。

---

## 目录

- [功能描述](#功能描述)
- [依赖环境](#依赖环境)
- [集成步骤](#集成步骤)
- [API 说明](#api-说明)
- [调用示例](#调用示例)
- [注意事项](#注意事项)

---

## 功能描述

| 能力 | 说明 |
|------|------|
| Draco 网格压缩 | 对 GLB 中的几何体数据进行 Draco 编码，显著减小文件体积 |
| WebP 纹理压缩 | 将 GLB 内嵌纹理转换为 WebP 格式（可选关闭） |
| UUID 输出文件名 | 输出文件名格式：`{原始文件名}_{UUID}.glb`，避免命名冲突 |
| 异步 API | 主方法为 `async/await`，不阻塞 ASP.NET Core 请求线程 |
| 超时控制 | 可配置压缩进程最大执行时间（默认 10 分钟） |
| 错误处理 | 输入非 GLB 文件或压缩失败时，抛出明确的 `GlbCompressionException` |

---

## 依赖环境

### 运行时环境

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| .NET | ≥ 8.0 | 推荐 .NET 8 LTS |
| Node.js | ≥ 18 | gltf-transform 的运行时 |
| gltf-transform CLI | ≥ 4.0 | 实际执行压缩的工具 |

### 安装 gltf-transform CLI

```bash
npm install -g @gltf-transform/cli
```

安装后验证：

```bash
gltf-transform --version
```

### NuGet 包

本组件**无需安装任何 NuGet 包**。仅使用 .NET BCL（`System.Diagnostics.Process`、`System.IO` 等）。

---

## 集成步骤

### 1. 复制源文件

将 `GlbCompressor.cs` 复制到你的 .NET 项目中，例如：

```
YourProject/
└── Services/
    └── GlbCompressor.cs
```

### 2. 调整命名空间（可选）

打开 `GlbCompressor.cs`，将顶部的命名空间修改为你的项目命名空间：

```csharp
// 将：
namespace GlbCompressorComponent

// 改为：
namespace YourCompany.YourProject.Services
```

### 3. 注册为服务（可选，推荐）

若项目使用依赖注入，可包装为服务类；若使用静态调用，可直接按下方示例调用。

---

## API 说明

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
| `outputDirectory` | `string?` | `null`（与输入文件同目录） | 输出文件的目标目录 |
| `outputBaseName` | `string?` | `null`（取 inputPath 的文件名）| 输出文件的基础名称（不含扩展名），例如用户原始上传的文件名。最终输出文件名为 `{outputBaseName}_{UUID}.glb` |
| `options` | `GlbCompressionOptions?` | `null`（使用默认配置） | 压缩选项 |
| `cancellationToken` | `CancellationToken` | `default` | 取消令牌 |

**返回值**：`Task<GlbCompressionResult>` — 包含输出路径、文件名与压缩统计信息的结果对象。

**`GlbCompressionResult` 属性**

| 属性 | 类型 | 说明 |
|------|------|------|
| `OutputPath` | `string` | 压缩后 GLB 文件的完整绝对路径 |
| `OutputFileName` | `string` | 压缩后文件名，格式：`{baseName}_{UUID}.glb` |
| `OriginalSizeBytes` | `long` | 原始文件大小（字节） |
| `CompressedSizeBytes` | `long` | 压缩后文件大小（字节） |
| `CompressionRatio` | `double` | 压缩后体积占原始体积的百分比（例如 `35.2` 表示压缩至原来的 35.2%） |

**异常**

| 异常类型 | 触发条件 |
|----------|----------|
| `ArgumentException` | 输入路径为空、文件不存在 |
| `InvalidDataException` | 文件扩展名不是 `.glb` 或文件头魔数不匹配 |
| `InvalidOperationException` | 无法启动 gltf-transform 进程（未安装或不在 PATH）|
| `GlbCompressionException` | gltf-transform 执行失败或超时 |

---

### `GlbCompressor.CompressGlb`（同步版）

```csharp
public static GlbCompressionResult CompressGlb(
    string inputPath,
    string? outputDirectory = null,
    string? outputBaseName = null,
    GlbCompressionOptions? options = null
)
```

与异步版本功能相同，内部阻塞等待完成。**建议在 ASP.NET Core 中使用异步版本**。

---

### `GlbCompressionOptions` 配置项

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `EnableDraco` | `bool` | `true` | 是否启用 Draco 网格压缩 |
| `CompressTextureToWebP` | `bool` | `true` | 是否将纹理压缩为 WebP |
| `GltfTransformCommand` | `string?` | `null`（自动查找）| 自定义 gltf-transform 可执行文件路径 |
| `Timeout` | `TimeSpan` | `10 分钟` | 压缩进程超时时间 |

---

## 调用示例

### 示例 1：最简调用（默认选项）

```csharp
using GlbCompressorComponent;

var result = await GlbCompressor.CompressGlbAsync(
    inputPath: @"C:\models\scene.glb"
);

Console.WriteLine($"压缩完成：{result.OutputPath}");
// 输出示例：C:\models\scene_3f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c.glb
```

### 示例 2：传入用户原始文件名（推荐，避免临时文件名污染输出）

```csharp
// 场景：上传的临时文件名为 uploadId.glb，但要保留用户文件名 "my-model"
var result = await GlbCompressor.CompressGlbAsync(
    inputPath: @"C:\temp\a1b2c3d4.glb",
    outputDirectory: @"C:\compressed",
    outputBaseName: "my-model"        // 用户原始文件名（不含扩展名）
);
// 输出文件名：my-model_3f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c.glb
Console.WriteLine(result.OutputFileName);
```

### 示例 3：自定义压缩选项

```csharp
var options = new GlbCompressionOptions
{
    EnableDraco = true,
    CompressTextureToWebP = false,   // 保留原始纹理格式
    Timeout = TimeSpan.FromMinutes(5)
};

var result = await GlbCompressor.CompressGlbAsync(
    inputPath: inputGlbPath,
    outputBaseName: "my-scene",
    options: options
);
```

### 示例 4：在 ASP.NET Core 最小 API 中集成

```csharp
app.MapPost("/api/compress", async (HttpRequest request) =>
{
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null) return Results.BadRequest("未上传文件");

    // 保存临时文件（临时文件名用 uploadId，避免路径冲突）
    var tempDir = Path.Combine(Path.GetTempPath(), "glb-upload");
    Directory.CreateDirectory(tempDir);
    var inputPath = Path.Combine(tempDir, $"{Guid.NewGuid():N}.glb");

    await using (var stream = File.Create(inputPath))
        await file.CopyToAsync(stream);

    // 提取用户原始文件名（不含扩展名）作为 outputBaseName
    var originalBaseName = Path.GetFileNameWithoutExtension(file.FileName);

    try
    {
        var result = await GlbCompressor.CompressGlbAsync(
            inputPath,
            outputDirectory: tempDir,
            outputBaseName: originalBaseName   // ← 传入原始文件名
        );
        // 输出文件名：{用户原始文件名}_{UUID}.glb

        var bytes = await File.ReadAllBytesAsync(result.OutputPath);
        File.Delete(inputPath);
        File.Delete(result.OutputPath);

        return Results.File(bytes, "application/octet-stream", result.OutputFileName);
    }
    catch (ArgumentException ex)
    {
        File.Delete(inputPath);
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (GlbCompressionException ex)
    {
        File.Delete(inputPath);
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});
```

### 示例 5：查看压缩统计

```csharp
var result = await GlbCompressor.CompressGlbAsync(
    inputPath: @"C:\models\large-scene.glb",
    outputBaseName: "large-scene"
);

Console.WriteLine($"原始大小：{result.OriginalSizeBytes / 1024.0 / 1024:F1} MB");
Console.WriteLine($"压缩后大小：{result.CompressedSizeBytes / 1024.0 / 1024:F1} MB");
Console.WriteLine($"压缩率：{result.CompressionRatio}%（压缩后为原来的 {result.CompressionRatio}%）");
```

### 示例 6：错误处理

```csharp
try
{
    var result = await GlbCompressor.CompressGlbAsync("model.obj"); // 非 GLB
}
catch (InvalidDataException ex)
{
    // "输入文件必须是 GLB 格式（.glb），当前扩展名：.obj。本组件当前版本仅支持 GLB 文件压缩..."
    Console.WriteLine(ex.Message);
}
catch (GlbCompressionException ex)
{
    // gltf-transform 执行失败的详细错误信息
    Console.WriteLine($"压缩失败：{ex.Message}");
}
```

---

## 注意事项

1. **仅支持 GLB**：当前版本仅处理 `.glb` 格式的文件，传入其他格式（如 `.gltf`、`.obj`、`.fbx`）将抛出 `ArgumentException`。后续版本将按需添加格式转换支持。

2. **gltf-transform 必须已安装**：组件依赖外部 CLI，请确保目标机器（开发、测试、生产环境）均已全局安装 `@gltf-transform/cli`。

3. **Windows 路径**：组件已处理 Windows 下 npm 全局 shim（`gltf-transform.cmd`），无需手动指定路径。

4. **临时文件管理**：组件本身不管理临时文件的生命周期，由调用方负责创建输入临时文件及在使用完毕后删除输入/输出文件。

5. **输出文件名**：输出文件名格式为 `{原始文件名}_{32位UUID十六进制}.glb`，可防止并发上传时的文件名冲突。

6. **大文件处理**：若处理大型 GLB 文件（>500MB），建议适当增大 `Timeout` 配置值。
