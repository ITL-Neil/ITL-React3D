using System.Diagnostics;
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
    options.AddPolicy("Frontend", policy =>
    {
        policy.WithOrigins(
                "http://localhost:5173",
                "http://127.0.0.1:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors("Frontend");

app.MapGet("/", () => Results.Ok(new { status = "GLB compressor backend is running" }));

app.MapPost("/api/upload", async (
    HttpRequest request,
    IConfiguration configuration,
    IWebHostEnvironment environment) =>
{
    string? inputPath = null;
    string? outputPath = null;

    try
    {
        if (!request.HasFormContentType)
        {
            return Results.BadRequest(new { error = "Request must use multipart/form-data." });
        }

        var form = await request.ReadFormAsync();
        var file = form.Files.GetFile("file");

        if (file is null || file.Length == 0)
        {
            return Results.BadRequest(new { error = "No file was uploaded, or the uploaded file is empty." });
        }

        var tempRoot = ResolveTempRoot(configuration, environment);
        Directory.CreateDirectory(tempRoot);

        var id = Guid.NewGuid().ToString("N");
        var extension = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(extension))
        {
            extension = ".glb";
        }

        inputPath = Path.Combine(tempRoot, $"{id}{extension}");
        outputPath = Path.Combine(tempRoot, $"{id}_compressed.glb");

        await using (var inputStream = File.Create(inputPath))
        {
            await file.CopyToAsync(inputStream);
        }

        var configuredCommand = configuration["GltfTransform:Command"];
        var command = string.IsNullOrWhiteSpace(configuredCommand)
            ? DefaultGltfTransformCommand()
            : configuredCommand;
        var arguments =
            $"optimize {Quote(inputPath)} {Quote(outputPath)} --compress draco --texture-compress webp --no-limit-input-pixels";

        var startInfo = new ProcessStartInfo
        {
            FileName = command,
            Arguments = arguments,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(startInfo);
        if (process is null)
        {
            return ServerError("Failed to start the gltf-transform command.");
        }

        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();

        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        if (process.ExitCode != 0)
        {
            var message = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
            return ServerError($"gltf-transform failed: {message.Trim()}");
        }

        if (!File.Exists(outputPath))
        {
            return ServerError("The compression command finished, but no output file was generated.");
        }

        var bytes = await File.ReadAllBytesAsync(outputPath);
        return Results.File(
            bytes,
            "application/octet-stream",
            "compressed.glb");
    }
    catch (Exception ex)
    {
        return ServerError(ex.Message);
    }
    finally
    {
        TryDelete(inputPath);
        TryDelete(outputPath);
    }
});

app.Run();

static string Quote(string value) => $"\"{value.Replace("\"", "\\\"")}\"";

static string DefaultGltfTransformCommand() =>
    OperatingSystem.IsWindows() ? DefaultWindowsGltfTransformCommand() : "gltf-transform";

static string DefaultWindowsGltfTransformCommand()
{
    var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    var npmShim = Path.Combine(localAppData, "npm", "gltf-transform.cmd");

    return File.Exists(npmShim) ? npmShim : "gltf-transform.cmd";
}

static string ResolveTempRoot(IConfiguration configuration, IWebHostEnvironment environment)
{
    var configuredTempRoot = configuration["Storage:TempDirectory"];
    if (!string.IsNullOrWhiteSpace(configuredTempRoot))
    {
        return Path.IsPathRooted(configuredTempRoot)
            ? configuredTempRoot
            : Path.Combine(environment.ContentRootPath, configuredTempRoot);
    }

    return Path.Combine(Path.GetTempPath(), "glb-compressor");
}

static IResult ServerError(string message) =>
    Results.Json(
        new { error = message },
        statusCode: StatusCodes.Status500InternalServerError);

static void TryDelete(string? path)
{
    try
    {
        if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
        {
            File.Delete(path);
        }
    }
    catch
    {
        // Best-effort cleanup.
    }
}
