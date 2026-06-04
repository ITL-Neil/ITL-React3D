using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace GlbCompressorComponent
{
    /// <summary>
    /// GLB 文件压缩配置选项。
    /// </summary>
    public sealed class GlbCompressionOptions
    {
        /// <summary>
        /// 是否启用 Draco 网格压缩（默认 true）。
        /// </summary>
        public bool EnableDraco { get; set; } = true;

        /// <summary>
        /// 是否将纹理压缩为 WebP 格式（默认 true）。
        /// </summary>
        public bool CompressTextureToWebP { get; set; } = true;

        /// <summary>
        /// gltf-transform 可执行文件路径。
        /// 为 null 时自动查找系统 PATH 中的 gltf-transform（Windows 同时尝试 npm shim）。
        /// </summary>
        public string? GltfTransformCommand { get; set; } = null;

        /// <summary>
        /// 压缩进程超时时间（默认 10 分钟）。
        /// </summary>
        public TimeSpan Timeout { get; set; } = TimeSpan.FromMinutes(10);
    }

    /// <summary>
    /// 压缩结果信息。
    /// </summary>
    public sealed class GlbCompressionResult
    {
        /// <summary>压缩后文件的完整路径。</summary>
        public required string OutputPath { get; init; }

        /// <summary>压缩后文件名（含 UUID）：{原始文件名}_{UUID}.glb</summary>
        public required string OutputFileName { get; init; }

        /// <summary>原始文件大小（字节）。</summary>
        public long OriginalSizeBytes { get; init; }

        /// <summary>压缩后文件大小（字节）。</summary>
        public long CompressedSizeBytes { get; init; }

        /// <summary>压缩率（百分比），例如 35.2 表示压缩后为原来的 35.2%。</summary>
        public double CompressionRatio =>
            OriginalSizeBytes > 0
                ? Math.Round((double)CompressedSizeBytes / OriginalSizeBytes * 100, 1)
                : 0;
    }

    /// <summary>
    /// GLB 文件压缩工具类。
    ///
    /// 功能：调用 gltf-transform CLI 对 GLB 文件进行
    ///   - Draco 网格压缩
    ///   - WebP 纹理压缩（可选）
    ///
    /// 注意：当前版本仅支持 GLB 文件压缩，不含模型格式转换功能。
    ///
    /// 依赖：
    ///   - Node.js（运行时）
    ///   - gltf-transform CLI：npm install -g @gltf-transform/cli
    /// </summary>
    public static class GlbCompressor
    {
        // GLB 文件魔数：glTF（十六进制 0x46546C67）
        private static readonly byte[] GlbMagic = { 0x67, 0x6C, 0x54, 0x46 };

        /// <summary>npm 全局安装的 gltf-transform CLI JS 入口</summary>
        private static readonly Lazy<string?> NpmCliJsPath = new(() =>
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var path = Path.Combine(localAppData, "npm", "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
            return File.Exists(path) ? path : null;
        });

        /// <summary>优先使用 WorkBuddy 托管的 Node.js，回退到系统 PATH</summary>
        private static string NodeExePath
        {
            get
            {
                var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                var managedNode = Path.Combine(home, ".workbuddy", "binaries", "node", "versions", "22.22.2", "node.exe");
                if (File.Exists(managedNode)) return managedNode;
                return "node"; // fallback to PATH
            }
        }

        /// <summary>暴露 Node.exe 路径（供 GlbConverter 等内部组件使用）</summary>
        internal static string GetNodeExePath() => NodeExePath;

        /// <summary>暴露 npm cli.js 路径（供 GlbConverter 等内部组件使用）</summary>
        internal static string? GetNpmCliJsPath() => NpmCliJsPath.Value;

        // ---------------------------------------------------------------
        // 公共 API
        // ---------------------------------------------------------------

        /// <summary>
        /// 压缩指定路径的 GLB 文件。
        /// 输出文件名格式：{baseName}_{UUID}.glb
        /// </summary>
        /// <param name="inputPath">输入 GLB 文件的绝对路径。</param>
        /// <param name="outputDirectory">输出目录；若为 null，则与输入文件同目录。</param>
        /// <param name="outputBaseName">
        /// 输出文件的基础名称（不含扩展名），例如用户上传的原始文件名。
        /// 若为 null 或空字符串，则取 <paramref name="inputPath"/> 的文件名（不含扩展名）。
        /// 最终输出文件名为 {outputBaseName}_{UUID}.glb。
        /// </param>
        /// <param name="options">压缩选项；null 表示使用默认值。</param>
        /// <param name="cancellationToken">取消令牌。</param>
        /// <returns>包含输出路径、文件名与压缩统计的 <see cref="GlbCompressionResult"/>。</returns>
        /// <exception cref="ArgumentException">输入文件路径为空或文件不存在。</exception>
        /// <exception cref="InvalidDataException">文件扩展名不是 .glb 或文件头魔数不匹配（非合法 GLB 二进制文件）。</exception>
        /// <exception cref="InvalidOperationException">无法启动 gltf-transform 进程。</exception>
        /// <exception cref="GlbCompressionException">gltf-transform 执行失败或超时。</exception>
        public static async Task<GlbCompressionResult> CompressGlbAsync(
            string inputPath,
            string? outputDirectory = null,
            string? outputBaseName = null,
            GlbCompressionOptions? options = null,
            CancellationToken cancellationToken = default)
        {
            options ??= new GlbCompressionOptions();

            // --- 输入校验 ---
            ValidateInputFile(inputPath);

            var originalSize = new FileInfo(inputPath).Length;

            // --- 构建输出路径 ---
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

            // --- 构建 CLI 参数 ---
            var arguments = BuildArguments(inputPath, outputPath, options);
            var command = ResolveCommand(options.GltfTransformCommand);
            var cliJsPath = NpmCliJsPath.Value;

            // 优先直接用 node + cli.js 调用（避免 .cmd shim 的兼容性问题）
            // 否则如果是 .cmd/.bat 文件，通过 cmd.exe /c 启动
            bool isDirectNode = cliJsPath != null;
            bool isCmdWrapper = !isDirectNode
                && (command.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase)
                 || command.EndsWith(".bat", StringComparison.OrdinalIgnoreCase));

            var startInfo = new ProcessStartInfo
            {
                FileName    = isDirectNode ? NodeExePath : (isCmdWrapper ? "cmd.exe" : command),
                Arguments   = isDirectNode ? $"{Quote(cliJsPath!)} {arguments}"
                            : isCmdWrapper ? $"/c \"{command}\" {arguments}"
                            : arguments,
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
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken, timeoutCts.Token);

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();

            try
            {
                await process.WaitForExitAsync(linkedCts.Token);
            }
            catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
            {
                TryKillProcess(process);
                throw new GlbCompressionException(
                    $"gltf-transform 执行超时（{options.Timeout.TotalMinutes} 分钟）。");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            // 诊断日志
            Console.Error.WriteLine($"[GlbCompressor] 命令: {startInfo.FileName} {startInfo.Arguments}");
            Console.Error.WriteLine($"[GlbCompressor] STDOUT: {(string.IsNullOrWhiteSpace(stdout) ? "(空)" : stdout.Trim())}");
            Console.Error.WriteLine($"[GlbCompressor] STDERR: {(string.IsNullOrWhiteSpace(stderr) ? "(空)" : stderr.Trim())}");
            Console.Error.WriteLine($"[GlbCompressor] 退出码: {process.ExitCode}");

            if (process.ExitCode != 0)
            {
                var detail = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                var cmdLog = $"命令: {startInfo.FileName} {startInfo.Arguments}";
                throw new GlbCompressionException(
                    $"gltf-transform 执行失败（退出码 {process.ExitCode}）\n{cmdLog}\n输出: {detail.Trim()}");
            }

            if (!File.Exists(outputPath))
                throw new GlbCompressionException("压缩命令执行成功，但未生成输出文件。");

            var compressedSize = new FileInfo(outputPath).Length;

            return new GlbCompressionResult
            {
                OutputPath = outputPath,
                OutputFileName = outputFileName,
                OriginalSizeBytes = originalSize,
                CompressedSizeBytes = compressedSize,
            };
        }

        /// <summary>
        /// 同步版本（内部调用异步版本并等待）。
        /// 建议优先使用异步版本以避免线程阻塞。
        /// </summary>
        public static GlbCompressionResult CompressGlb(
            string inputPath,
            string? outputDirectory = null,
            string? outputBaseName = null,
            GlbCompressionOptions? options = null)
        {
            return CompressGlbAsync(inputPath, outputDirectory, outputBaseName, options)
                .GetAwaiter().GetResult();
        }

        // ---------------------------------------------------------------
        // 私有辅助方法
        // ---------------------------------------------------------------

        /// <summary>
        /// 校验输入文件：存在性、扩展名、GLB 魔数。
        /// </summary>
        private static void ValidateInputFile(string inputPath)
        {
            if (string.IsNullOrWhiteSpace(inputPath))
                throw new ArgumentException("输入文件路径不能为空。", nameof(inputPath));

            if (!File.Exists(inputPath))
                throw new ArgumentException($"输入文件不存在：{inputPath}", nameof(inputPath));

            var ext = Path.GetExtension(inputPath);
            if (!string.Equals(ext, ".glb", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException(
                    $"输入文件必须是 GLB 格式（.glb），当前扩展名：{ext}。" +
                    "本组件当前版本仅支持 GLB 文件压缩，不含格式转换功能。");

            // 校验 GLB 文件头魔数（前 4 字节应为 "glTF"）
            Span<byte> header = stackalloc byte[4];
            using var stream = File.OpenRead(inputPath);
            if (stream.Length < 12 || stream.Read(header) != 4)
                throw new InvalidDataException("文件过短，不是合法的 GLB 二进制文件。");

            for (int i = 0; i < GlbMagic.Length; i++)
            {
                if (header[i] != GlbMagic[i])
                    throw new InvalidDataException(
                        "文件头魔数不匹配，不是合法的 GLB 二进制文件（文件头应为 \"glTF\"）。");
            }
        }

        private static string BuildArguments(
            string inputPath,
            string outputPath,
            GlbCompressionOptions options)
        {
            var args = $"optimize {Quote(inputPath)} {Quote(outputPath)}";
            if (options.EnableDraco) args += " --compress draco --allow-net";
            if (options.CompressTextureToWebP) args += " --texture-compress webp --texture-size 8192 --no-limit-input-pixels";
            return args;
        }

        private static string ResolveCommand(string? configured)
        {
            if (!string.IsNullOrWhiteSpace(configured)) return configured;

            // npm 全局安装了 gltf-transform → 用 node + cli.js 直接调用
            if (NpmCliJsPath.Value != null) return NodeExePath;

            // 回退：Windows 用 .cmd shim，Linux/macOS 用 gltf-transform
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                return "gltf-transform.cmd";
            return "gltf-transform";
        }

        private static string Quote(string value) =>
            $"\"{value.Replace("\"", "\\\"")}\"";

        private static void TryKillProcess(Process process)
        {
            try { process.Kill(entireProcessTree: true); }
            catch { /* 忽略终止失败 */ }
        }
    }

    // ---------------------------------------------------------------
    // 自定义异常
    // ---------------------------------------------------------------

    /// <summary>GLB 压缩过程中的错误。</summary>
    public sealed class GlbCompressionException : Exception
    {
        public GlbCompressionException(string message) : base(message) { }
        public GlbCompressionException(string message, Exception inner) : base(message, inner) { }
    }
}
