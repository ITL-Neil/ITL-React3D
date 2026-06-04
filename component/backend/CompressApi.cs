using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;

namespace GlbCompressorComponent
{
    /// <summary>
    /// 3D 模型上传、格式转换、压缩一体化 API 端点。
    ///
    /// 提供开箱即用的 ASP.NET Core Minimal API 端点，整合了：
    ///   - 文件上传校验（扩展名白名单）
    ///   - 非 GLB 格式自动转换为 GLB（GlbConverter）
    ///   - GLB 文件压缩（GlbCompressor）
    ///   - 压缩统计信息（响应头）
    ///
    /// 使用方式（Program.cs）：
    /// <code>
    /// var builder = WebApplication.CreateBuilder(args);
    /// builder.Services.AddGlbCompressApi();
    /// var app = builder.Build();
    /// app.MapGlbCompressApi();
    /// app.Run();
    /// </code>
    ///
    /// 前置依赖：
    ///   - .NET 8+
    ///   - AssimpNet（用于格式转换）
    ///   - Node.js + gltf-transform CLI（用于压缩与 glTF→GLB 转换）
    /// </summary>
    public static class CompressApi
    {
        // ---------------------------------------------------------------
        // 配置常量
        // ---------------------------------------------------------------

        /// <summary>默认最大上传大小：2 GB。</summary>
        public const long DefaultMaxUploadBytes = 2L * 1024 * 1024 * 1024;

        /// <summary>默认压缩超时：10 分钟。</summary>
        public static readonly TimeSpan DefaultCompressTimeout = TimeSpan.FromMinutes(10);

        /// <summary>上传表单字段名。</summary>
        public const string FormFieldName = "file";

        // ---------------------------------------------------------------
        // 服务注册扩展
        // ---------------------------------------------------------------

        /// <summary>
        /// 注册 CompressApi 所需的服务（CORS、Kestrel 配置等）。
        /// 调用一次即可，内部使用默认值。
        /// </summary>
        /// <param name="services">IServiceCollection 实例。</param>
        /// <param name="maxUploadBytes">最大上传字节数（默认 2GB）。</param>
        /// <param name="frontendOrigins">允许的前端来源（CORS）。若为 null，允许 localhost:5173。</param>
        public static IServiceCollection AddGlbCompressApi(
            this IServiceCollection services,
            long maxUploadBytes = DefaultMaxUploadBytes,
            string[]? frontendOrigins = null)
        {
            // CORS — 允许前端跨域请求
            services.AddCors(options =>
            {
                options.AddPolicy("GlbCompressCors", policy =>
                {
                    var origins = frontendOrigins ?? new[]
                    {
                        "http://localhost:5173",
                        "http://127.0.0.1:5173"
                    };
                    policy
                        .WithOrigins(origins)
                        .AllowAnyHeader()
                        .AllowAnyMethod()
                        .WithExposedHeaders(
                            "Content-Disposition",
                            "X-Original-Size",
                            "X-Compressed-Size",
                            "X-Compression-Ratio");
                });
            });

            // 上传大小限制
            services.Configure<FormOptions>(options =>
            {
                options.MultipartBodyLengthLimit = maxUploadBytes;
                options.ValueLengthLimit = int.MaxValue;
                options.MultipartHeadersLengthLimit = int.MaxValue;
            });

            return services;
        }

        // ---------------------------------------------------------------
        // 端点映射扩展
        // ---------------------------------------------------------------

        /// <summary>
        /// 在 ASP.NET Core 应用中注册 CompressApi 端点。
        /// 调用前请先配置 Kestrel 的 MaxRequestBodySize：
        /// <code>
        /// builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 2L * 1024 * 1024 * 1024);
        /// </code>
        /// </summary>
        public static WebApplication MapGlbCompressApi(
            this WebApplication app,
            string? routePrefix = null)
        {
            app.UseCors("GlbCompressCors");

            var prefix = (routePrefix ?? "/api").TrimEnd('/');

            // 健康检查
            app.MapGet(prefix + "/health", () => Results.Ok(new
            {
                status = "healthy",
                assimp = GlbConverter.GetAssimpVersion(),
                timestamp = DateTime.UtcNow.ToString("O")
            }));

            // 主压缩端点
            app.MapPost(prefix + "/compress", (HttpRequest request, HttpResponse response)
                => HandleCompressAsync(request, response));

            return app;
        }

        // ---------------------------------------------------------------
        // 核心处理逻辑
        // ---------------------------------------------------------------

        /// <summary>
        /// POST {prefix}/compress 处理函数。
        ///
        /// 接收 multipart/form-data（字段名 "file"），
        /// 对上传的 3D 文件进行格式转换（非 GLB → GLB）和压缩（Draco + WebP），
        /// 返回压缩后的 GLB 文件流，并在响应头中附带压缩统计信息。
        ///
        /// 响应头：
        ///   X-Original-Size     原始文件大小（字节）
        ///   X-Compressed-Size   压缩后文件大小（字节）
        ///   X-Compression-Ratio 压缩率（百分比）
        /// </summary>
        private static async Task<IResult> HandleCompressAsync(
            HttpRequest request,
            HttpResponse response,
            long maxUploadBytes = DefaultMaxUploadBytes,
            TimeSpan? compressTimeout = null,
            bool enableDraco = true,
            bool compressTextureToWebP = true)
        {
            string? inputPath = null;       // 上传原始文件（临时）
            string? glbPath = null;         // 转换后的 GLB（非 GLB 上传时需要）
            string? outputPath = null;      // 压缩后的最终文件

            try
            {
                // --- 1. 校验请求 ---
                if (!request.HasFormContentType)
                    return Results.BadRequest(new { error = "请求必须使用 multipart/form-data 格式。" });

                var form = await request.ReadFormAsync();
                var file = form.Files.GetFile(FormFieldName);

                if (file is null || file.Length == 0)
                    return Results.BadRequest(new { error = "未上传文件或文件为空。" });

                // 后端二次校验扩展名（前端已校验，此处为安全防护）
                var uploadExt = Path.GetExtension(file.FileName);
                if (!GlbConverter.IsFormatSupported(uploadExt))
                    return Results.BadRequest(new
                    {
                        error = $"不支持的文件格式：{uploadExt}。"
                    });

                // --- 2. 保存上传文件 ---
                var tempDir = Path.Combine(Path.GetTempPath(), "glb-compress-api");
                Directory.CreateDirectory(tempDir);

                var uploadId = Guid.NewGuid().ToString("N");
                var safeExt = uploadExt.TrimStart('.').ToLowerInvariant();
                inputPath = Path.Combine(tempDir, $"{uploadId}.{safeExt}");

                await using (var inputStream = File.Create(inputPath))
                    await file.CopyToAsync(inputStream);

                // 提取用户原始文件名（不含扩展名），作为输出文件名的 baseName
                var originalBaseName = Path.GetFileNameWithoutExtension(file.FileName);

                // --- 3. 格式转换（非 GLB → GLB）---
                if (GlbConverter.IsGlbFile(inputPath))
                {
                    glbPath = inputPath; // 已经是 GLB，无需转换
                }
                else
                {
                    glbPath = Path.Combine(tempDir, $"{uploadId}_converted.glb");
                    await GlbConverter.ConvertToGlbAsync(inputPath, glbPath);
                }

                // --- 4. 压缩 GLB ---
                var options = new GlbCompressionOptions
                {
                    EnableDraco = enableDraco,
                    CompressTextureToWebP = compressTextureToWebP,
                    Timeout = compressTimeout ?? DefaultCompressTimeout
                };

                var result = await GlbCompressor.CompressGlbAsync(
                    glbPath,
                    outputDirectory: tempDir,
                    outputBaseName: originalBaseName,
                    options: options
                );

                outputPath = result.OutputPath;
                var bytes = await File.ReadAllBytesAsync(outputPath);

                // --- 5. 附加统计信息 ---
                response.Headers["X-Original-Size"] = result.OriginalSizeBytes.ToString();
                response.Headers["X-Compressed-Size"] = result.CompressedSizeBytes.ToString();
                response.Headers["X-Compression-Ratio"] = result.CompressionRatio.ToString("F1");

                return Results.File(bytes, "application/octet-stream", result.OutputFileName);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (NotSupportedException ex)
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
                return Results.Json(
                    new { error = $"内部错误：{ex.Message}" },
                    statusCode: 500);
            }
            finally
            {
                // 清理临时文件
                TryDelete(inputPath);
                if (glbPath != null && glbPath != inputPath)
                    TryDelete(glbPath);
                TryDelete(outputPath);
            }
        }

        private static void TryDelete(string? path)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                    File.Delete(path);
            }
            catch { /* 最大努力清理 */ }
        }
    }
}
