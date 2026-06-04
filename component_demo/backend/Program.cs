using ComponentDemo.Backend;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);

const long maxUploadBytes = 2L * 1024 * 1024 * 1024;

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = maxUploadBytes;
    options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(10);
    options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(2);
});

builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = maxUploadBytes;
    options.ValueLengthLimit = int.MaxValue;
    options.MultipartHeadersLengthLimit = int.MaxValue;
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("DemoFrontend", policy =>
    {
        policy
            .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
            .AllowAnyHeader()
            .AllowAnyMethod()
            // 允许前端读取自定义响应头
            .WithExposedHeaders(
                "Content-Disposition",
                "X-Original-Size",
                "X-Compressed-Size",
                "X-Compression-Ratio");
    });
});

var app = builder.Build();
app.UseCors("DemoFrontend");

// -------------------------------------------------------
//  健康检查
// -------------------------------------------------------
app.MapGet("/", () => Results.Ok(new
{
    status = "GLB Compressor Demo Backend is running",
    endpoints = new[] { "POST /api/compress" }
}));

// -------------------------------------------------------
//  POST /api/compress
//  接收 multipart/form-data（字段名 "file"）
//  调用 GlbCompressor 压缩，返回压缩后的 GLB 文件流
// -------------------------------------------------------
app.MapPost("/api/compress", async (HttpRequest request, HttpResponse response) =>
{
    string? inputPath = null;
    string? outputPath = null;

    try
    {
        if (!request.HasFormContentType)
            return Results.BadRequest(new { error = "请求必须使用 multipart/form-data 格式。" });

        var form = await request.ReadFormAsync();
        var file = form.Files.GetFile("file");

        if (file is null || file.Length == 0)
            return Results.BadRequest(new { error = "未上传文件或文件为空。" });

        // 后端二次校验扩展名（前端已校验，此处为安全防护）
        var uploadExt = Path.GetExtension(file.FileName);
        if (!string.Equals(uploadExt, ".glb", StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new
            {
                error = $"当前 Demo 仅支持 GLB 文件压缩，上传文件扩展名为：{uploadExt}。"
            });

        // 保存到临时目录（临时文件名使用 uploadId，避免路径冲突）
        var tempDir = Path.Combine(Path.GetTempPath(), "glb-demo-upload");
        Directory.CreateDirectory(tempDir);

        var uploadId = Guid.NewGuid().ToString("N");
        inputPath = Path.Combine(tempDir, $"{uploadId}.glb");

        await using (var inputStream = File.Create(inputPath))
            await file.CopyToAsync(inputStream);

        // 提取用户原始文件名（不含扩展名），作为输出文件名的 baseName
        // 最终输出文件名：{原始文件名}_{UUID}.glb
        var originalBaseName = Path.GetFileNameWithoutExtension(file.FileName);

        // 调用 GlbCompressor（来自 component/backend/GlbCompressor.cs）
        var result = await GlbCompressor.CompressGlbAsync(
            inputPath,
            outputDirectory: tempDir,
            outputBaseName: originalBaseName
        );

        outputPath = result.OutputPath;
        var bytes = await File.ReadAllBytesAsync(outputPath);

        // 在响应头中附带压缩统计信息
        response.Headers["X-Original-Size"] = result.OriginalSizeBytes.ToString();
        response.Headers["X-Compressed-Size"] = result.CompressedSizeBytes.ToString();
        response.Headers["X-Compression-Ratio"] = result.CompressionRatio.ToString("F1");

        return Results.File(bytes, "application/octet-stream", result.OutputFileName);
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (InvalidDataException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (GlbCompressionException ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
    catch (InvalidOperationException ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"内部错误：{ex.Message}" }, statusCode: 500);
    }
    finally
    {
        TryDelete(inputPath);
        TryDelete(outputPath);
    }
});

app.Run();

static void TryDelete(string? path)
{
    try
    {
        if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
            File.Delete(path);
    }
    catch { /* 最大努力清理 */ }
}
