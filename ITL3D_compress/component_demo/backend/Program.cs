// ---------------------------------------------------------------
//  Component Demo — 后端入口
//
//  演示 GlbCompressLib 组件库的使用方式。
//  仅需两行：AddGlbCompressApi() + MapGlbCompressApi()
//  即可获得完整的文件上传、格式转换、GLB 压缩 API。
// ---------------------------------------------------------------

using GlbCompressorComponent;

var builder = WebApplication.CreateBuilder(args);

// Kestrel：允许大文件上传（2GB）
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = CompressApi.DefaultMaxUploadBytes;
    options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(10);
    options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(2);
});

// 注册组件库服务（CORS + FormOptions + 其他）
builder.Services.AddGlbCompressApi();

var app = builder.Build();

// 注册组件库 API 端点
app.MapGlbCompressApi();

// 根路径健康检查（非组件库提供，Demo 自有）
app.MapGet("/", () => Results.Ok(new
{
    status = "GLB Compressor Demo — powered by GlbCompressLib",
    endpoints = new[] { "GET /api/health", "POST /api/compress" },
    library = new
    {
        assimp = GlbConverter.GetAssimpVersion(),
        node = "gltf-transform v4.4.0-alpha.1"
    }
}));

app.Run();
