# GLB Compression Service

This folder contains reusable C# backend code for compressing GLB files only. It does not implement model format conversion.

The implementation wraps the `gltf-transform` CLI and runs:

```bash
gltf-transform optimize "input.glb" "output.glb" --compress draco --texture-compress webp --no-limit-input-pixels
```

## Files

```bash
component/backend/GlbCompressionService.cs
```

## Environment

Required:

- .NET 8 or newer
- Node.js
- `@gltf-transform/cli`

Install the CLI:

```bash
npm install -g @gltf-transform/cli
```

Verify:

```bash
gltf-transform --version
```

Windows may need the `.cmd` shim:

```bash
gltf-transform.cmd --version
```

No NuGet package is required by this file. Compression is performed by the external `gltf-transform` executable.

## Integration

Copy this file into your backend project:

```bash
component/backend/GlbCompressionService.cs
```

Use the namespace:

```csharp
using Component.Backend;
```

## Method

```csharp
public static Task<GlbCompressionResult> CompressGlbAsync(
    string inputPath,
    string outputDirectory,
    GlbCompressionOptions? options = null,
    CancellationToken cancellationToken = default)
```

Synchronous wrapper:

```csharp
public static GlbCompressionResult CompressGlb(
    string inputPath,
    string outputDirectory,
    GlbCompressionOptions? options = null)
```

## Parameters

| Parameter | Description |
| --- | --- |
| `inputPath` | Absolute or relative path to a `.glb` file. The file must be a valid binary GLB. |
| `outputDirectory` | Directory where the compressed GLB will be written. |
| `options.GltfTransformCommand` | Optional full path or command name for `gltf-transform`. |
| `options.TempDirectory` | Reserved for host apps that want to track temporary storage. The current method writes directly to `outputDirectory`. |
| `options.NoLimitInputPixels` | Whether to append `--no-limit-input-pixels`. Default is `true`. |
| `options.Timeout` | Compression timeout. Default is 10 minutes. |

The generated output file name is:

```bash
original-file-name_UUID.glb
```

Example:

```bash
house_7f5393e941904557ad5a812350c9a9b1.glb
```

## Example

```csharp
using Component.Backend;

var result = await GlbCompressionService.CompressGlbAsync(
    inputPath: "/data/uploads/model.glb",
    outputDirectory: "/data/outputs",
    options: new GlbCompressionOptions
    {
        GltfTransformCommand = "/usr/local/bin/gltf-transform",
        Timeout = TimeSpan.FromMinutes(15)
    });

Console.WriteLine(result.OutputPath);
Console.WriteLine($"Original: {result.OriginalSizeBytes}");
Console.WriteLine($"Compressed: {result.CompressedSizeBytes}");
```

ASP.NET Core upload example:

```csharp
app.MapPost("/api/upload", async (IFormFile file) =>
{
    var tempRoot = Path.Combine(Path.GetTempPath(), "glb-demo");
    Directory.CreateDirectory(tempRoot);

    var inputPath = Path.Combine(tempRoot, file.FileName);
    await using (var stream = File.Create(inputPath))
    {
        await file.CopyToAsync(stream);
    }

    var result = await GlbCompressionService.CompressGlbAsync(inputPath, tempRoot);
    var bytes = await File.ReadAllBytesAsync(result.OutputPath);

    return Results.File(bytes, "application/octet-stream", result.OutputFileName);
});
```

## Error Handling

The service throws clear exceptions for common failures:

- input path is empty
- file does not exist
- file extension is not `.glb`
- file header is not valid GLB
- `gltf-transform` cannot start
- `gltf-transform` exits with an error
- output file is not generated
- compression times out

## Notes

- Current scope: GLB compression only.
- No OBJ/FBX/STL/STEP/etc. conversion code is included.
- Future versions may add format conversion before compression, but this file intentionally keeps the integration surface small.
