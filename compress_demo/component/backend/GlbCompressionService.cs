using System.Diagnostics;

namespace Component.Backend;

public sealed class GlbCompressionOptions
{
    public string? GltfTransformCommand { get; init; }
    public string? TempDirectory { get; init; }
    public bool NoLimitInputPixels { get; init; } = true;
    public TimeSpan Timeout { get; init; } = TimeSpan.FromMinutes(10);
}

public sealed class GlbCompressionResult
{
    public required string OutputPath { get; init; }
    public required string OutputFileName { get; init; }
    public long OriginalSizeBytes { get; init; }
    public long CompressedSizeBytes { get; init; }
}

public static class GlbCompressionService
{
    public static async Task<GlbCompressionResult> CompressGlbAsync(
        string inputPath,
        string outputDirectory,
        GlbCompressionOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        options ??= new GlbCompressionOptions();
        ValidateInputFile(inputPath);

        Directory.CreateDirectory(outputDirectory);

        var inputFileName = Path.GetFileNameWithoutExtension(inputPath);
        var outputFileName = $"{inputFileName}_{Guid.NewGuid():N}.glb";
        var outputPath = Path.Combine(outputDirectory, outputFileName);

        var command = string.IsNullOrWhiteSpace(options.GltfTransformCommand)
            ? DefaultGltfTransformCommand()
            : options.GltfTransformCommand;

        var arguments = BuildOptimizeArguments(inputPath, outputPath, options);
        var startInfo = new ProcessStartInfo
        {
            FileName = command,
            Arguments = arguments,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Failed to start the gltf-transform command.");

        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(options.Timeout);

        try
        {
            await process.WaitForExitAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            TryKill(process);
            throw new TimeoutException($"GLB compression timed out after {options.Timeout.TotalSeconds:N0} seconds.");
        }

        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        if (process.ExitCode != 0)
        {
            var message = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
            throw new InvalidOperationException($"gltf-transform failed: {message.Trim()}");
        }

        if (!File.Exists(outputPath))
        {
            throw new FileNotFoundException("Compression finished, but no output GLB was generated.", outputPath);
        }

        return new GlbCompressionResult
        {
            OutputPath = outputPath,
            OutputFileName = outputFileName,
            OriginalSizeBytes = new FileInfo(inputPath).Length,
            CompressedSizeBytes = new FileInfo(outputPath).Length
        };
    }

    public static GlbCompressionResult CompressGlb(
        string inputPath,
        string outputDirectory,
        GlbCompressionOptions? options = null)
    {
        return CompressGlbAsync(inputPath, outputDirectory, options).GetAwaiter().GetResult();
    }

    private static void ValidateInputFile(string inputPath)
    {
        if (string.IsNullOrWhiteSpace(inputPath))
        {
            throw new ArgumentException("Input path is required.", nameof(inputPath));
        }

        if (!File.Exists(inputPath))
        {
            throw new FileNotFoundException("Input GLB file was not found.", inputPath);
        }

        if (!string.Equals(Path.GetExtension(inputPath), ".glb", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Only .glb files are supported. Format conversion is not implemented.", nameof(inputPath));
        }

        Span<byte> header = stackalloc byte[4];
        using var stream = File.OpenRead(inputPath);
        if (stream.Length < 12 || stream.Read(header) != 4 || header[0] != 'g' || header[1] != 'l' || header[2] != 'T' || header[3] != 'F')
        {
            throw new InvalidDataException("Input file is not a valid binary GLB file.");
        }
    }

    private static string BuildOptimizeArguments(string inputPath, string outputPath, GlbCompressionOptions options)
    {
        var arguments = $"optimize {Quote(inputPath)} {Quote(outputPath)} --compress draco --texture-compress webp";
        return options.NoLimitInputPixels ? $"{arguments} --no-limit-input-pixels" : arguments;
    }

    private static string DefaultGltfTransformCommand() =>
        OperatingSystem.IsWindows() ? DefaultWindowsGltfTransformCommand() : "gltf-transform";

    private static string DefaultWindowsGltfTransformCommand()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var npmShim = Path.Combine(localAppData, "npm", "gltf-transform.cmd");

        return File.Exists(npmShim) ? npmShim : "gltf-transform.cmd";
    }

    private static string Quote(string value) => $"\"{value.Replace("\"", "\\\"")}\"";

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // Best-effort cleanup after timeout.
        }
    }
}
