using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Assimp;

namespace GlbCompressorComponent
{
    /// <summary>
    /// 3D 模型格式转换工具类。
    ///
    /// 使用 AssimpNet 库将各种 3D 文件格式转换为 GLB（glTF 2.0 Binary）。
    /// 支持超过 80 种 3D 文件格式，包括 FBX、OBJ、STL、PLY、3DS 等。
    ///
    /// 兼容性策略：
    ///   1. 优先尝试 Assimp 直接导出 GLB（glb2 / glb 格式）
    ///   2. 导出后检测 GLB 版本号 — 若为 glTF 1.0 则自动回退
    ///   3. 回退方案：导出 glTF 2.0 分离格式 → 使用 gltf-transform CLI 打包为 GLB
    ///
    /// 依赖：
    ///   - AssimpNet（≥ 4.1.0）：dotnet add package AssimpNet
    ///   - gltf-transform CLI（仅回退方案需要）：npm install -g @gltf-transform/cli
    ///   - 本组件与 GlbCompressor 共享 Node.js / gltf-transform 路径解析逻辑
    /// </summary>
    public static class GlbConverter
    {
        // 前端组件允许的所有文件扩展名（小写，不含点号）
        // 来源：component/frontend/DragUpload.tsx → DEFAULT_ALLOWED_EXTENSIONS
        private static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "glb", "gltf", "ply", "stl", "obj", "off", "dae", "fbx",
            "dxf", "ifc", "xyz", "pcd", "las", "laz", "stp", "step",
            "3dxml", "iges", "igs", "shp", "geojson", "xaml", "pts", "asc",
            "brep", "fcstd", "bim", "usdz", "pdb", "vtk", "svg", "wrl",
            "3dm", "3ds", "amf", "3mf", "dwg", "json", "rfa", "rvt",
            "cvs", "gpkg", "ac", "zgl", "x", "ter", "smd", "sib",
            "q3o", "q3s", "ogex", "nff", "ms3d", "mdl", "md5mesh", "md2",
            "lws", "hmp", "irrmesh", "x3d", "vrml", "b3dm", "xyzrgb", "x3dv",
            "vtu", "urdf", "ugrid", "su2", "babylon", "ac3d", "bvh", "ase",
            "wkt", "facet"
        };

        // ---------------------------------------------------------------
        // 公共 API — 文件路径版本（推荐）
        // ---------------------------------------------------------------

        /// <summary>
        /// 将任意支持的 3D 文件格式转换为 GLB（glTF 2.0 Binary）。
        /// </summary>
        /// <param name="inputFilePath">输入文件的绝对路径。</param>
        /// <param name="outputFilePath">输出 GLB 文件的绝对路径。</param>
        /// <exception cref="ArgumentException">输入路径为空或文件不存在。</exception>
        /// <exception cref="NotSupportedException">文件格式不在支持列表中，或 Assimp 无法处理该格式。</exception>
        /// <exception cref="InvalidDataException">文件损坏或 Assimp 导入失败。</exception>
        /// <exception cref="GlbCompressionException">导出 GLB 失败。</exception>
        public static void ConvertToGlb(string inputFilePath, string outputFilePath)
        {
            ValidateInputFile(inputFilePath);

            using var context = new AssimpContext();

            // 配置导入后处理步骤
            var postProcessSteps = PostProcessSteps.Triangulate
                               | PostProcessSteps.GenerateNormals
                               | PostProcessSteps.JoinIdenticalVertices
                               | PostProcessSteps.FlipUVs
                               | PostProcessSteps.ImproveCacheLocality
                               | PostProcessSteps.RemoveRedundantMaterials
                               | PostProcessSteps.OptimizeMeshes
                               | PostProcessSteps.OptimizeGraph;

            // 导入场景
            Scene? scene;
            try
            {
                scene = context.ImportFile(inputFilePath, postProcessSteps);
            }
            catch (Exception ex)
            {
                throw new InvalidDataException(
                    $"Assimp 导入文件失败：{Path.GetFileName(inputFilePath)}。文件可能损坏或格式不受支持。",
                    ex);
            }

            if (scene == null)
            {
                throw new InvalidDataException(
                    $"Assimp 无法导入文件：{Path.GetFileName(inputFilePath)}。请确认文件格式正确且未损坏。");
            }

            // 确保输出目录存在
            var outputDir = Path.GetDirectoryName(outputFilePath) ?? Path.GetTempPath();
            Directory.CreateDirectory(outputDir);

            // ---------------------------
            // 方案 A：尝试直接导出 GLB
            // ---------------------------
            var glbFormatId = FindGlbExportFormat(context);
            if (!string.IsNullOrWhiteSpace(glbFormatId))
            {
                try
                {
                    var success = context.ExportFile(scene, outputFilePath, glbFormatId);
                    if (success && File.Exists(outputFilePath) && new FileInfo(outputFilePath).Length > 0)
                    {
                        // 验证导出的 GLB 是否是 glTF 2.0
                        if (IsGlbVersion2(outputFilePath))
                            return; // 成功导出 glTF 2.0 GLB

                        // 导出了 glTF 1.0 GLB，删除并改用 glTF 方案
                        Console.Error.WriteLine("[GlbConverter] 导出的 GLB 是 glTF 1.0，改用 glTF+gltf-transform 方案");
                        File.Delete(outputFilePath);
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[GlbConverter] GLB 直接导出失败，改用 glTF 方案: {ex.Message}");
                    TryDelete(outputFilePath);
                }
            }

            // ---------------------------
            // 方案 B：导出 glTF 2.0 分离格式 → gltf-transform 打包
            // ---------------------------
            var gltfPath = Path.Combine(outputDir, $"{Path.GetFileNameWithoutExtension(outputFilePath)}.gltf");
            ExportToGltf(context, scene, gltfPath);
            ConvertGltfToGlb(gltfPath, outputFilePath);
        }

        // ---------------------------------------------------------------
        // 公共 API — 字节数组版本
        // ---------------------------------------------------------------

        /// <summary>
        /// 将字节数组数据转换为 GLB 格式。
        /// 适用于从内存或网络流中直接转换。
        /// </summary>
        /// <param name="inputData">输入文件的字节数组。</param>
        /// <param name="fileExtension">输入文件的扩展名（含点或不含点，例如 ".fbx" 或 "fbx"）。</param>
        /// <returns>转换后的 GLB 文件字节数组。</returns>
        /// <exception cref="ArgumentException">输入数据为空或扩展名不受支持。</exception>
        /// <exception cref="NotSupportedException">文件格式不在支持列表中。</exception>
        /// <exception cref="InvalidDataException">文件损坏或 Assimp 导入失败。</exception>
        /// <exception cref="GlbCompressionException">导出 GLB 失败。</exception>
        public static byte[] ConvertToGlb(byte[] inputData, string fileExtension)
        {
            if (inputData == null || inputData.Length == 0)
                throw new ArgumentException("输入数据不能为空。", nameof(inputData));

            // 标准化扩展名
            var ext = fileExtension.TrimStart('.').ToLowerInvariant();
            if (!SupportedExtensions.Contains(ext))
            {
                throw new NotSupportedException(
                    $"不支持的文件格式：.{ext}。支持的格式包括：{string.Join(", ", SupportedExtensions.Take(10))} 等。");
            }

            // 写入临时文件
            var tempInputPath = Path.Combine(
                Path.GetTempPath(),
                $"{Guid.NewGuid():N}.{ext}");
            var tempOutputPath = Path.Combine(
                Path.GetTempPath(),
                $"{Guid.NewGuid():N}.glb");

            try
            {
                File.WriteAllBytes(tempInputPath, inputData);
                ConvertToGlb(tempInputPath, tempOutputPath);
                return File.ReadAllBytes(tempOutputPath);
            }
            finally
            {
                TryDelete(tempInputPath);
                TryDelete(tempOutputPath);
            }
        }

        // ---------------------------------------------------------------
        // 公共 API — 异步版本
        // ---------------------------------------------------------------

        /// <summary>
        /// 异步版本：将任意支持的 3D 文件格式转换为 GLB。
        /// </summary>
        public static async Task ConvertToGlbAsync(
            string inputFilePath,
            string outputFilePath,
            CancellationToken cancellationToken = default)
        {
            // AssimpNet 暂不支持真正的异步 API，使用 Task.Run 避免阻塞
            await Task.Run(() => ConvertToGlb(inputFilePath, outputFilePath), cancellationToken);
        }

        /// <summary>
        /// 异步版本：将字节数组数据转换为 GLB 格式。
        /// </summary>
        public static async Task<byte[]> ConvertToGlbAsync(
            byte[] inputData,
            string fileExtension,
            CancellationToken cancellationToken = default)
        {
            return await Task.Run(() => ConvertToGlb(inputData, fileExtension), cancellationToken);
        }

        // ---------------------------------------------------------------
        // 公共工具方法
        // ---------------------------------------------------------------

        /// <summary>判断扩展名是否在支持列表中。</summary>
        public static bool IsFormatSupported(string fileExtension)
        {
            var ext = (fileExtension ?? "").TrimStart('.').ToLowerInvariant();
            return SupportedExtensions.Contains(ext);
        }

        /// <summary>判断当前文件是否已经是 GLB 格式。</summary>
        public static bool IsGlbFile(string filePath)
        {
            var ext = Path.GetExtension(filePath);
            return string.Equals(ext, ".glb", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>获取当前 Assimp 版本信息（用于诊断和日志）。</summary>
        public static string GetAssimpVersion()
        {
            try
            {
                using var ctx = new AssimpContext();
                var formats = ctx.GetSupportedImportFormats();
                return $"AssimpNet 已加载，支持 {formats.Length} 种导入格式。";
            }
            catch (Exception ex)
            {
                return $"AssimpNet 加载失败：{ex.Message}";
            }
        }

        /// <summary>获取 Assimp 实际支持的导出格式列表（用于验证 GLB 导出能力）。</summary>
        public static string[] GetSupportedExportFormats()
        {
            using var ctx = new AssimpContext();
            return ctx.GetSupportedExportFormats()
                .Select(f => $"{f.FormatId} ({f.Description})")
                .ToArray();
        }

        // ---------------------------------------------------------------
        // 私有辅助 — 校验
        // ---------------------------------------------------------------

        private static void ValidateInputFile(string inputPath)
        {
            if (string.IsNullOrWhiteSpace(inputPath))
                throw new ArgumentException("输入文件路径不能为空。", nameof(inputPath));

            if (!File.Exists(inputPath))
                throw new ArgumentException($"输入文件不存在：{inputPath}", nameof(inputPath));

            // 统一扩展名格式：去掉点号，转小写
            var ext = Path.GetExtension(inputPath);
            if (string.IsNullOrWhiteSpace(ext))
                throw new NotSupportedException("文件没有扩展名，无法判断格式。");

            ext = ext.TrimStart('.').ToLowerInvariant();
            if (!SupportedExtensions.Contains(ext))
            {
                throw new NotSupportedException(
                    $"不支持的文件格式：.{ext}。\n" +
                    $"前端组件允许的全部格式共 {SupportedExtensions.Count} 种，当前格式不在其中。\n" +
                    "若需支持新格式，请参考 Assimp 官方文档更新 SupportedExtensions 列表。");
            }
        }

        // ---------------------------------------------------------------
        // 私有辅助 — Assimp GLB 导出
        // ---------------------------------------------------------------

        /// <summary>
        /// 查找 Assimp 支持的 GLB 导出格式 ID。
        /// 优先 glTF 2.0 GLB（glb2/GLB2），回退到 glTF 1.0 GLB（glb/GLB）。
        /// </summary>
        private static string? FindGlbExportFormat(AssimpContext context)
        {
            var exportFormats = context.GetSupportedExportFormats().ToList();

            Console.Error.WriteLine("[GlbConverter] 可用导出格式:");
            foreach (var fmt in exportFormats)
                Console.Error.WriteLine($"  ID={fmt.FormatId}, Desc={fmt.Description}, Ext={fmt.FileExtension}");

            // 优先精确匹配 glTF 2.0 GLB 格式（glb2 / GLB2）
            foreach (var formatId in new[] { "glb2", "GLB2" })
            {
                if (exportFormats.Any(f => f.FormatId.Equals(formatId, StringComparison.OrdinalIgnoreCase)))
                    return formatId;
            }

            // 回退：精确匹配 glb / GLB（可能是 glTF 1.0，但至少能导出）
            foreach (var formatId in new[] { "glb", "GLB" })
            {
                if (exportFormats.Any(f => f.FormatId.Equals(formatId, StringComparison.OrdinalIgnoreCase)))
                    return formatId;
            }

            // 最后：模糊匹配
            var fuzzyMatch = exportFormats.FirstOrDefault(f =>
                f.FormatId.Contains("glb", StringComparison.OrdinalIgnoreCase) ||
                f.Description.Contains("glTF Binary", StringComparison.OrdinalIgnoreCase));

            return fuzzyMatch?.FormatId;
        }

        /// <summary>
        /// 检测 GLB 文件是否为 glTF 2.0 版本。
        /// GLB 二进制格式：前 4 字节 magic（"glTF"），后 4 字节是 uint32 版本号。
        /// </summary>
        private static bool IsGlbVersion2(string filePath)
        {
            try
            {
                Span<byte> header = stackalloc byte[8];
                using var fs = File.OpenRead(filePath);
                if (fs.Length < 8) return false;
                if (fs.Read(header) < 8) return false;

                // GLB magic: 'g','l','T','F' = 0x67, 0x6C, 0x54, 0x46
                if (header[0] != 0x67 || header[1] != 0x6C || header[2] != 0x54 || header[3] != 0x46)
                    return false;

                // Version at bytes 4-7 (uint32 LE)
                var version = header[4] | (header[5] << 8) | (header[6] << 16) | (header[7] << 24);
                return version == 2;
            }
            catch
            {
                return false;
            }
        }

        // ---------------------------------------------------------------
        // 私有辅助 — glTF 回退方案
        // ---------------------------------------------------------------

        /// <summary>
        /// 导出场景为 glTF 分离格式（.gltf + .bin + 纹理）。
        /// 优先使用 gltf2，回退到 gltf。
        /// </summary>
        private static void ExportToGltf(AssimpContext context, Scene scene, string outputPath)
        {
            var exportFormats = context.GetSupportedExportFormats().ToList();

            // 优先尝试 glTF 2.0 格式
            var gltf2Format = exportFormats.FirstOrDefault(f =>
                f.FormatId.Equals("gltf2", StringComparison.OrdinalIgnoreCase));

            if (gltf2Format != null)
            {
                Console.Error.WriteLine("[GlbConverter] 使用 gltf2 格式导出");
                context.ExportFile(scene, outputPath, "gltf2");
                return;
            }

            // 回退：glTF 格式
            var gltfFormat = exportFormats.FirstOrDefault(f =>
                f.FormatId.Equals("gltf", StringComparison.OrdinalIgnoreCase));

            if (gltfFormat != null)
            {
                Console.Error.WriteLine("[GlbConverter] 使用 gltf 格式导出");
                context.ExportFile(scene, outputPath, "gltf");
                return;
            }

            throw new NotSupportedException(
                "当前 Assimp 版本不支持 glTF 导出。请更新 AssimpNet 库。");
        }

        /// <summary>
        /// 使用 gltf-transform CLI 将 glTF 分离格式转换为 GLB 二进制格式。
        /// 命令：node cli.js copy input.gltf output.glb
        /// </summary>
        private static void ConvertGltfToGlb(string gltfPath, string glbOutputPath)
        {
            var nodeExe = GlbCompressor.GetNodeExePath();
            var cliJs = GlbCompressor.GetNpmCliJsPath();
            if (cliJs == null)
                throw new InvalidOperationException(
                    "未找到 gltf-transform CLI。请执行 npm install -g @gltf-transform/cli 安装。");

            var startInfo = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = $"{Quote(cliJs)} copy {Quote(gltfPath)} {Quote(glbOutputPath)}",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            Console.Error.WriteLine($"[GlbConverter] 转换 glTF→GLB: {startInfo.FileName} {startInfo.Arguments}");

            using var process = System.Diagnostics.Process.Start(startInfo)
                ?? throw new InvalidOperationException("无法启动 gltf-transform 进程。");

            // 必须在 WaitForExit 之前开始读取，否则缓冲区满会导致死锁
            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();

            if (!process.WaitForExit(120_000))
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                throw new GlbCompressionException("gltf-transform 转换 glTF→GLB 超时（120 秒）。");
            }

            var stderr = stderrTask.Result;
            var stdout = stdoutTask.Result;

            Console.Error.WriteLine($"[GlbConverter] STDOUT: {(string.IsNullOrWhiteSpace(stdout) ? "(空)" : stdout.Trim())}");
            Console.Error.WriteLine($"[GlbConverter] STDERR: {(string.IsNullOrWhiteSpace(stderr) ? "(空)" : stderr.Trim())}");
            Console.Error.WriteLine($"[GlbConverter] 退出码: {process.ExitCode}");

            if (process.ExitCode != 0 || !File.Exists(glbOutputPath))
            {
                var detail = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                throw new GlbCompressionException(
                    $"gltf-transform 转换 glTF→GLB 失败（退出码 {process.ExitCode}）：{detail.Trim()}");
            }

            // 清理 glTF 临时文件
            TryDelete(gltfPath);
            var binPath = Path.ChangeExtension(gltfPath, ".bin");
            TryDelete(binPath);

            // 清理可能的纹理文件
            var baseName = Path.GetFileNameWithoutExtension(gltfPath);
            var dir = Path.GetDirectoryName(gltfPath);
            if (dir != null)
            {
                foreach (var textureFile in Directory.GetFiles(dir, $"{baseName}_*"))
                    TryDelete(textureFile);
            }
        }

        // ---------------------------------------------------------------
        // 私有辅助 — 工具方法
        // ---------------------------------------------------------------

        private static string Quote(string value) =>
            $"\"{value.Replace("\"", "\\\"")}\"";

        private static void TryDelete(string? path)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                    File.Delete(path);
            }
            catch { /* 最大努力清理，忽略失败 */ }
        }
    }
}
