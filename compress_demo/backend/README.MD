# GLB 压缩后端服务

这是 3D 模型压缩工具的后端项目，基于 ASP.NET Core Minimal API 实现。服务接收前端上传的文件，保存到临时目录后调用 `gltf-transform` CLI 执行 Draco 压缩和纹理 WebP 转换，最后把压缩后的 GLB 文件返回给浏览器下载。

## 功能说明

- 接口地址：`POST /api/upload`
- 请求格式：`multipart/form-data`
- 文件字段名：`file`
- 成功响应：返回 `compressed.glb` 文件流
- 失败响应：返回 JSON 错误信息

压缩命令格式：

```bash
gltf-transform optimize "input.glb" "output.glb" --compress draco --texture-compress webp --no-limit-input-pixels
```

## 环境要求

需要先安装：

- .NET SDK
- Node.js
- `@gltf-transform/cli`

安装 `gltf-transform`：

```bash
npm install -g @gltf-transform/cli
```

检查是否安装成功：

```bash
gltf-transform --version
```

Windows 如果遇到 PowerShell 执行策略问题，可以使用：

```bash
gltf-transform.cmd --version
```

## 本地运行

进入后端目录：

```bash
cd backend
```

还原依赖：

```bash
dotnet restore
```

启动服务：

```bash
dotnet run
```

默认监听地址：

```bash
http://localhost:5000
```

检查服务是否启动：

```bash
curl http://localhost:5000/
```

正常会返回：

```json
{
  "status": "GLB compressor backend is running"
}
```

## 上传测试

使用 `curl` 上传 GLB 文件：

```bash
curl -X POST "http://localhost:5000/api/upload" \
  -F "file=@./model.glb" \
  --output compressed.glb
```

Windows CMD 可使用：

```bash
curl.exe -X POST "http://localhost:5000/api/upload" -F "file=@model.glb" --output compressed.glb
```

上传成功后，会在当前目录生成：

```bash
compressed.glb
```

## 配置说明

配置文件：

```bash
appsettings.json
```

### gltf-transform 命令路径

默认配置：

```json
{
  "GltfTransform": {
    "Command": ""
  }
}
```

当 `Command` 为空时，程序会自动使用默认命令：

- Windows：优先查找 `%LOCALAPPDATA%\\npm\\gltf-transform.cmd`，找不到则使用 `gltf-transform.cmd`
- Linux/macOS：使用 `gltf-transform`

如果服务器上命令不在 PATH 中，建议配置完整路径。

Linux 示例：

```json
{
  "GltfTransform": {
    "Command": "/usr/local/bin/gltf-transform"
  }
}
```

Windows 示例：

```json
{
  "GltfTransform": {
    "Command": "C:\\Users\\YourUser\\AppData\\Roaming\\npm\\gltf-transform.cmd"
  }
}
```

Windows 注意使用 `.cmd`，不要配置 `.ps1`，否则可能被 PowerShell 执行策略拦截。

### 临时文件目录

默认配置：

```json
{
  "Storage": {
    "TempDirectory": ""
  }
}
```

当 `TempDirectory` 为空时，程序会使用系统临时目录下的 `glb-compressor` 文件夹。

如果要指定目录：

```json
{
  "Storage": {
    "TempDirectory": "/data/glb-temp"
  }
}
```

也可以使用相对路径，相对路径会基于后端项目运行目录：

```json
{
  "Storage": {
    "TempDirectory": "Temp"
  }
}
```

部署时请确保运行后端服务的用户对临时目录有创建、读取、写入、删除权限。

## 发布部署

发布 Release 版本：

```bash
dotnet publish -c Release -o ./publish
```

进入发布目录：

```bash
cd publish
```

运行服务：

```bash
dotnet backend.dll
```

指定监听地址：

```bash
ASPNETCORE_URLS=http://0.0.0.0:5000 dotnet backend.dll
```

Windows PowerShell 指定监听地址：

```bash
$env:ASPNETCORE_URLS="http://0.0.0.0:5000"
dotnet backend.dll
```

## 服务器部署检查清单

部署到服务器前，请确认：

- 服务器已安装 Node.js
- 服务器已安装 `@gltf-transform/cli`
- `gltf-transform --version` 可以正常执行
- `appsettings.json` 中的 `GltfTransform:Command` 路径正确
- 临时目录可读写
- 服务器防火墙已开放后端端口，例如 `5000`
- 前端请求地址指向正确的后端接口，例如 `http://server-ip:5000/api/upload`

## 常见问题

### Failed to start the gltf-transform command

表示后端找不到 `gltf-transform` 命令。请检查：

```bash
gltf-transform --version
```

如果命令不可用，请安装 CLI 或在 `appsettings.json` 中配置完整路径。

### Access to the path is denied

表示后端运行用户没有临时目录读写权限。请修改 `Storage:TempDirectory`，或给当前目录授权。

### 上传后返回 gltf-transform failed

表示后端已成功接收文件，但 `gltf-transform` 压缩失败。请优先确认上传文件是否为有效 GLB 文件，并查看返回的错误信息。
