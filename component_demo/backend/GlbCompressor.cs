using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

// ============================================================
//  GlbCompressor — 直接从 component/backend/GlbCompressor.cs 复制
//  在实际项目中，建议将 component/backend/ 作为独立类库引用。
// ============================================================
namespace ComponentDemo.Backend
{
    public sealed class GlbCompressionOptions
    {
        public bool EnableDraco { get; set; } = true;
        public bool CompressTextureToWebP { get; set; } = true;
        public string? GltfTransformCommand { get; set; } = null;
        public TimeSpan Timeout { get; set; } = TimeSpan.FromMinutes(10);
    }

    public sealed class GlbCompressionResult
    {
        public required string OutputPath { get; init; }
        public required string OutputFileName { get; init; }
        public long OriginalSizeBytes { get; init; }
        public long CompressedSizeBytes { get; init; }
        public double CompressionRatio =>
            OriginalSizeBytes > 0
                ? Math.Round((double)CompressedSizeBytes / OriginalSizeBytes * 100, 1)
                : 0;
    }

    public static class GlbCompressor
    {
        private static readonly byte[] GlbMagic = { 0x67, 0x6C, 0x54, 0x46 };

        public static async Task<GlbCompressionResult> CompressGlbAsync(
            string inputPath,
            string? outputDirectory = null,
            string? outputBaseName = null,
            GlbCompressionOptions? options = null,
            CancellationToken cancellationToken = default)
        {
            options ??= new GlbCompressionOptions();
            ValidateInputFile(inputPath);

            var originalSize = new FileInfo(inputPath).Length;
            var outDir = string.IsNullOrWhiteSpace(outputDirectory)
                ? Path.GetDirectoryName(inputPath)!
                : outputDirectory;
            Directory.CreateDirectory(outDir);

            // 优先使用调用方传入的 baseName（例如用户原始文件名），回退到 inputPath 的文件名
            var baseName = string.IsNullOrWhiteSpace(outputBaseName)
                ? Path.GetFileNameWithoutExtension(inputPath)
                : outputBaseName;
            var uuid = Guid.NewGuid().ToString("N");
            var outputFileName = $"{baseName}_{uuid}.glb";
            var outputPath = Path.Combine(outDir, outputFileName);

            var arguments = BuildArguments(inputPath, outputPath, options);
            var command = ResolveCommand(options.GltfTransformCommand);

            var startInfo = new ProcessStartInfo
            {
                FileName = command,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException(
                    $"无法启动 gltf-transform 进程（命令：{command}）。" +
                    "请确认已全局安装：npm install -g @gltf-transform/cli");

            using var timeoutCts = new CancellationTokenSource(options.Timeout);
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();

            try { await process.WaitForExitAsync(linkedCts.Token); }
            catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                throw new GlbCompressionException($"gltf-transform 执行超时（{options.Timeout.TotalMinutes} 分钟）。");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            if (process.ExitCode != 0)
            {
                var detail = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                throw new GlbCompressionException($"gltf-transform 执行失败（退出码 {process.ExitCode}）：{detail.Trim()}");
            }

            if (!File.Exists(outputPath))
                throw new GlbCompressionException("压缩命令执行成功，但未生成输出文件。");

            return new GlbCompressionResult
            {
                OutputPath = outputPath,
                OutputFileName = outputFileName,
                OriginalSizeBytes = originalSize,
                CompressedSizeBytes = new FileInfo(outputPath).Length,
            };
        }

        private static void ValidateInputFile(string inputPath)
        {
            if (string.IsNullOrWhiteSpace(inputPath))
                throw new ArgumentException("输入文件路径不能为空。", nameof(inputPath));
            if (!File.Exists(inputPath))
                throw new ArgumentException($"输入文件不存在：{inputPath}", nameof(inputPath));

            var ext = Path.GetExtension(inputPath);
            if (!string.Equals(ext, ".glb", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException(
                    $"输入文件必须是 GLB 格式（.glb），当前扩展名：{ext}。");

            Span<byte> header = stackalloc byte[4];
            using var stream = File.OpenRead(inputPath);
            if (stream.Length < 12 || stream.Read(header) != 4)
                throw new InvalidDataException("文件过短，不是合法的 GLB 二进制文件。");
            for (int i = 0; i < GlbMagic.Length; i++)
                if (header[i] != GlbMagic[i])
                    throw new InvalidDataException("文件头魔数不匹配，不是合法的 GLB 二进制文件。");
        }

        private static string BuildArguments(string inputPath, string outputPath, GlbCompressionOptions options)
        {
            var args = $"optimize {Quote(inputPath)} {Quote(outputPath)}";
            if (options.EnableDraco) args += " --compress draco";
            if (options.CompressTextureToWebP) args += " --texture-compress webp --no-limit-input-pixels";
            return args;
        }

        private static string ResolveCommand(string? configured)
        {
            if (!string.IsNullOrWhiteSpace(configured)) return configured;
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                var npmShim = Path.Combine(localAppData, "npm", "gltf-transform.cmd");
                if (File.Exists(npmShim)) return npmShim;
                return "gltf-transform.cmd";
            }
            return "gltf-transform";
        }

        private static string Quote(string value) => $"\"{value.Replace("\"", "\\\"")}\"";
    }

    public sealed class GlbCompressionException : Exception
    {
        public GlbCompressionException(string message) : base(message) { }
    }
}
